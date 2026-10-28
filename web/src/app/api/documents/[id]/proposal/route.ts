/**
 * GET /api/documents/:id/proposal: what the chain proposed for the document (the extractor's
 * prediction, the fusion, each line's codes), once it is ready; with what the verification
 * screen needs around it:
 * - `codes`: the catalog name of every code proposed or offered as a candidate;
 * - `records`: the LIS records the document is linked to or offered as candidates, as shown;
 * - `siblings`: the batch's documents in order, for moving between them, with the pages of
 *   those ready, so that the screen can fetch the next one's ahead;
 * - `decision`: the technician's decision, once approved or rejected.
 */
import { NextResponse } from "next/server";

import { getDecision } from "@/lib/batches/decide";
import { catalogOf } from "@/lib/batches/pipeline";
import { getSession, noSession } from "@/lib/batches/session";
import { getBatch, getDocument, getProposal, summarise } from "@/lib/batches/store";
import { codeNames } from "@/lib/mapping/browse";
import { fuse } from "@/lib/fusion/fuse";
import { recordsOf } from "@/lib/lis/records";
import { readSnapshot } from "@/lib/lis/snapshot";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const { id } = await ctx.params;
  const doc = await getDocument(session.db, id);
  if (!doc) return NextResponse.json({ error: "no such document" }, { status: 404 });
  const proposal = await getProposal(session.db, id);
  if (!proposal) return NextResponse.json({ error: `no proposal yet; the document is ${doc.state}` }, { status: 409 });

  const { catalog } = await catalogOf(session.db);
  const wanted = new Set<string>();
  for (const t of proposal.tests) {
    for (const c of t.mapping.codes ?? []) wanted.add(c);
    for (const cand of t.mapping.candidates) for (const c of cand.codes) wanted.add(c);
  }
  const decision = await getDecision(session.db, id);
  for (const t of decision?.approved?.tests ?? []) for (const c of t.codes ?? []) wanted.add(c);
  const codes = codeNames(catalog, wanted);

  const lis = await readSnapshot(session.db);
  // An approval with links the technician chose is shown fused against those records.
  const chosen = decision?.approved?.chosen ?? {};
  if (Object.keys(chosen).length > 0) proposal.fused = fuse(proposal.prediction, lis, chosen);
  const records = recordsOf(proposal.fused, lis);

  const batch = await getBatch(session.db, doc.batchId);
  const docs = batch?.documents ?? [];
  const summaries = await summarise(session.db, docs.map((d) => d.id));
  const siblings = docs.map((d) => ({
    id: d.id,
    position: d.position,
    fileName: d.fileName,
    state: d.state,
    pages: summaries.get(d.id)?.pages ?? null,
  }));
  return NextResponse.json({ document: doc, batch: batch?.batch ?? null, proposal, codes, records, siblings, decision });
}

