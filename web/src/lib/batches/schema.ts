/**
 * The verification workflow (F5): batches of documents, each read, fused and mapped into a
 * proposal that waits for a technician, and the technician's decision on it.
 *
 * These tables live in the same database as the mock LIS, one database per workspace
 * (workspace.ts): a sandbox of the public demo, or the single workspace of live mode.
 *
 * A document's state is the queue: `queued` documents are what the worker takes next. A
 * batch has no state of its own; it is derived from its documents'.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { ChosenLinks, FusedDocument, TrafficLight } from "@/lib/fusion/types";
import type { Proposal } from "@/lib/mapping/propose";
import type { BBox, BoxSource, Prediction } from "@/lib/schema/prediction";

export const PROVIDERS = ["gemini", "local"] as const;

export const DOCUMENT_STATES = [
  "queued",
  "extracting",
  "failed",
  "awaiting_verification",
  "in_verification",
  "approved",
  "rejected",
] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export const batches = sqliteTable("batches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** The extractor that reads its documents: called live, or its recorded replies served. */
  provider: text("provider", { enum: PROVIDERS }).notNull(),
  /** The technician who created it. */
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const batchDocuments = sqliteTable(
  "batch_documents",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id),
    position: integer("position").notNull(),
    fileName: text("file_name").notNull(),
    sha256: text("sha256").notNull(),
    /** `bundled`: one of the demo's synthetic documents; `upload`: a PDF sent in live mode. */
    origin: text("origin", { enum: ["bundled", "upload"] }).notNull(),
    /** Where the PDF is: its name in the bundled set, or its path under the uploads directory. */
    location: text("location").notNull(),
    state: text("state", { enum: DOCUMENT_STATES }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    /** Why the last processing failed. */
    error: text("error"),
    /** The technician verifying it, while `in_verification`. */
    lockedBy: text("locked_by"),
    lockedAt: text("locked_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("batch_documents_batch").on(t.batchId, t.position), index("batch_documents_state").on(t.state)],
);

/** A requested line with the codes test mapping proposes for it. */
export interface TestProposal {
  text: string;
  page: number | null;
  bbox: BBox | null;
  box_source?: BoxSource;
  mapping: Proposal;
}

/** What the chain proposed for a document, kept as it was: the technician's input. */
export const proposals = sqliteTable("proposals", {
  documentId: text("document_id")
    .primaryKey()
    .references(() => batchDocuments.id),
  prediction: text("prediction", { mode: "json" }).$type<Prediction>().notNull(),
  fused: text("fused", { mode: "json" }).$type<FusedDocument>().notNull(),
  tests: text("tests", { mode: "json" }).$type<TestProposal[]>().notNull(),
  /** True when the extractor's reply was a recorded one, served in replay mode. */
  recorded: integer("recorded", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
});

/** What the technician did with each field and line, as the approval records it. */
export type FieldAction = "kept" | "confirmed" | "changed";
export type LineAction = "kept" | "confirmed" | "corrected" | "chosen" | "dropped" | "added";

/** The approval as recorded: each value and line with what was proposed and what was done. */
export interface ApprovalRecord {
  links: { patient: string | null; physician: string | null; insurer: string | null };
  /** The links the technician set by searching the records, if any. */
  chosen: ChosenLinks;
  fields: { name: string; value: string | null; proposed: string | null; state: TrafficLight; action: FieldAction }[];
  tests: {
    text: string;
    page: number | null;
    proposed: string[] | null;
    state: TrafficLight | null;
    codes: string[] | null;
    action: LineAction;
  }[];
}

/**
 * A technician's decision on a document. Written once and never updated: who, when, and the
 * exact values and codes approved, or why the document was rejected.
 */
export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => batchDocuments.id),
  decision: text("decision", { enum: ["approved", "rejected"] }).notNull(),
  technician: text("technician").notNull(),
  at: text("at").notNull(),
  /** Approved: the field values and each line's codes, exactly as approved. */
  approved: text("approved", { mode: "json" }).$type<ApprovalRecord>(),
  /** Rejected: why. */
  reason: text("reason"),
});
