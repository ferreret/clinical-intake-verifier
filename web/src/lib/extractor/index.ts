/**
 * extract(pdf) -> Prediction. The one entry point used by the API route and the batch runner.
 *
 * A prediction is always produced for a PDF that could be read: when the model call fails
 * after its retry, the fields are null and `extractor.error` says why. Only a missing API key
 * or a malformed PDF throws.
 *
 * Two providers, the same prompt and the same checks: Gemini reads the PDF itself; the local
 * vision model sees the pages rendered to images and answers in its own box convention, which
 * is converted before anything else reads the reply. The local model's boxes are then replaced
 * by the page's OCR wherever it finds the value (locate.ts): the model reads, the OCR places.
 */
import { FIELD_NAMES } from "@/lib/schema/fields";
import {
  assertPrediction,
  PREDICTION_VERSION,
  type ExtractorError,
  type InputMode,
  type Prediction,
  type Usage,
} from "@/lib/schema/prediction";
import { callGemini, GeminiApiError } from "./gemini";
import { groundBoxes } from "./grounding";
import { relocateBoxes } from "./locate";
import { callLocal, LocalModelError, resolveLocalModel, resolveLocalUrl } from "./local";
import type { NormalisedExtraction } from "./normalize";
import { garbledCount, normaliseExtraction } from "./normalize";
import { ocrPages } from "./ocr";
import { looksLikePdf, readPages, sha256Hex } from "./pdf";
import { buildSystemInstruction, PROMPT_VERSION, USER_MESSAGE } from "./prompt";
import { renderPages } from "./render";
import {
  buildResponseSchema,
  GEMINI_BOXES,
  localBoxes,
  toLayer1,
  validateRawExtraction,
  type BoxConvention,
  type RawExtraction,
} from "./response-schema";

export const DEFAULT_MODEL = "gemini-3.8-flash";
export const DEFAULT_THINKING_LEVEL = "low";

export const PROVIDERS = ["gemini", "local"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** What each provider is given: the PDF itself, or one image per page. */
export const INPUT_MODE_OF: Record<Provider, InputMode> = { gemini: "pdf-inline", local: "page-images" };

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
  /** gemini or local; EXTRACTOR_PROVIDER or gemini when omitted. */
  provider?: Provider;
  model?: string;
  temperature?: number;
  /** null disables the thinking config; undefined uses GEMINI_THINKING_LEVEL or the default. */
  thinkingLevel?: string | null;
  apiKey?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Called with every reply the model sent, before it is parsed: for diagnosing failures. */
  onReply?: (reply: RawReply) => void;
  /** Local provider only: resolution the pages are rendered at (150 by default). */
  dpi?: number;
  /** Local provider only, experimental: locate the values again in a second pass per page. */
  grounding?: boolean;
  /** Boxes from the page's OCR where it finds the value; on for the local provider by default. */
  ocrBoxes?: boolean;
}

/** One reply as the model sent it, before parsing (for a local model, without its fence). */
export interface RawReply {
  attempt: number;
  text: string;
}

/**
 * The provider named by EXTRACTOR_PROVIDER. Gemini by default: it is the measured one; the
 * local model becomes a candidate for the default once the harness has measured it.
 */
export function resolveProvider(): Provider {
  const which = process.env.EXTRACTOR_PROVIDER?.trim() || "gemini";
  if (!(PROVIDERS as readonly string[]).includes(which)) {
    throw new ConfigError(`unknown EXTRACTOR_PROVIDER "${which}": use ${PROVIDERS.join(" or ")}`);
  }
  return which as Provider;
}

export function resolveModel(provider: Provider = "gemini"): string {
  return provider === "local" ? resolveLocalModel() : process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
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

/** `boxes` is the convention of an unconstrained reply; null for Gemini's, read as it is. */
function parseRaw(text: string, boxes: BoxConvention | null): RawExtraction {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
    if (boxes !== null) doc = toLayer1(doc, boxes);
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
  if (err instanceof GeminiApiError || err instanceof LocalModelError) return { code: "api_error", message: err.message };
  return { code: "api_error", message: err instanceof Error ? err.message : String(err) };
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ModelOutputError) return true;
  if (err instanceof GeminiApiError || err instanceof LocalModelError) return err.retryable;
  return false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function extract(pdf: Uint8Array, opts: ExtractOptions = {}): Promise<Prediction> {
  if (!looksLikePdf(pdf)) throw new InvalidPdfError("not a PDF");
  const provider = opts.provider ?? resolveProvider();
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (provider === "gemini" && !apiKey) throw new ConfigError("GEMINI_API_KEY is not set");

  const model = opts.model ?? resolveModel(provider);
  const temperature = opts.temperature ?? 0;
  // The local server takes no thinking level; reasoning is switched off in local.ts.
  const thinkingLevel =
    provider === "local" ? null : opts.thinkingLevel === undefined ? resolveThinkingLevel() : opts.thinkingLevel;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  const retryDelayMs = opts.retryDelayMs ?? 2000;

  const sha256 = sha256Hex(pdf);
  const pages = await readPages(pdf).catch((err) => {
    throw new InvalidPdfError(err instanceof Error ? err.message : String(err));
  });
  const file = opts.file ?? `${sha256.slice(0, 12)}.pdf`;
  const id = opts.id ?? idFromFileName(file, sha256.slice(0, 12));

  const started = Date.now();
  const boxes = provider === "local" ? localBoxes(model) : GEMINI_BOXES;
  let call: () => Promise<{ text: string; modelVersion: string | null; usage: Usage }>;
  let images: Uint8Array[] = [];
  if (provider === "local") {
    images = await renderPages(pdf, opts.dpi).catch((err) => {
      throw new InvalidPdfError(err instanceof Error ? err.message : String(err));
    });
    // No constrained decoding for this provider (see local.ts): the schema goes in the text.
    const systemInstruction =
      buildSystemInstruction(boxes) +
      "\n\nThe JSON object has this JSON Schema:\n" +
      JSON.stringify(buildResponseSchema(boxes));
    const request = {
      baseUrl: resolveLocalUrl(),
      model,
      pages: images,
      systemInstruction,
      userMessage: USER_MESSAGE,
      temperature,
    };
    call = () => callLocal(request);
  } else {
    const request = {
      apiKey: apiKey!,
      model,
      pdf,
      systemInstruction: buildSystemInstruction(boxes),
      userMessage: USER_MESSAGE,
      responseSchema: buildResponseSchema(boxes),
      temperature,
      thinkingLevel,
    };
    call = () => callGemini(request);
  }

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
      const reply = await call();
      opts.onReply?.({ attempt: attempts, text: reply.text });
      modelVersion = reply.modelVersion ?? modelVersion;
      usage = addUsage(usage, reply.usage);
      const candidate = normaliseExtraction(parseRaw(reply.text, provider === "local" ? boxes : null), pages.length);
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
  if (result !== null && provider === "local" && opts.grounding) {
    const grounded = await groundBoxes(result, images, (page, prompt) =>
      callLocal({ baseUrl: resolveLocalUrl(), model, pages: [page], systemInstruction: "", userMessage: prompt, temperature }),
    );
    for (const u of grounded.usage) usage = addUsage(usage, u);
  }
  if (result !== null && (opts.ocrBoxes ?? provider === "local")) {
    try {
      relocateBoxes(result, await ocrPages(pdf));
    } catch (err) {
      // The model's boxes stand; the values never depended on the OCR.
      result.warnings.push({
        code: "ocr_failed",
        field: null,
        detail: err instanceof Error ? err.message : String(err),
      });
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
      input_mode: INPUT_MODE_OF[provider],
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
