/**
 * The fusion engine: what the AI read, set against what the LIS already holds.
 *
 * Source priority is LIS, then AI, then the system default. Per field (CLAUDE.md):
 *
 *   AI and LIS agree             green
 *   only the LIS                 green
 *   only the AI                  orange (red when a warning casts doubt on it)
 *   AI and LIS disagree          red: no value is proposed, the technician decides
 *   nothing, required            red
 *   nothing, optional            grey
 *
 * A record that is only a candidate (not confirmed as this document's) can never make a
 * field green: agreeing with it is orange.
 */
import { valuesMatch } from "@/lib/schema/compare";
import { FIELDS, type FieldSpec, type LisSource } from "@/lib/schema/fields";
import type { Prediction } from "@/lib/schema/prediction";

import { fullName, linkInsurer, linkPatient, linkPhysician, type DocumentValues } from "./link";
import {
  FUSION_VERSION,
  type FieldReason,
  type FusedDocument,
  type FusedField,
  type LisSnapshot,
  type RecordKind,
  type RecordLink,
  type TrafficLight,
} from "./types";

/** Extractor warnings that make an AI value doubtful rather than merely unconfirmed. */
const DOUBTFUL = new Set(["garbled_text", "control_character", "pattern_mismatch"]);

function lisValue(source: LisSource, recordId: string, lis: LisSnapshot): string | null {
  const [record, column] = source.split(".") as [RecordKind, string];
  if (record === "patient") {
    const p = lis.patients.find((r) => r.id === recordId);
    if (!p) return null;
    const columns: Record<string, string | null> = {
      name: fullName(p),
      birth_date: p.birthDate,
      sex: p.sex,
      doc_id: p.docId,
      phone: p.phone,
    };
    return columns[column] ?? null;
  }
  if (record === "physician") {
    const m = lis.physicians.find((r) => r.id === recordId);
    if (!m) return null;
    return ({ name: fullName(m), colegiado: m.colegiado } as Record<string, string>)[column] ?? null;
  }
  const i = lis.insurers.find((r) => r.id === recordId);
  return i && column === "name" ? i.name : null;
}

/** Other forms of an LIS value that count as the same: an insurer's aliases. */
function lisAliases(source: LisSource, recordId: string, lis: LisSnapshot): string[] {
  if (source !== "insurer.name") return [];
  return lis.insurers.find((r) => r.id === recordId)?.aliases ?? [];
}

function field(
  spec: FieldSpec,
  prediction: Prediction,
  links: Record<RecordKind, RecordLink>,
  lis: LisSnapshot,
): FusedField {
  const predicted = prediction.extractor.error ? null : prediction.fields[spec.name];
  const warnings = prediction.warnings.filter((w) => w.field === spec.name).map((w) => w.code);
  const ai = predicted ? { value: predicted.value, page: predicted.page, bbox: predicted.bbox, warnings } : null;

  let lisSide: FusedField["lis"] = null;
  if (spec.lis) {
    const l = links[spec.lis.source.split(".")[0] as RecordKind];
    if (l.recordId && (l.status === "linked" || l.status === "candidate")) {
      const value = lisValue(spec.lis.source, l.recordId, lis);
      if (value !== null) lisSide = { value, recordId: l.recordId, confirmed: l.status === "linked" };
    }
  }

  const out = (state: TrafficLight, reason: FieldReason, value: string | null, source: FusedField["source"]) => ({
    name: spec.name,
    state,
    reason,
    value,
    source,
    ai,
    lis: lisSide,
    history: [],
  });

  if (ai && lisSide) {
    const { source, compare } = spec.lis!;
    const forms = [lisSide.value, ...lisAliases(source, lisSide.recordId, lis)];
    if (!forms.some((v) => valuesMatch(ai.value, v, compare))) return out("red", "conflict", null, null);
    return lisSide.confirmed
      ? out("green", "agree", lisSide.value, "lis")
      : out("orange", "candidate_agrees", lisSide.value, "lis");
  }
  if (lisSide) {
    return lisSide.confirmed
      ? out("green", "lis_only", lisSide.value, "lis")
      : out("orange", "candidate_only", lisSide.value, "lis");
  }
  if (ai) {
    return ai.warnings.some((w) => DOUBTFUL.has(w))
      ? out("red", "ai_only_doubtful", ai.value, "ai")
      : out("orange", "ai_only", ai.value, "ai");
  }
  if (spec.default !== null) return out("orange", "default", spec.default, "default");
  return spec.required ? out("red", "missing_required", null, null) : out("grey", "absent_optional", null, null);
}

export function fuse(prediction: Prediction, lis: LisSnapshot): FusedDocument {
  const usable = !prediction.extractor.error;
  const doc: DocumentValues = Object.fromEntries(
    FIELDS.map((f) => [f.name, (usable && prediction.fields[f.name]?.value) || null]),
  );
  const links: Record<RecordKind, RecordLink> = {
    patient: linkPatient(doc, lis),
    physician: linkPhysician(doc, lis),
    insurer: linkInsurer(doc, lis),
  };
  return {
    fusion_version: FUSION_VERSION,
    id: prediction.id,
    sha256: prediction.sha256,
    extractor_error: prediction.extractor.error?.code ?? null,
    links,
    fields: FIELDS.map((spec) => field(spec, prediction, links, lis)),
  };
}
