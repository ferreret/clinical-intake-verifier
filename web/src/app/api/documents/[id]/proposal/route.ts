/**
 * GET /api/documents/:id/proposal: what the chain proposed for the document (the extractor's
 * prediction, the fusion, each line's codes), once it is ready; with what the verification
 * screen needs around it:
 * - `codes`: the catalog name of every code proposed or offered as a candidate;
 * - `records`: the LIS records the document is linked to or offered as candidates, as shown;
 * - `siblings`: the batch's documents in order, for moving between them.
 */
import { NextResponse } from "next/server";

import { catalogOf } from "@/lib/batches/pipeline";
import { getSession, noSession } from "@/lib/batches/session";
import { getBatch, getDocument, getProposal } from "@/lib/batches/store";
import { codeNames } from "@/lib/mapping/browse";
import { readSnapshot } from "@/lib/lis/snapshot";

export const runtime = "nodejs";

export interface RecordView {
  id: string;
  title: string;
  detail: string;
}

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
  const codes = codeNames(catalog, wanted);

  const lis = await readSnapshot(session.db);
  const ids = new Set<string>();
  for (const link of Object.values(proposal.fused.links)) {
    if (link.recordId) ids.add(link.recordId);
    for (const c of link.candidates) ids.add(c);
  }
  const records: Record<string, RecordView> = {};
  for (const p of lis.patients) {
    if (ids.has(p.id)) {
      records[p.id] = { id: p.id, title: `${p.firstName} ${p.lastName1} ${p.lastName2}`, detail: `${p.docId} · born ${p.birthDate}` };
    }
  }
  for (const m of lis.physicians) {
    if (ids.has(m.id)) records[m.id] = { id: m.id, title: `${m.firstName} ${m.lastName1} ${m.lastName2}`, detail: `No. ${m.colegiado}` };
  }
  for (const i of lis.insurers) if (ids.has(i.id)) records[i.id] = { id: i.id, title: i.name, detail: i.id };

  const batch = await getBatch(session.db, doc.batchId);
  const siblings = (batch?.documents ?? []).map((d) => ({ id: d.id, position: d.position, fileName: d.fileName, state: d.state }));
  return NextResponse.json({ document: doc, batch: batch?.batch ?? null, proposal, codes, records, siblings });
}
