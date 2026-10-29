/**
 * GET /api/batches: the workspace's batches, newest first, with their documents counted by
 * state.
 * DELETE /api/batches: deletes every batch but those still being read (lib/batches/remove.ts);
 * returns how many went and how many are still being read.
 * POST /api/batches: creates a batch and queues its documents. JSON
 * `{ "provider": "gemini", "name": "…", "documents": ["synth-000003.pdf", …] }` with bundled
 * documents; in live mode, also a multipart form with `provider`, `name`, `documents`
 * (repeated) and PDF `files` (repeated), which can be mixed.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { cleanName } from "@/lib/http";

import { appMode, maxSandboxDocuments, type Provider } from "@/lib/batches/config";
import { queue } from "@/lib/batches/queue";
import { deleteAllBatches } from "@/lib/batches/remove";
import { PROVIDERS } from "@/lib/batches/schema";
import { getSession, noSession } from "@/lib/batches/session";
import { deleteUpload, listBundled, readBundled, saveUpload } from "@/lib/batches/sources";
import { countReading, createBatch, listBatches, releaseExpiredLocks, TooManyDocuments, TooManyReading, type NewDocument } from "@/lib/batches/store";
import { looksLikePdf, readPages, sha256Hex } from "@/lib/extractor/pdf";

import { LANG_COOKIE } from "../../_ui/lang";

export const runtime = "nodejs";

const MAX_DOCUMENTS = 50;
const MAX_BYTES = 20 * 1024 * 1024;
/** Documents a sandbox may have queued or being read at once, so that one visitor cannot hold up the queue. */
const MAX_READING = 100;
/** Uploads of one batch together: the whole request is held in memory while it is read. */
const MAX_UPLOADS = 100 * 1024 * 1024;
/** A request's size, checked before it is read: bundled names only in replay mode, or uploads too in live mode. */
const MAX_BODY = { replay: 64 * 1024, live: MAX_UPLOADS + 1024 * 1024 };

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  await releaseExpiredLocks(session.db);
  return NextResponse.json({ batches: await listBatches(session.db) });
}

export async function DELETE(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  return NextResponse.json(await deleteAllBatches(session.db));
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const mode = appMode();
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!(length <= MAX_BODY[mode])) return NextResponse.json({ error: `send at most ${MAX_BODY[mode]} bytes, with their length` }, { status: 413 });

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

  if ((await countReading(session.db)) + bundled.length + files.length > MAX_READING) {
    return NextResponse.json({ error: `at most ${MAX_READING} documents queued or being read at once: wait for some to be read` }, { status: 429 });
  }

  const documents: NewDocument[] = [];
  for (const d of bundled as string[]) {
    documents.push({ fileName: d, sha256: sha256Hex(new Uint8Array(await readBundled(d))), origin: "bundled", location: d });
  }
  // Every upload is checked before any is saved: one refused would otherwise leave the others
  // stored with no batch, where nothing can delete them, and they may be real documents.
  const uploads: { name: string; pdf: Uint8Array }[] = [];
  for (const f of files) {
    // The name as stored and shown: the file's own, without a path or characters that hide it.
    const fileName = cleanName(f.name.split(/[\\/]/).at(-1) ?? "", 200) || "upload.pdf";
    if (f.size > MAX_BYTES) return bad(`${fileName} exceeds ${MAX_BYTES} bytes`);
    const pdf = new Uint8Array(await f.arrayBuffer());
    if (!looksLikePdf(pdf)) return bad(`${fileName} is not a PDF`);
    // Opened, not only its first bytes looked at: one that cannot be read would only fail later,
    // in the queue and in the viewer.
    const pages = await readPages(pdf).catch(() => []);
    if (pages.length === 0) return bad(`${fileName} is not a PDF that can be read`);
    uploads.push({ name: fileName, pdf });
  }
  for (const u of uploads) {
    documents.push({ fileName: u.name, sha256: sha256Hex(u.pdf), origin: "upload", location: await saveUpload(u.pdf) });
  }

  const count = (await listBatches(session.db)).length;
  // An unnamed batch is numbered, in the visitor's language.
  const word = (await cookies()).get(LANG_COOKIE)?.value === "es" ? "Lote" : "Batch";
  let batch;
  try {
    batch = await createBatch(session.db, {
      name: (typeof name === "string" && cleanName(name, 100)) || `${word} ${count + 1}`,
      provider: provider as Provider,
      createdBy: session.technician.id,
      documents,
      // Counted again with the batch's insert: the count above only spares the reading of
      // files when the workspace is already full; several batches at once all passed it.
      maxReading: MAX_READING,
      // A sandbox is a visitor's, kept for a day: what it holds is capped, a script looping
      // over "create, wait" would otherwise fill the volume. The live workspace is the lab's.
      maxDocuments: mode === "replay" ? maxSandboxDocuments() : undefined,
    });
  } catch (err) {
    if (!(err instanceof TooManyReading || err instanceof TooManyDocuments)) throw err;
    for (const d of documents) if (d.origin === "upload") await deleteUpload(d.location).catch(() => undefined);
    return NextResponse.json({ error: err.message }, { status: 429 });
  }
  queue().kick(session.workspace);
  return NextResponse.json({ batch }, { status: 201 });
}
