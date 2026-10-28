/**
 * The model layer of test mapping: a language model chooses, for each line the memory did
 * not settle, the codes among that line's catalog candidates.
 *
 * It can only choose from the candidates: the response schema lists them as an enum per line,
 * so a code outside the catalog cannot come back. An empty list means "none fits". The
 * provider is selectable: Gemini, or a local model behind an OpenAI-compatible API (the Qwen
 * of LM Studio). No patient data is sent: only test lines, the insurer and the candidates.
 * Replies are cached on disk by request, so a repeated simulation costs nothing.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { GoogleGenAI, type ThinkingLevel } from "@google/genai";

import { DEFAULT_MODEL, DEFAULT_THINKING_LEVEL } from "@/lib/extractor";
import { resolveLocalModel, resolveLocalUrl } from "@/lib/extractor/local";

import type { Catalog } from "./catalog";
import type { Candidate } from "./search";

export const MAPPING_PROMPT_VERSION = "1";

/** Profile candidates this high in the ranking bring their component tests along. */
const PROFILE_EXPANSION_RANK = 5;

export interface ModelLine {
  id: string;
  text: string;
  candidates: Candidate[];
}

export interface ModelRequest {
  insurer: string | null;
  language: string;
  /** Every test requested on the form, for context. */
  formLines: string[];
  lines: ModelLine[];
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ProviderReply {
  text: string;
  usage: Usage;
}

export interface Provider {
  readonly name: "gemini" | "local";
  readonly model: string;
  complete(system: string, user: string, schema: Record<string, unknown>): Promise<ProviderReply>;
}

export interface Consultation {
  /** Per line id: the chosen codes, or null when the model says none fits. */
  choices: Map<string, string[] | null>;
  usage: Usage;
  latencyMs: number;
  cached: boolean;
}

const SYSTEM = `You map the requested tests of a clinical laboratory request form to the laboratory's own test codes, so that a technician can verify them. You propose; a technician decides.

For each line, choose from that line's candidates exactly the tests the line requests:
- a single test: its one code;
- a profile or group requested as one line: every test of it that the insurer means, which may differ from the laboratory's own profile of the same name;
- a line that names no specimen means the test's usual specimen (marked "usual").

If no candidate fits, or you are not sure, return an empty list for that line. An empty answer costs the technician a click; a wrong one may go unnoticed.

The form may be in Spanish or Catalan; the catalogue is in Spanish. Return only the JSON object.`;

/** The codes a line may be mapped to: its test candidates and the tests of its top profiles. */
export function lineOptions(line: ModelLine, catalog: Catalog): { code: string; label: string; usual: boolean }[] {
  const byCode = new Map(catalog.tests.map((t) => [t.code, t]));
  const codes = new Set<string>();
  for (const [rank, c] of line.candidates.entries()) {
    if (c.kind === "test") codes.add(c.ref);
    else if (rank < PROFILE_EXPANSION_RANK) for (const code of c.codes) codes.add(code);
  }
  return [...codes].map((code) => {
    const t = byCode.get(code)!;
    return { code, label: t.name, usual: t.defaultSpecimen && t.specimen !== null };
  });
}

export function buildPrompt(req: ModelRequest, catalog: Catalog) {
  const blocks = req.lines.map((line) => {
    const options = lineOptions(line, catalog).map((o) => `  - ${o.code} ${o.label}${o.usual ? " (usual specimen)" : ""}`);
    const profiles = line.candidates
      .slice(0, PROFILE_EXPANSION_RANK)
      .filter((c) => c.kind === "profile")
      .map((c) => `  - lab profile "${c.label}" = ${c.codes.join(", ")}`);
    return [`${line.id}: "${line.text}"`, "  candidates:", ...options, ...profiles].join("\n");
  });
  const language = req.language === "ca" ? "Catalan" : "Spanish";
  const user = [
    `Insurer: ${req.insurer ?? "(none printed)"}. Form language: ${language}.`,
    `Tests requested on this form: ${req.formLines.join("; ")}.`,
    "",
    "Lines to map:",
    ...blocks,
  ].join("\n");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: req.lines.map((l) => l.id),
    properties: Object.fromEntries(
      req.lines.map((l) => [
        l.id,
        { type: "array", items: { type: "string", enum: lineOptions(l, catalog).map((o) => o.code) } },
      ]),
    ),
  };
  return { system: SYSTEM, user, schema };
}

