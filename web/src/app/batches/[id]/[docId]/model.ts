/**
 * What the verification screen works on: the items a technician goes through (each field, then
 * each requested line), where each was found on the page, and the words for why each has its
 * colour.
 */
import type { FieldReason, FusedField, LinkStatus, TrafficLight } from "@/lib/fusion/types";
import type { MappingSource } from "@/lib/mapping/propose";
import { FIELDS, type FieldSpec } from "@/lib/schema/fields";
import type { BBox, BoxSource } from "@/lib/schema/prediction";

import type { ProposalView } from "../../../_ui/api";

export type Light = TrafficLight;

/**
 * Where an item was read: the page and the box, and whether the box is exact. The page's OCR
 * places boxes exactly, and so does Gemini (99.4% at IoU 0.5); the local model's own boxes
 * are loose (15.6% where the OCR could not place the value), so they are drawn approximate.
 */
export interface Place {
  page: number;
  bbox: BBox;
  exact: boolean;
}

function exact(source: BoxSource | undefined, inputMode: string): boolean {
  return source === "ocr" || inputMode !== "page-images";
}

export type Item =
  | { kind: "field"; key: string; index: number; spec: FieldSpec; fused: FusedField; place: Place | null }
  | { kind: "test"; key: string; index: number; place: Place | null };

export function itemsOf(view: ProposalView): Item[] {
  const { proposal } = view;
  const fused = new Map(proposal.fused.fields.map((f) => [f.name, f]));
  const mode = proposal.prediction.extractor.input_mode;
  const fields: Item[] = FIELDS.map((spec, index) => {
    const f = fused.get(spec.name)!;
    const predicted = proposal.prediction.fields[spec.name];
    const place: Place | null =
      f.ai?.bbox && f.ai.page ? { page: f.ai.page, bbox: f.ai.bbox, exact: exact(predicted?.box_source, mode) } : null;
    return { kind: "field", key: `f:${spec.name}`, index, spec, fused: f, place };
  });
  const tests: Item[] = proposal.tests.map((t, index) => ({
    kind: "test",
    key: `t:${index}`,
    index,
    place: t.bbox && t.page ? { page: t.page, bbox: t.bbox, exact: exact(t.box_source, mode) } : null,
  }));
  return [...fields, ...tests];
}

export const GROUPS: { id: string; label: string }[] = [
  { id: "patient", label: "Patient" },
  { id: "physician", label: "Physician" },
  { id: "request", label: "Request" },
  { id: "insurer", label: "Insurer" },
];

export const LIGHT_DOT: Record<Light, string> = {
  green: "bg-emerald-500",
  orange: "bg-amber-500",
  red: "bg-red-500",
  grey: "bg-slate-300",
};

/** Box colours on the page, by the item's light. */
export const LIGHT_BOX: Record<Light, string> = {
  green: "border-emerald-500 bg-emerald-400/10",
  orange: "border-amber-500 bg-amber-400/10",
  red: "border-red-500 bg-red-400/10",
  grey: "border-slate-400 bg-slate-400/10",
};

export const REASON: Record<FieldReason, string> = {
  agree: "The document and the lab's records agree",
  lis_only: "Not on the document; taken from the lab's records",
  ai_only: "Only on the document: the records cannot confirm it",
  ai_only_doubtful: "Only on the document, and the reading looks doubtful",
  conflict: "The document and the records disagree: choose",
  candidate_agrees: "Agrees with a record not yet confirmed as this patient's",
  candidate_only: "Only in a record not yet confirmed as this patient's",
  default: "The system's default",
  missing_required: "Missing, and required",
  absent_optional: "Absent, and optional",
};

export const LINK_LABEL: Record<LinkStatus, string> = {
  linked: "Linked",
  candidate: "Candidate",
  ambiguous: "Ambiguous",
  none: "No record",
};

export const LINK_STYLE: Record<LinkStatus, string> = {
  linked: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  candidate: "bg-amber-50 text-amber-800 ring-amber-200",
  ambiguous: "bg-amber-50 text-amber-800 ring-amber-200",
  none: "bg-slate-50 text-slate-600 ring-slate-200",
};

export const MAPPING_SOURCE: Record<Exclude<MappingSource, null>, string> = {
  memory: "Approved before for this insurer",
  memory_elsewhere: "Approved before for other insurers",
  search: "Best match in the catalog",
  model: "Chosen by the model among the catalog's candidates",
};

export const codesKey = (codes: string[] | null) => (codes ? [...codes].sort().join(",") : "");
