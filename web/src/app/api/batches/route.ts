/**
 * GET /api/batches: the workspace's batches, newest first, with their documents counted by
 * state.
 * POST /api/batches: creates a batch and queues its documents. JSON
 * `{ "provider": "gemini", "name": "…", "documents": ["synth-000003.pdf", …] }` with bundled
 * documents; in live mode, also a multipart form with `provider`, `name`, `documents`
 * (repeated) and PDF `files` (repeated), which can be mixed.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { appMode, type Provider } from "@/lib/batches/config";
import { queue } from "@/lib/batches/queue";
import { PROVIDERS } from "@/lib/batches/schema";
import { getSession, noSession } from "@/lib/batches/session";
import { listBundled, readBundled, saveUpload } from "@/lib/batches/sources";
import { createBatch, listBatches, type NewDocument } from "@/lib/batches/store";
import { looksLikePdf, sha256Hex } from "@/lib/extractor/pdf";

import { LANG_COOKIE } from "../../_ui/lang";

export const runtime = "nodejs";

const MAX_DOCUMENTS = 50;
const MAX_BYTES = 20 * 1024 * 1024;

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  return NextResponse.json({ batches: await listBatches(session.db) });
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const mode = appMode();

  let provider: unknown;
  let name: unknown;
  let bundled: unknown[] = [];
  let files: File[] = [];
  if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return bad("unreadable form");
    provider = form.get("provider");
    name = form.get("name");
    bundled = form.getAll("documents");
    files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length > 0 && mode !== "live") return bad("uploads are accepted in live mode only");
  } else {
    const body = (await req.json().catch(() => null)) as { provider?: unknown; name?: unknown; documents?: unknown } | null;
    if (!body) return bad("send JSON or a multipart form");
    ({ provider, name } = body);
    bundled = Array.isArray(body.documents) ? body.documents : [];
  }

  if (typeof provider !== "string" || !(PROVIDERS as readonly string[]).includes(provider)) {
    return bad(`provider must be one of ${PROVIDERS.join(", ")}`);
  }
  if (bundled.length + files.length === 0) return bad("a batch needs at least one document");
  if (bundled.length + files.length > MAX_DOCUMENTS) return bad(`at most ${MAX_DOCUMENTS} documents per batch`);
  const available = new Set(await listBundled(mode === "replay" ? (provider as Provider) : null));
  const unknown = bundled.filter((d) => typeof d !== "string" || !available.has(d));
  if (unknown.length > 0) return bad(`not available for ${provider}: ${unknown.map(String).join(", ")}`);

  const documents: NewDocument[] = [];
  for (const d of bundled as string[]) {
    documents.push({ fileName: d, sha256: sha256Hex(new Uint8Array(await readBundled(d))), origin: "bundled", location: d });
  }
  for (const f of files) {
    if (f.size > MAX_BYTES) return bad(`${f.name} exceeds ${MAX_BYTES} bytes`);
    const pdf = new Uint8Array(await f.arrayBuffer());
    if (!looksLikePdf(pdf)) return bad(`${f.name} is not a PDF`);
    documents.push({ fileName: f.name || "upload.pdf", sha256: sha256Hex(pdf), origin: "upload", location: await saveUpload(pdf) });
  }

  const count = (await listBatches(session.db)).length;
  // An unnamed batch is numbered, in the visitor's language.
  const word = (await cookies()).get(LANG_COOKIE)?.value === "es" ? "Lote" : "Batch";
  const batch = await createBatch(session.db, {
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : `${word} ${count + 1}`,
    provider: provider as Provider,
    createdBy: session.technician.id,
    documents,
  });
  queue().kick(session.workspace);
  return NextResponse.json({ batch }, { status: 201 });
}
