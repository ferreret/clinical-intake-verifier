/**
 * POST /api/extract: multipart form with a `file` (PDF) and an optional `model`.
 * Responds with a prediction (docs/extractor-contract.md). When the model call failed the
 * prediction is still returned, with `extractor.error` set, under status 502.
 */
import { NextResponse } from "next/server";
import { ConfigError, extract, InvalidPdfError } from "@/lib/extractor";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "send a multipart form with a 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `file exceeds ${MAX_BYTES} bytes` }, { status: 413 });
  }
  const model = form?.get("model");
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const prediction = await extract(bytes, {
      file: file.name || undefined,
      model: typeof model === "string" && model.trim() ? model.trim() : undefined,
    });
    const status = prediction.extractor.error ? 502 : 200;
    return NextResponse.json(prediction, { status });
  } catch (err) {
    if (err instanceof InvalidPdfError) {
      return NextResponse.json({ error: `invalid PDF: ${err.message}` }, { status: 400 });
    }
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }
}
