/**
 * GET /api/batches/:id: the batch and its documents, in order, with their states; a ready
 * document also has its summary (who read it, in how long, its fields and lines by colour).
 * DELETE /api/batches/:id: deletes the batch and everything it left (lib/batches/remove.ts);
 * 409 while a document is being read.
 */
import { NextResponse } from "next/server";

import { getSession, noSession } from "@/lib/batches/session";
import { deleteBatch } from "@/lib/batches/remove";
import { getBatch, summarise } from "@/lib/batches/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const found = await getBatch(session.db, (await ctx.params).id);
  if (!found) return NextResponse.json({ error: "no such batch" }, { status: 404 });
  const summaries = await summarise(session.db, found.documents.map((d) => d.id));
  return NextResponse.json({
    batch: found.batch,
    documents: found.documents.map((d) => ({ ...d, summary: summaries.get(d.id) ?? null })),
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const result = await deleteBatch(session.db, (await ctx.params).id);
  if (result.ok) return NextResponse.json({ deleted: true });
  if (result.reason === "missing") return NextResponse.json({ error: "no such batch" }, { status: 404 });
  return NextResponse.json({ error: "a document is being read; delete the batch once it is read" }, { status: 409 });
}
