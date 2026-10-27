/**
 * GET /api/documents/:id/proposal: what the chain proposed for the document (the extractor's
 * prediction, the fusion, each line's codes), once it is ready.
 */
import { NextResponse } from "next/server";

import { getSession, noSession } from "@/lib/batches/session";
import { getDocument, getProposal } from "@/lib/batches/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const { id } = await ctx.params;
  const doc = await getDocument(session.db, id);
  if (!doc) return NextResponse.json({ error: "no such document" }, { status: 404 });
  const proposal = await getProposal(session.db, id);
  if (!proposal) return NextResponse.json({ error: `no proposal yet; the document is ${doc.state}` }, { status: 409 });
  return NextResponse.json({ document: doc, proposal });
}