export class GeminiProvider implements Provider {
  readonly name = "gemini" as const;
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string = process.env.MAPPING_GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    private readonly thinkingLevel: string = DEFAULT_THINKING_LEVEL,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async complete(system: string, user: string, schema: Record<string, unknown>): Promise<ProviderReply> {
    const r = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: user }] }],
      config: {
        systemInstruction: system,
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        thinkingConfig: { thinkingLevel: this.thinkingLevel.toUpperCase() as ThinkingLevel },
      },
    });
    if (!r.text) throw new Error(`empty Gemini reply (${r.candidates?.[0]?.finishReason ?? "unknown"})`);
    const u = r.usageMetadata;
    return {
      text: r.text,
      usage: {
        inputTokens: u?.promptTokenCount ?? null,
        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) || null,
      },
    };
  }
}

/** A model behind an OpenAI-compatible chat API, such as LM Studio's local server. */
export class LocalProvider implements Provider {
  readonly name = "local" as const;

  constructor(
    readonly model: string = resolveLocalModel(),
    private readonly baseUrl: string = resolveLocalUrl(),
  ) {}

  async complete(system: string, user: string, schema: Record<string, unknown>): Promise<ProviderReply> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        // Reasoning multiplies the latency of a local model tenfold for this task.
        reasoning_effort: "none",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name: "mapping", strict: true, schema } },
      }),
    });
    if (!res.ok) throw new Error(`local model: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: body.choices[0].message.content,
      usage: { inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null },
    };
  }
}

/**
 * The provider named by `name`, or by MAPPING_MODEL_PROVIDER. Local by default (decided on
 * 2026-10-23): free, nothing leaves the machine, nearly as good as Gemini on the measured
 * data. Gemini is the alternative, and the only option where no local model runs, such as
 * the public demo.
 */
export function resolveProvider(name?: string): Provider {
  const which = (name ?? process.env.MAPPING_MODEL_PROVIDER ?? "local").trim();
  if (which === "local") return new LocalProvider();
  if (which === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set (put it in web/.env.local)");
    return new GeminiProvider(key);
  }
  throw new Error(`unknown model provider "${which}": use gemini or local`);
}

/** A reply's text as the object the schema asks for, or null when it is not one. */
function replyObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Asks the provider (or the cache) which codes each line means. */
export async function consult(
  req: ModelRequest,
  catalog: Catalog,
  provider: Provider,
  cacheDir: string | null,
): Promise<Consultation> {
  const prompt = buildPrompt(req, catalog);
  const key = createHash("sha256")
    .update(JSON.stringify([MAPPING_PROMPT_VERSION, provider.name, provider.model, prompt]))
    .digest("hex");
  const file = cacheDir ? path.join(cacheDir, `${key}.json`) : null;

  let reply: ProviderReply | null = null;
  let parsed: Record<string, unknown> | null = null;
  let cached = false;
  let latencyMs = 0;
  if (file) {
    try {
      reply = JSON.parse(await fs.readFile(file, "utf8")) as ProviderReply;
      // A reply cached before replies were checked may be broken: it is asked again.
      parsed = replyObject(reply.text);
      cached = parsed !== null;
    } catch {
      // Not cached yet.
    }
  }
  if (!parsed) {
    const t0 = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        reply = await provider.complete(prompt.system, prompt.user, prompt.schema);
        // Checked before it is cached: a truncated or empty reply would otherwise be served
        // from the cache for good, to every later request with the same prompt.
        parsed = replyObject(reply.text);
        if (!parsed) throw new Error("the model's reply is not the JSON object asked for");
        break;
      } catch (err) {
        // A provider that knows it cannot answer (replay mode, no recorded reply) is not retried.
        if (attempt >= 3 || (err as { retryable?: boolean }).retryable === false) throw err;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    latencyMs = Date.now() - t0;
    if (file) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(reply));
    }
  }

  const choices = new Map<string, string[] | null>();
  for (const line of req.lines) {
    const allowed = new Set(lineOptions(line, catalog).map((o) => o.code));
    const raw = Array.isArray(parsed[line.id]) ? (parsed[line.id] as unknown[]) : [];
    const codes = [...new Set(raw.filter((c): c is string => typeof c === "string" && allowed.has(c)))].sort();
    choices.set(line.id, codes.length > 0 ? codes : null);
  }
  return { choices, usage: reply!.usage, latencyMs, cached };
}
