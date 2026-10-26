/**
 * The single place that talks to a local vision model: a model behind an OpenAI-compatible
 * chat API, such as LM Studio's server with Qwen loaded.
 *
 * Sends one PNG per page with the system instruction and returns the raw text and usage, like
 * gemini.ts. Unlike Gemini the reply is not constrained by the server: in the manual check of
 * 2026-10-26 a JSON schema enforced while decoding left the values intact but made the boxes
 * far worse. The schema goes in the instruction instead, and the reply is validated as
 * Gemini's is.
 */
import http from "node:http";
import https from "node:https";
import type { Usage } from "@/lib/schema/prediction";

export const DEFAULT_LOCAL_MODEL = "qwen/qwen3.6-35b-a3b";
export const DEFAULT_LOCAL_URL = "http://127.0.0.1:1234/v1";

/** A long document takes minutes on a laptop GPU; this only catches a server that hangs. */
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export function resolveLocalModel(): string {
  return process.env.LOCAL_LLM_MODEL?.trim() || DEFAULT_LOCAL_MODEL;
}

export function resolveLocalUrl(): string {
  return process.env.LOCAL_LLM_URL?.trim() || DEFAULT_LOCAL_URL;
}

export interface LocalRequest {
  baseUrl: string;
  model: string;
  /** One PNG per page, in page order. */
  pages: Uint8Array[];
  systemInstruction: string;
  userMessage: string;
  temperature: number;
  timeoutMs?: number;
}

export interface LocalReply {
  text: string;
  modelVersion: string | null;
  usage: Usage;
}

export class LocalModelError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "LocalModelError";
    this.status = status;
  }

  /** A server that is down or overloaded is worth one more try; a rejected request is not. */
  get retryable(): boolean {
    return this.status === undefined || this.status >= 500;
  }
}

/**
 * POST without fetch: Node's fetch gives up when response headers take more than five
 * minutes, and a server that does not stream sends them only when the whole reply is ready.
 */
function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; text: string }> {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(target, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no reply within ${Math.round(timeoutMs / 1000)} s`)));
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

/** The JSON inside a reply, without the markdown fence some models wrap it in. */
export function stripFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return m ? m[1] : text;
}

export async function callLocal(req: LocalRequest): Promise<LocalReply> {
  const content = [
    ...req.pages.map((png) => ({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${Buffer.from(png).toString("base64")}` },
    })),
    { type: "text", text: req.userMessage },
  ];
  const body = {
    model: req.model,
    messages: [
      { role: "system", content: req.systemInstruction },
      { role: "user", content },
    ],
    temperature: req.temperature,
    max_tokens: 8192,
    // Reasoning multiplies the latency of a local model tenfold and did not change the values.
    reasoning_effort: "none",
  };

  let res;
  try {
    res = await postJson(`${req.baseUrl}/chat/completions`, body, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (err) {
    throw new LocalModelError(`local model at ${req.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new LocalModelError(`local model: HTTP ${res.status} ${res.text.slice(0, 300)}`, res.status);
  }

  let reply: {
    model?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  try {
    reply = JSON.parse(res.text);
  } catch {
    throw new LocalModelError(`local model: response is not JSON: ${res.text.slice(0, 300)}`, res.status);
  }
  const choice = reply.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || text.trim() === "") {
    throw new LocalModelError(`empty response (finish_reason=${choice?.finish_reason ?? "unknown"})`);
  }
  return {
    text: stripFence(text),
    modelVersion: reply.model ?? null,
    usage: {
      input_tokens: reply.usage?.prompt_tokens ?? null,
      output_tokens: reply.usage?.completion_tokens ?? null,
      thinking_tokens: reply.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    },
  };
}
