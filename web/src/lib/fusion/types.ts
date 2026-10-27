/**
 * What the fusion engine produces for one document: the records it is linked to and, per
 * field, a proposed value with its traffic light and its provenance.
 *
 * Every state here is a signal to the technician, never a decision: nothing is accepted
 * until a person approves it (CLAUDE.md). `history` is where those actions will be recorded.
 */
import type { BBox } from "@/lib/schema/prediction";

export const FUSION_VERSION = 1 as const;

export type TrafficLight = "green" | "orange" | "red" | "grey";

/** Where a proposed value came from, in priority order: the LIS, the AI, the system default. */
export type ValueSource = "lis" | "ai" | "default";

export interface LisPatient {
  id: string;
  firstName: string;
  lastName1: string;
  lastName2: string;
  sex: "H" | "M";
  birthDate: string;
  docId: string;
  phone: string | null;
}

export interface LisPhysician {
  id: string;
  firstName: string;
  lastName1: string;
  lastName2: string;
  sex: "H" | "M";
  colegiado: string;
}

export interface LisInsurer {
  id: string;
  name: string;
  aliases: string[];
}

/** The LIS as the engine reads it: small enough to hold in memory. */
export interface LisSnapshot {
  patients: LisPatient[];
  physicians: LisPhysician[];
  insurers: LisInsurer[];
}

export type RecordKind = "patient" | "physician" | "insurer";

/**
 * - linked: found on keys strong enough to compare against without asking;
 * - candidate: one record looks like it, but a person has to confirm it;
 * - ambiguous: several records look like it;
 * - none: no record, so the LIS has nothing to say (a new patient, an unknown physician).
 */
export type LinkStatus = "linked" | "candidate" | "ambiguous" | "none";

export interface RecordLink {
  record: RecordKind;
  status: LinkStatus;
  state: TrafficLight;
  /** The linked record, or the single candidate. */
  recordId: string | null;
  candidates: string[];
  /** The keys on which the document and the record agree. */
  matchedOn: string[];
  reason: string;
  /** Set by the technician, who searched the records, rather than found by the engine. */
  chosen?: boolean;
}

/** Links the technician set by hand: a record's id, or null for "no record, a new one". */
export type ChosenLinks = Partial<Record<RecordKind, string | null>>;

export type FieldReason =
  | "agree" // AI and LIS agree
  | "lis_only" // only the LIS has it
  | "ai_only" // only the AI has it
  | "ai_only_doubtful" // only the AI has it, with a warning that casts doubt on it
  | "conflict" // AI and LIS disagree: the technician decides
  | "candidate_agrees" // agrees with a record not yet confirmed as this patient's
  | "candidate_only" // only an unconfirmed record has it
  | "default" // only the system default
  | "missing_required"
  | "absent_optional";

export interface HistoryEntry {
  at: string;
  by: string;
  action: string;
  from: string | null;
  to: string | null;
}

export interface FusedField {
  name: string;
  state: TrafficLight;
  reason: FieldReason;
  /** The proposed value, or null when there is none or the technician has to choose. */
  value: string | null;
  source: ValueSource | null;
  ai: { value: string; page: number | null; bbox: BBox | null; warnings: string[] } | null;
  lis: { value: string; recordId: string; confirmed: boolean } | null;
  history: HistoryEntry[];
}

export interface FusedDocument {
  fusion_version: typeof FUSION_VERSION;
  id: string;
  sha256: string;
  /** The extractor's error code when it produced nothing usable, else null. */
  extractor_error: string | null;
  links: Record<RecordKind, RecordLink>;
  fields: FusedField[];
}
