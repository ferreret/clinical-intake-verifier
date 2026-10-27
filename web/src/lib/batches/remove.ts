/**
 * Deleting a batch: the technician clearing away a batch they no longer want, after trying
 * things out. Everything it left goes with it, in one transaction: its documents, their
 * proposals, the decisions taken on them, and the requests those approvals registered in the
 * mock LIS; then the PDFs uploaded for it. What the mapping memory learned from its
 * approvals stays: it cannot be told apart from what other approvals taught.
 *
 * A batch still being read cannot be deleted until its documents are read.
 */
import { eq, inArray } from "drizzle-orm";

import type { LisDb } from "@/lib/lis/db";
import { requests } from "@/lib/lis/schema";

import { batchDocuments, batches, decisions, proposals } from "./schema";
import { deleteUpload } from "./sources";

export type DeleteResult = { ok: true } | { ok: false; reason: "missing" | "reading" };

export async function deleteBatch(db: LisDb, id: string): Promise<DeleteResult> {
  let uploads: string[] = [];
  const result = await db.transaction(async (tx): Promise<DeleteResult> => {
    const [batch] = await tx.select({ id: batches.id }).from(batches).where(eq(batches.id, id));
    if (!batch) return { ok: false, reason: "missing" };
    const docs = await tx.select().from(batchDocuments).where(eq(batchDocuments.batchId, id));
    if (docs.some((d) => d.state === "extracting")) return { ok: false, reason: "reading" };
    const ids = docs.map((d) => d.id);
    if (ids.length > 0) {
      const taken = await tx.select({ id: decisions.id }).from(decisions).where(inArray(decisions.documentId, ids));
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
