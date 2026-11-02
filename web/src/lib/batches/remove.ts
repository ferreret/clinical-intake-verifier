/**
 * Deleting a batch: the technician clearing away a batch they no longer want, after trying
 * things out. Everything it left goes with it, in one transaction: its documents, their
 * proposals, the decisions taken on them, and the requests those approvals registered in the
 * mock LIS; then the PDFs uploaded for it. What the mapping memory learned from its
 * approvals stays: it cannot be told apart from what other approvals taught.
 *
 * A batch still being read cannot be deleted until its documents are read. In live mode, a
 * batch with an approval or a rejection cannot be deleted at all (decision of 2026-11-02):
 * there the decisions are the record of who approved what, as in a lab, and the memory's
 * learning rests on them. A sandbox of the demo is a place to try things out, so there
 * everything goes. Deleting them all leaves those that cannot go, and says how many.
 */
import { eq, inArray } from "drizzle-orm";

import type { LisDb } from "@/lib/lis/db";
import { requests } from "@/lib/lis/schema";

import { batchDocuments, batches, decisions, proposals } from "./schema";
import { appMode, type AppMode } from "./config";
import { listBatches } from "./store";
import { deleteUpload } from "./sources";

export type DeleteResult = { ok: true } | { ok: false; reason: "missing" | "reading" | "decided" };

export async function deleteBatch(db: LisDb, id: string, mode: AppMode = appMode()): Promise<DeleteResult> {
  let uploads: string[] = [];
  const result = await db.transaction(async (tx): Promise<DeleteResult> => {
    const [batch] = await tx.select({ id: batches.id }).from(batches).where(eq(batches.id, id));
    if (!batch) return { ok: false, reason: "missing" };
    const docs = await tx.select().from(batchDocuments).where(eq(batchDocuments.batchId, id));
    if (docs.some((d) => d.state === "extracting")) return { ok: false, reason: "reading" };
    const ids = docs.map((d) => d.id);
    if (ids.length > 0) {
      const taken = await tx.select({ id: decisions.id }).from(decisions).where(inArray(decisions.documentId, ids));
      if (mode === "live" && taken.length > 0) return { ok: false, reason: "decided" };
      if (taken.length > 0) await tx.delete(requests).where(inArray(requests.decisionId, taken.map((d) => d.id)));
      await tx.delete(decisions).where(inArray(decisions.documentId, ids));
      await tx.delete(proposals).where(inArray(proposals.documentId, ids));
      await tx.delete(batchDocuments).where(eq(batchDocuments.batchId, id));
    }
    await tx.delete(batches).where(eq(batches.id, id));
    uploads = docs.filter((d) => d.origin === "upload").map((d) => d.location);
    return { ok: true };
  });
  // The files go once the rows are gone; one already missing is not an error.
  for (const location of uploads) await deleteUpload(location).catch(() => undefined);
  return result;
}

/** Deletes every batch of the workspace but those still being read, and in live mode those decided on. */
export async function deleteAllBatches(
  db: LisDb,
  mode: AppMode = appMode(),
): Promise<{ deleted: number; reading: number; decided: number }> {
  let deleted = 0;
  let reading = 0;
  let decided = 0;
  for (const b of await listBatches(db)) {
    const r = await deleteBatch(db, b.id, mode);
    if (r.ok) deleted += 1;
    else if (r.reason === "reading") reading += 1;
    else if (r.reason === "decided") decided += 1;
  }
  return { deleted, reading, decided };
}
