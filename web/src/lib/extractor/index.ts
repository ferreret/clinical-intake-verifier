/**
 * extract(pdf) -> Prediction. The one entry point used by the API route and the batch runner.
 *
 * A prediction is always produced for a PDF that could be read: when the model call fails
 * after its retry, the fields are null and `extractor.error` says why. Only a missing API key
 * or a malformed PDF throws.
 */
import { FIELD_NAMES } from "@/lib/schema/fields";
import {
  assertPrediction,
  PREDICTION_VERSION,
  type ExtractorError,
  type Prediction,
  type Usage,
} from "@/lib/schema/prediction";
import { callGemini, GeminiApiError } from "./gemini";
import type { NormalisedExtraction } from "./normalize";
import { garbledCount, normaliseExtraction } from "./normalize";
import { looksLikePdf, readPages, sha256Hex } from "./pdf";
import { buildSystemInstruction, PROMPT_VERSION, USER_MESSAGE } from "./prompt";
import { buildResponseSchema, validateRawExtraction, type RawExtraction } from "./response-schema";

export const DEFAULT_MODEL = "gemini-3.8-flash";
export const DEFAULT_THINKING_LEVEL = "low";
export const INPUT_MODE = "pdf-inline" as const;

export { PROMPT_VERSION } from "./prompt";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class InvalidPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPdfError";
  }
}

class ModelOutputError extends Error {
  constructor(
    readonly code: "invalid_json" | "schema_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "ModelOutputError";
  }
}

export interface ExtractOptions {
  /** Document id; derived from `file` when omitted. */
  id?: string;
  /** Base name of the PDF; derived from the hash when omitted. */
  file?: string;
  model?: string;
  temperature?: number;
  /** null disables the thinking config; undefined uses GEMINI_THINKING_LEVEL or the default. */
  thinkingLevel?: string | null;
  apiKey?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export function resolveModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export function resolveThinkingLevel(): string {
  return process.env.GEMINI_THINKING_LEVEL?.trim() || DEFAULT_THINKING_LEVEL;
}

/** File stem as a document id matching the golden's `^[a-z0-9][a-z0-9-]*$`. */
export function idFromFileName(file: string, fallback: string): string {
  const stem = file.replace(/\.pdf$/i, "");
  const slug = stem
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : fallback;
}

function emptyFields(): Record<string, null> {
  return Object.fromEntries(FIELD_NAMES.map((name) => [name, null]));
}

function parseRaw(text: string): RawExtraction {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new ModelOutputError("invalid_json", err instanceof Error ? err.message : String(err));
  }
  const errors = validateRawExtraction(doc);
  if (errors.length > 0) {
    throw new ModelOutputError("schema_mismatch", errors.slice(0, 5).join("; "));
  }
  return doc as RawExtraction;
}

function addUsage(a: Usage, b: Usage): Usage {
  const add = (x: number | null, y: number | null) => (x === null && y === null ? null : (x ?? 0) + (y ?? 0));
  return {
    input_tokens: add(a.input_tokens, b.input_tokens),
    output_tokens: add(a.output_tokens, b.output_tokens),
    thinking_tokens: add(a.thinking_tokens, b.thinking_tokens),
  };
}

function toExtractorError(err: unknown): ExtractorError {
  if (err instanceof ModelOutputError) return { code: err.code, message: err.message };
  if (err instanceof GeminiApiError) return { code: "api_error", message: err.message };
  return { code: "api_error", message: err instanceof Error ? err.message : String(err) };
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ModelOutputError) return true;
  if (err instanceof GeminiApiError) return err.retryable;
  return false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function extract(pdf: Uint8Array, opts: ExtractOptions = {}): Promise<Prediction> {
  if (!looksLikePdf(pdf)) throw new InvalidPdfError("not a PDF");
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ConfigError("GEMINI_API_KEY is not set");

  const model = opts.model ?? resolveModel();
  const temperature = opts.temperature ?? 0;
  const thinkingLevel = opts.thinkingLevel === undefined ? resolveThinkingLevel() : opts.thinkingLevel;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  const retryDelayMs = opts.retryDelayMs ?? 2000;

  const sha256 = sha256Hex(pdf);
  const pages = await readPages(pdf).catch((err) => {
    throw new InvalidPdfError(err instanceof Error ? err.message : String(err));
  });
  const file = opts.file ?? `${sha256.slice(0, 12)}.pdf`;
  const id = opts.id ?? idFromFileName(file, sha256.slice(0, 12));

  const request = {
    apiKey,
    model,
    pdf,
    systemInstruction: buildSystemInstruction(),
    userMessage: USER_MESSAGE,
    responseSchema: buildResponseSchema(),
    temperature,
    thinkingLevel,
  };

  const started = Date.now();
  let attempts = 0;
  let result: NormalisedExtraction | null = null;
  let error: ExtractorError | null = null;
  let modelVersion: string | null = null;
  let usage: Usage = { input_tokens: null, output_tokens: null, thinking_tokens: null };

  // A reply with garbled text (accented letters corrupted, which the model does intermittently)
  // is also worth another try. The best reply so far is kept: fewer garbled values wins, and a
  // later failed attempt never discards a usable earlier one.
  let garbledFirst = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const reply = await callGemini(request);
      modelVersion = reply.modelVersion ?? modelVersion;
      usage = addUsage(usage, reply.usage);
      const candidate = normaliseExtraction(parseRaw(reply.text), pages.length);
      if (result === null) garbledFirst = garbledCount(candidate);
      if (result === null || garbledCount(candidate) < garbledCount(result)) result = candidate;
      error = null;
      if (garbledCount(result) === 0) break;
    } catch (err) {
      if (result !== null) break;
      error = toExtractorError(err);
      if (!isRetryable(err) || attempts >= maxAttempts) break;
      if (retryDelayMs > 0) await sleep(retryDelayMs * attempts);
    }
  }
  if (result !== null && garbledFirst > 0 && attempts > 1) {
    result.warnings.push({
      code: "retried_garbled_text",
      field: null,
      detail: `first reply had ${garbledFirst} garbled value(s); kept reply has ${garbledCount(result)}`,
    });
  }

  const prediction: Prediction = {
    prediction_version: PREDICTION_VERSION,
    id,
    file,
    sha256,
    extractor: {
      model,
      model_version: modelVersion,
      prompt_version: PROMPT_VERSION,
      input_mode: INPUT_MODE,
      temperature,
      thinking_level: thinkingLevel,
      attempts,
      latency_ms: Date.now() - started,
      usage,
      created_at: new Date().toISOString(),
      error,
    },
    pages,
    fields: result?.fields ?? emptyFields(),
    tests: result?.tests ?? [],
    warnings: result?.warnings ?? [],
  };
  assertPrediction(prediction);
  return prediction;
}
