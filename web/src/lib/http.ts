/**
 * Reading the small JSON bodies the routes take (approve, reject, open, relink, session).
 *
 * They are read in chunks and given up past MAX_JSON_BYTES, whatever length the request
 * declares, so that nobody can make the server buffer a huge body; an approval with every
 * field and line is a few kilobytes.
 */
import { NextResponse } from "next/server";

export const MAX_JSON_BYTES = 256 * 1024;

/**
 * The body as a JSON object: null when there is none, it is not JSON, or it is not an object
 * (a body of `null` included); `tooLarge` past `max` bytes.
 */
export async function jsonBody(req: Request, max = MAX_JSON_BYTES): Promise<{ body: Record<string, unknown> | null } | { tooLarge: true }> {
  const reader = req.body?.getReader();
  if (!reader) return { body: null };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { body: parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null };
  } catch {
    return { body: null };
  }
}

export const tooLarge = (max = MAX_JSON_BYTES) => NextResponse.json({ error: `send at most ${max} bytes` }, { status: 413 });
