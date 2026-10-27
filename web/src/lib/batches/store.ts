/**
 * Reading and writing batches, their documents and proposals in a workspace's database.
 */
import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { LisDb } from "@/lib/lis/db";

import type { Provider } from "./config";
import { batchDocuments, batches, DOCUMENT_STATES, proposals, type DocumentState } from "./schema";

export type Batch = typeof batches.$inferSelect;
export type BatchDocument = typeof batchDocuments.$inferSelect;
export type StoredProposal = typeof proposals.$inferSelect;

export interface NewDocument {
  fileName: string;
  sha256: string;
  origin: "bundled" | "upload";
  location: string;
}

/** A batch with how many of its documents are in each state: its derived state. */
export interface BatchSummary extends Batch {
  documents: number;
  states: Record<DocumentState, number>;
}

const now = () => new Date().toISOString();

export async function createBatch(
  db: LisDb,
  input: { name: string; provider: Provider; createdBy: string; documents: NewDocument[] },
): Promise<Batch> {
  if (input.documents.length === 0) throw new Error("a batch needs at least one document");
  const at = now();
  const batch: Batch = { id: randomUUID(), name: input.name, provider: input.provider, createdBy: input.createdBy, createdAt: at };
  await db.transaction(async (tx) => {
    await tx.insert(batches).values(batch);
    await tx.insert(batchDocuments).values(
      input.documents.map((d, i) => ({
        id: randomUUID(),
        batchId: batch.id,
        position: i + 1,
        ...d,
        state: "queued" as const,
        createdAt: at,
        updatedAt: at,
      })),
    );
  });
  return batch;
}

function emptyStates(): Record<DocumentState, number> {
  return Object.fromEntries(DOCUMENT_STATES.map((s) => [s, 0])) as Record<DocumentState, number>;
}

/** Every batch, newest first, with its documents counted by state. */
export async function listBatches(db: LisDb): Promise<BatchSummary[]> {
  const rows = await db.select().from(batches).orderBy(desc(batches.createdAt));
  const counts = await db
    .select({ batchId: batchDocuments.batchId, state: batchDocuments.state, n: sql<number>`count(*)` })
    .from(batchDocuments)
    .groupBy(batchDocuments.batchId, batchDocuments.state);
  return rows.map((b) => {
    const states = emptyStates();
    for (const c of counts) if (c.batchId === b.id) states[c.state] = Number(c.n);
    return { ...b, documents: Object.values(states).reduce((a, n) => a + n, 0), states };
  });
}

export async function getBatch(db: LisDb, id: string): Promise<{ batch: Batch; documents: BatchDocument[] } | null> {
  const [batch] = await db.select().from(batches).where(eq(batches.id, id));
  if (!batch) return null;
  const documents = await db
    .select()
    .from(batchDocuments)
    .where(eq(batchDocuments.batchId, id))
    .orderBy(asc(batchDocuments.position));
  return { batch, documents };
}

export async function getDocument(db: LisDb, id: string): Promise<BatchDocument | null> {
  const [doc] = await db.select().from(batchDocuments).where(eq(batchDocuments.id, id));
  return doc ?? null;
}

export async function getProposal(db: LisDb, documentId: string): Promise<StoredProposal | null> {
  const [p] = await db.select().from(proposals).where(eq(proposals.documentId, documentId));
  return p ?? null;
}

/**
 * Takes the oldest queued document whose batch reads with one of `providers`, and marks it
 * extracting. The queue is the only caller, in one process, so no two calls race.
 */
export async function claimNext(db: LisDb, providers: Provider[]): Promise<(BatchDocument & { provider: Provider }) | null> {
  if (providers.length === 0) return null;
  const [next] = await db
    .select({ doc: batchDocuments, provider: batches.provider })
    .from(batchDocuments)
    .innerJoin(batches, eq(batches.id, batchDocuments.batchId))
    .where(and(eq(batchDocuments.state, "queued"), inArray(batches.provider, providers)))
    .orderBy(asc(batches.createdAt), asc(batchDocuments.position))
    .limit(1);
  if (!next) return null;
  const update = { state: "extracting" as const, attempts: next.doc.attempts + 1, error: null, updatedAt: now() };
  await db.update(batchDocuments).set(update).where(eq(batchDocuments.id, next.doc.id));
  return { ...next.doc, ...update, provider: next.provider };
}

export async function hasQueued(db: LisDb): Promise<boolean> {
  const [row] = await db.select({ id: batchDocuments.id }).from(batchDocuments).where(eq(batchDocuments.state, "queued")).limit(1);
  return row !== undefined;
}

/** The proposal is stored and the document waits for a technician. */
export async function completeDocument(db: LisDb, id: string, proposal: Omit<StoredProposal, "documentId" | "createdAt">): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(proposals).where(eq(proposals.documentId, id));
    await tx.insert(proposals).values({ documentId: id, ...proposal, createdAt: now() });
    await tx.update(batchDocuments).set({ state: "awaiting_verification", updatedAt: now() }).where(eq(batchDocuments.id, id));
  });
}

export async function failDocument(db: LisDb, id: string, error: string): Promise<void> {
  await db.update(batchDocuments).set({ state: "failed", error, updatedAt: now() }).where(eq(batchDocuments.id, id));
}

/** A failed document goes back to the queue; returns false when it had not failed. */
export async function retryDocument(db: LisDb, id: string): Promise<boolean> {
  const done = await db
    .update(batchDocuments)
    .set({ state: "queued", updatedAt: now() })
    .where(and(eq(batchDocuments.id, id), eq(batchDocuments.state, "failed")))
    .returning({ id: batchDocuments.id });
  return done.length > 0;
}

/** Documents left extracting when the server stopped go back to the queue. */
export async function requeueInterrupted(db: LisDb): Promise<number> {
  const done = await db
    .update(batchDocuments)
    .set({ state: "queued", updatedAt: now() })
    .where(eq(batchDocuments.state, "extracting"))
    .returning({ id: batchDocuments.id });
  return done.length;
}
