/**
 * The OCR server (`intake-ocr serve`, docs/ocr.md): the text pipeline's OCR read where the
 * models run, the AI box, not by the application that sends the document. The PDF is posted
 * and its OCR document (schema/ocr.schema.json) comes back, as a prompt goes to LM Studio.
 *
 * OCR_URL names the server (`http://127.0.0.1:8765` on the development machine); OCR_ENGINE
 * the engine (rapidocr by default), OCR_CHECKBOXES=1 asks for checkboxes, OCR_TOKEN is the
 * bearer token the server wants, if any.
 */
import http from "node:http";
import https from "node:https";
import { validateOcrDocument, type OcrDocument } from "./ocr-text";

export const DEFAULT_OCR_ENGINE = "rapidocr";

export interface OcrServer {
  url: string;
  engine: string;
  checkboxes: boolean;
  dpi?: number;
  token?: string;
}

export class OcrServerError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OcrServerError";
    this.status = status;
  }

  /** A server that is down or failed is worth another try; a refused request is not. */
  get retryable(): boolean {
    return this.status === undefined || this.status >= 500;
  }
}

/** The server OCR_URL names, or null when it names none. */
export function resolveOcrServer(): OcrServer | null {
  const url = process.env.OCR_URL?.trim();
  if (!url) return null;
  return {
    url,
    engine: process.env.OCR_ENGINE?.trim() || DEFAULT_OCR_ENGINE,
    checkboxes: /^(1|true)$/i.test(process.env.OCR_CHECKBOXES?.trim() ?? ""),
    token: process.env.OCR_TOKEN?.trim() || undefined,
  };
}

/** Ten minutes: a long scanned document on a busy CPU; this only catches a server that hangs. */
const TIMEOUT_MS = 10 * 60 * 1000;

function request(
  method: "GET" | "POST",
  target: URL,
  token: string | undefined,
  body: Uint8Array | null,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  const client = target.protocol === "https:" ? https : http;
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/pdf";
  if (body) headers["Content-Length"] = String(body.byteLength);
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const req = client.request(target, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no reply within ${Math.round(timeoutMs / 1000)} s`)));
    req.on("error", reject);
    req.end(body ? Buffer.from(body) : undefined);
  });
}

function errorOf(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // not JSON: the text itself, cut short
  }
  return text.slice(0, 300);
}

/** The OCR document of `pdf`, read by the server's engine. */
export async function requestOcr(server: OcrServer, pdf: Uint8Array, timeoutMs = TIMEOUT_MS): Promise<OcrDocument> {
  const target = new URL("ocr", server.url.endsWith("/") ? server.url : `${server.url}/`);
  target.searchParams.set("engine", server.engine);
  target.searchParams.set("checkboxes", server.checkboxes ? "1" : "0");
  if (server.dpi !== undefined) target.searchParams.set("dpi", String(server.dpi));
  let res;
  try {
    res = await request("POST", target, server.token, pdf, timeoutMs);
  } catch (err) {
    throw new OcrServerError(`OCR server at ${server.url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new OcrServerError(`OCR server: HTTP ${res.status} ${errorOf(res.status, res.text)}`, res.status);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(res.text);
  } catch {
    throw new OcrServerError(`OCR server: the reply is not JSON: ${res.text.slice(0, 200)}`, res.status);
  }
  const errors = validateOcrDocument(doc);
  if (errors.length > 0) {
    throw new OcrServerError(`OCR server: the reply is not an OCR document: ${errors.slice(0, 3).join("; ")}`, res.status);
  }
  return doc as OcrDocument;
}

/** What GET /health says: the engines it serves. Throws when the server cannot be reached. */
export async function ocrServerHealth(server: OcrServer): Promise<{ engines: string[]; loaded: Record<string, string> }> {
  const target = new URL("health", server.url.endsWith("/") ? server.url : `${server.url}/`);
  let res;
  try {
    res = await request("GET", target, server.token, null, 10_000);
  } catch (err) {
    throw new OcrServerError(`OCR server at ${server.url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status !== 200) throw new OcrServerError(`OCR server: HTTP ${res.status} ${errorOf(res.status, res.text)}`, res.status);
  return JSON.parse(res.text) as { engines: string[]; loaded: Record<string, string> };
}
