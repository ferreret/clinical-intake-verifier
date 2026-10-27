/**
 * What the verification screen works on: the items a technician goes through (each field, then
 * each requested line), where each was found on the page, and how each colour is drawn. The
 * words for each are in the messages of the language (_ui/messages).
 */
import type { FusedField, LinkStatus, TrafficLight } from "@/lib/fusion/types";
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

export const GROUPS = ["patient", "physician", "request", "insurer"] as const;

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

export const LINK_STYLE: Record<LinkStatus, string> = {
  linked: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  candidate: "bg-amber-50 text-amber-800 ring-amber-200",
  ambiguous: "bg-amber-50 text-amber-800 ring-amber-200",
  none: "bg-slate-50 text-slate-600 ring-slate-200",
};

export const codesKey = (codes: string[] | null) => (codes ? [...codes].sort().join(",") : "");

/**
 * Where an item stands before approval (roadmap, F4 decision 9, checked again by the server):
 * a red or orange one is resolved by changing it or confirming it as proposed; a green one is
 * covered by the approval itself. A required field must have a value; a kept line, codes.
 */
export interface Check {
  /** Still in the way of approving. */
  pending: boolean;
  /** Red or orange and as proposed, so a confirmation is what resolves it. */
  confirmable: boolean;
}

const needsCheck = (state: Light) => state === "red" || state === "orange";

export function checkOf(item: Item, view: ProposalView, value: string | undefined, codes: string[] | null | undefined, confirmed: boolean): Check {
  if (item.kind === "field") {
    const v = (value ?? "").trim();
    const confirmable = needsCheck(item.fused.state) && v === (item.fused.value ?? "").trim();
    return { pending: (item.spec.required && !v) || (confirmable && !confirmed), confirmable };
  }
  if (codes === null) return { pending: false, confirmable: false };
  const m = view.proposal.tests[item.index].mapping;
  const confirmable = needsCheck(m.state) && m.codes !== null && codesKey(codes ?? []) === codesKey(m.codes);
  return { pending: !codes || codes.length === 0 || (confirmable && !confirmed), confirmable };
}
