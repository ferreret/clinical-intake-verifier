/**
 * POST /api/documents/:id/fusion: the document fused again with links the technician set by
 * searching the records, `{ "links": { "patient": "P123" | null, … } }` (null: no record, a
 * new one). Nothing is stored: the links count when the document is approved with them.
 * Returns the fusion and the records it shows.
 */
import { NextResponse } from "next/server";

import { jsonBody, tooLarge } from "@/lib/http";

import { getSession, noSession } from "@/lib/batches/session";
import { getProposal } from "@/lib/batches/store";
import { fuse } from "@/lib/fusion/fuse";
import { parseChosenLinks } from "@/lib/fusion/link";
import { recordsOf } from "@/lib/lis/records";
import { readSnapshot } from "@/lib/lis/snapshot";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const read = await jsonBody(req);
  if ("tooLarge" in read) return tooLarge();
  const body = (read.body ?? {}) as { links?: unknown };
  const links = parseChosenLinks(body.links);
  if (!links) return NextResponse.json({ error: "expected { links: { patient|physician|insurer: id or null } }" }, { status: 400 });
  const proposal = await getProposal(session.db, (await ctx.params).id);
  if (!proposal) return NextResponse.json({ error: "no proposal for this document" }, { status: 404 });
  const lis = await readSnapshot(session.db);
  const fused = fuse(proposal.prediction, lis, links);
  return NextResponse.json({ fused, records: recordsOf(fused, lis) });
}
