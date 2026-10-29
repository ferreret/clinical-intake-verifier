/**
 * A technician's decision on a document (F5 block 4): approving it or rejecting it.
 *
 * Approving checks what the technician sends against the proposal (roadmap, F4 decision 9):
 * every red or orange field and line resolved one by one, by changing it or confirming it;
 * green ones are covered by the approval itself; required fields filled; every kept line with
 * codes from the catalog. Then, in one transaction:
 *   - the decision, written once: who, when, and exactly what was approved and how;
 *   - the request in the mock LIS, with its values and codes;
 *   - the memory of approved mappings, taught the approved lines (only approved requests
 *     teach it): a green line approved as it was counts as passive, one confirmed or chosen
 *     as active, and a replaced proposal as a correction;
 *   - the document, approved, its lock released.
 *
 * Rejecting records why, and keeps the document and its proposal as they were.
 */
import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { fuse } from "@/lib/fusion/fuse";
import { unknownChosen } from "@/lib/fusion/link";
import type { ChosenLinks, TrafficLight } from "@/lib/fusion/types";
import type { LisDb } from "@/lib/lis/db";
import { requests } from "@/lib/lis/schema";
import { readSnapshot } from "@/lib/lis/snapshot";
import { DbMemory } from "@/lib/mapping/memory";
import { textKey } from "@/lib/mapping/propose";
import { FIELDS, inForm, TESTS } from "@/lib/schema/fields";

import { catalogOf, memoryScope } from "./pipeline";
import { batchDocuments, decisions, type ApprovalRecord, type FieldAction, type LineAction } from "./schema";
import { getDocument, getProposal, type BatchDocument, type StoredProposal } from "./store";

/** What the screen sends to approve a document. */
export interface ApprovalInput {
  /** Each field's value, by field name; null or "" for none. */
  fields: Record<string, string | null>;
  /** Each read line, in order: its codes, or null when the technician dropped it. */
  lines: (string[] | null)[];
  /** Tests the reading missed, added by the technician. */
  added: { text: string; codes: string[] }[];
  /** The red and orange items the technician confirmed as proposed: `f:<field>`, `t:<line>`. */
  confirmed: string[];
  /** Links the technician set by searching the records: the fields are checked against them. */
  links?: ChosenLinks;
}

export type Decision = typeof decisions.$inferSelect;

