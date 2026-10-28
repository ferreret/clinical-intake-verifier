/**
 * POST /api/extract: multipart form with a `file` (PDF) and an optional `provider` (gemini or
 * local; EXTRACTOR_PROVIDER by default) and `model`.
 * Responds with a prediction (docs/extractor-contract.md). When the model call failed the
 * prediction is still returned, with `extractor.error` set, under status 502.
 *
 * Live mode only. Replay mode, the public demo, calls no model: there the route would let
 * anyone render any PDF on the server, and spend the deployment's key if it had one.
 */
import { NextResponse } from "next/server";

import { appMode } from "@/lib/batches/config";
import { ConfigError, extract, InvalidPdfError, PROVIDERS, type Provider } from "@/lib/extractor";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request): Promise<NextResponse> {
  if (appMode() !== "live") return NextResponse.json({ error: "the extractor is called in live mode only" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "send a multipart form with a 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `file exceeds ${MAX_BYTES} bytes` }, { status: 413 });
  }
  const provider = form?.get("provider");
  if (provider !== null && provider !== undefined && !(PROVIDERS as readonly unknown[]).includes(provider)) {
    return NextResponse.json({ error: `provider must be one of ${PROVIDERS.join(", ")}` }, { status: 400 });
  }
  const model = form?.get("model");
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const prediction = await extract(bytes, {
      file: file.name || undefined,
      provider: (provider as Provider | null) ?? undefined,
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