export const REJECT_REASONS = ["illegible", "not_a_request", "duplicate", "other"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

const clean = (v: string | null | undefined) => (v ?? "").trim();
const setKey = (codes: string[] | null) => (codes ? [...new Set(codes)].sort().join(",") : "");
const needs = (state: TrafficLight | null) => state === "red" || state === "orange";

/** Why the input cannot be approved as it is; empty when it can. Also the approval it makes. */
export function checkApproval(
  proposal: Pick<StoredProposal, "fused" | "tests">,
  input: ApprovalInput,
  catalog: Set<string>,
): { problems: string[]; record: ApprovalRecord } {
  const problems: string[] = [];
  const confirmed = new Set(input.confirmed);
  const fused = new Map(proposal.fused.fields.map((f) => [f.name, f]));

  const fields = FIELDS.map((spec) => {
    const f = fused.get(spec.name)!;
    const value = clean(input.fields[spec.name]) || null;
    const proposed = clean(f.value) || null;
    const changed = value !== proposed;
    if (spec.required && !value) problems.push(`${spec.name} is required`);
    if (value && !inForm(spec, value)) problems.push(`${spec.name} is not in its form: ${value}`);
    // An empty value is nothing to confirm: a red field with none (its sources disagree) is
    // settled by choosing one of them or typing one.
    if (needs(f.state) && !changed && !value && !spec.required) problems.push(`${spec.name} is ${f.state} with no value: choose or type one`);
    else if (needs(f.state) && !changed && !confirmed.has(`f:${spec.name}`)) problems.push(`${spec.name} is ${f.state}: change or confirm it`);
    const action: FieldAction = changed ? "changed" : needs(f.state) ? "confirmed" : "kept";
    return { name: spec.name, value, proposed, state: f.state, action };
  });

  if (input.lines.length !== proposal.tests.length) problems.push(`expected ${proposal.tests.length} read lines, got ${input.lines.length}`);
  const unknown = (codes: string[]) => codes.filter((c) => !catalog.has(c));
  const tests: ApprovalRecord["tests"] = proposal.tests.map((t, i) => {
    const codes = input.lines[i] === undefined ? [] : input.lines[i];
    const m = t.mapping;
    const base = { text: t.text, page: t.page, proposed: m.codes, state: m.state };
    if (codes === null) return { ...base, codes: null, action: "dropped" as const };
    const line = `line ${i + 1} (${t.text})`;
    if (codes.length === 0) problems.push(`${line} has no codes`);
    if (unknown(codes).length > 0) problems.push(`${line}: not in the catalog: ${unknown(codes).join(", ")}`);
    const same = m.codes !== null && setKey(codes) === setKey(m.codes);
    if (needs(m.state) && same && !confirmed.has(`t:${i}`)) problems.push(`${line} is ${m.state}: change or confirm it`);
    const action: LineAction = !same ? (m.codes ? "corrected" : "chosen") : needs(m.state) ? "confirmed" : "kept";
    return { ...base, codes: [...new Set(codes)], action };
  });
  for (const [i, a] of input.added.entries()) {
    if (a.codes.length === 0) problems.push(`added test ${i + 1} has no codes`);
    if (unknown(a.codes).length > 0) problems.push(`added test ${i + 1}: not in the catalog: ${unknown(a.codes).join(", ")}`);
    tests.push({ text: clean(a.text), page: null, proposed: null, state: null, codes: [...new Set(a.codes)], action: "added" });
  }
  if (TESTS.required && tests.every((t) => t.action === "dropped")) problems.push("a request needs at least one test: keep or add one");

  const linked = (k: "patient" | "physician" | "insurer") => {
    const l = proposal.fused.links[k];
    return l.status === "linked" ? l.recordId : null;
  };
  return {
    problems,
    record: {
      links: { patient: linked("patient"), physician: linked("physician"), insurer: linked("insurer") },
      chosen: input.links ?? {},
      fields,
      tests,
    },
  };
}

export type DecideResult =
  | { ok: true; decision: Decision; next: string | null }
  | { ok: false; reason: "missing" | "not_yours" | "invalid"; problems?: string[]; document?: BatchDocument };

/** The document is this technician's to decide on: in verification and locked to them. */
async function decidable(db: LisDb, id: string, technician: string) {
  const doc = await getDocument(db, id);
  if (!doc) return { error: { ok: false, reason: "missing" } as const };
  if (doc.state !== "in_verification" || doc.lockedBy !== technician) {
    return { error: { ok: false, reason: "not_yours", document: doc } as const };
  }
  return { doc };
}

/**
 * The batch's next document still to decide on, after this one, wrapping round: first one
 * nobody has open or this technician has; else one another technician has open, which the
 * screen shows read-only, offering to take it over. A lock is never left behind silently.
 */
async function nextToVerify(db: LisDb, doc: BatchDocument, technician: string): Promise<string | null> {
  const open = await db
    .select({ id: batchDocuments.id, position: batchDocuments.position, state: batchDocuments.state, lockedBy: batchDocuments.lockedBy })
    .from(batchDocuments)
    .where(and(eq(batchDocuments.batchId, doc.batchId), inArray(batchDocuments.state, ["awaiting_verification", "in_verification"])))
    .orderBy(asc(batchDocuments.position));
  const after = [...open.filter((d) => d.position > doc.position), ...open.filter((d) => d.position < doc.position)];
  const free = (d: (typeof open)[number]) => d.state === "awaiting_verification" || d.lockedBy === technician;
  return (after.find(free) ?? after[0])?.id ?? null;
}

/** Moves a document from in verification to its decision; false if it was not this technician's any more. */
async function close(tx: Pick<LisDb, "update">, id: string, technician: string, state: "approved" | "rejected", at: string) {
  const done = await tx
    .update(batchDocuments)
    .set({ state, lockedBy: null, lockedAt: null, updatedAt: at })
    .where(and(eq(batchDocuments.id, id), eq(batchDocuments.state, "in_verification"), eq(batchDocuments.lockedBy, technician)))
    .returning({ id: batchDocuments.id });
  return done.length > 0;
}

class Superseded extends Error {}

export async function approveDocument(db: LisDb, id: string, technician: string, input: ApprovalInput): Promise<DecideResult> {
  const found = await decidable(db, id, technician);
  if (found.error) return found.error;
  const doc = found.doc;
  const stored = await getProposal(db, id);
  if (!stored) return { ok: false, reason: "missing" };
  // With links the technician chose, the fields are checked against those records.
  const chosen = input.links ?? {};
  const lis = Object.keys(chosen).length > 0 ? await readSnapshot(db) : null;
  const unknown = lis ? unknownChosen(chosen, lis) : [];
  if (unknown.length > 0) return { ok: false, reason: "invalid", problems: unknown.map((u) => `the chosen ${u} is not a record of its kind`) };
  const proposal = lis ? { ...stored, fused: fuse(stored.prediction, lis, chosen) } : stored;
  const { catalog } = await catalogOf(db);
  const { problems, record } = checkApproval(proposal, input, new Set(catalog.tests.map((t) => t.code)));
  if (problems.length > 0) return { ok: false, reason: "invalid", problems };

  const at = new Date().toISOString();
  const decision: Decision = { id: randomUUID(), documentId: id, decision: "approved", technician, at, approved: record, reason: null };
  const scope = memoryScope(proposal.fused, proposal.prediction);
  try {
    await db.transaction(async (tx) => {
      if (!(await close(tx, id, technician, "approved", at))) throw new Superseded();
      await tx.insert(decisions).values(decision);
      await tx.insert(requests).values({
        id: randomUUID(),
        decisionId: decision.id,
        patientId: record.links.patient,
        physicianId: record.links.physician,
        insurerId: record.links.insurer,
        fields: Object.fromEntries(record.fields.map((f) => [f.name, f.value])),
        tests: record.tests.filter((t) => t.codes !== null).map((t) => ({ text: t.text, codes: t.codes! })),
        createdAt: at,
      });
      // The transaction has the database's own methods; the memory writes with it, so that
      // it learns only if the approval is recorded.
      const memory = new DbMemory(tx as unknown as LisDb);
      for (const t of record.tests) {
        if (t.action === "dropped" || t.action === "added") continue;
        const key = textKey(t.text);
        if (t.action === "corrected") await memory.correct(scope, key, t.proposed!);
        await memory.approve(scope, key, t.codes!, t.action === "kept" && t.state === "green" ? "passive" : "active");
      }
    });
  } catch (err) {
    if (err instanceof Superseded) return { ok: false, reason: "not_yours" };
    throw err;
  }
  return { ok: true, decision, next: await nextToVerify(db, doc, technician) };
}

export async function rejectDocument(
  db: LisDb,
  id: string,
  technician: string,
  reason: RejectReason,
  note: string,
): Promise<DecideResult> {
  const found = await decidable(db, id, technician);
  if (found.error) return found.error;
  const at = new Date().toISOString();
  const text = note.trim() ? `${reason}: ${note.trim().slice(0, 500)}` : reason;
  const decision: Decision = { id: randomUUID(), documentId: id, decision: "rejected", technician, at, approved: null, reason: text };
  try {
    await db.transaction(async (tx) => {
      if (!(await close(tx, id, technician, "rejected", at))) throw new Superseded();
      await tx.insert(decisions).values(decision);
    });
  } catch (err) {
    if (err instanceof Superseded) return { ok: false, reason: "not_yours" };
    throw err;
  }
  return { ok: true, decision, next: await nextToVerify(db, found.doc, technician) };
}

export async function getDecision(db: LisDb, documentId: string): Promise<Decision | null> {
  const [d] = await db.select().from(decisions).where(eq(decisions.documentId, documentId));
  return d ?? null;
}
