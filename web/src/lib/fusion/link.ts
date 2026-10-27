/**
 * Finding the LIS records a document is about.
 *
 * A wrong link is worse than none: it would paint another person's data green. So a patient
 * is linked only on a strong match (the identity document agrees, and so does the name or
 * the birth date); anything weaker is offered as a candidate the technician confirms.
 */
import { valuesMatch } from "@/lib/schema/compare";
import { fieldSpec } from "@/lib/schema/fields";

import type { ChosenLinks, LisPatient, LisPhysician, LisSnapshot, RecordKind, RecordLink } from "./types";

/** The document's values the engine links on, by field name; null when absent. */
export type DocumentValues = Record<string, string | null>;

export function fullName(r: { firstName: string; lastName1: string; lastName2: string }): string {
  return `${r.firstName} ${r.lastName1} ${r.lastName2}`;
}

function same(field: string, a: string | null, b: string | null): boolean {
  const lis = fieldSpec(field).lis;
  if (!lis) throw new Error(`${field} has no LIS comparison in fields.json`);
  return a !== null && b !== null && valuesMatch(a, b, lis.compare);
}

function link(
  record: RecordKind,
  status: RecordLink["status"],
  reason: string,
  found: { id: string }[] = [],
  matchedOn: string[] = [],
): RecordLink {
  const state = status === "linked" ? "green" : status === "none" ? "orange" : "red";
  return {
    record,
    status,
    state,
    recordId: found.length === 1 ? found[0].id : null,
    candidates: status === "ambiguous" ? found.map((r) => r.id) : [],
    matchedOn,
    reason,
  };
}

/**
 * A link the technician set: the record they found by searching, which is then as good as a
 * strong match, or none when they say the document's person or insurer is not in the LIS.
 */
export function chosenLink(record: RecordKind, id: string | null, lis: LisSnapshot): RecordLink {
  const known = id !== null && [...lis.patients, ...lis.physicians, ...lis.insurers].some((r) => r.id === id);
  const out = known
    ? link(record, "linked", "chosen by the technician", [{ id: id! }])
    : link(record, "none", "the technician says there is no record: a new one");
  return { ...out, chosen: true };
}

/** Chosen links as sent by the screen, or null when they are not shaped like them. */
export function parseChosenLinks(value: unknown): ChosenLinks | null {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const out: ChosenLinks = {};
  for (const [k, v] of Object.entries(value)) {
    if (!["patient", "physician", "insurer"].includes(k) || (v !== null && typeof v !== "string")) return null;
    out[k as RecordKind] = v as string | null;
  }
  return out;
}

export function linkPatient(doc: DocumentValues, lis: LisSnapshot): RecordLink {
  const name = doc.Paciente;
  const birth = doc.FechaNacimiento;
  const docId = doc.DocumentoIdentidad;
  const nameOf = (p: LisPatient) => same("Paciente", name, fullName(p));
  const birthOf = (p: LisPatient) => same("FechaNacimiento", birth, p.birthDate);

  const byDoc = lis.patients.find((p) => same("DocumentoIdentidad", docId, p.docId));
  if (byDoc) {
    const keys = ["doc_id", ...(nameOf(byDoc) ? ["name"] : []), ...(birthOf(byDoc) ? ["birth_date"] : [])];
    if (keys.length > 1) {
      return link("patient", "linked", "identity document and name or birth date agree", [byDoc], keys);
    }
    return link(
      "patient",
      "candidate",
      "the identity document matches a record whose name and birth date do not",
      [byDoc],
      keys,
    );
  }

  const byName = lis.patients.filter(nameOf);
  const byNameBirth = byName.filter(birthOf);
  const noDoc = docId === null ? "there is no identity document on the form" : "the identity document matches no record";
  if (byNameBirth.length === 1) {
    return link("patient", "candidate", `name and birth date match one record; ${noDoc}`, byNameBirth, [
      "name",
      "birth_date",
    ]);
  }
  if (byNameBirth.length > 1) {
    return link("patient", "ambiguous", `name and birth date match ${byNameBirth.length} records`, byNameBirth, [
      "name",
      "birth_date",
    ]);
  }
  if (byName.length > 0) {
    const status = byName.length === 1 ? "candidate" : "ambiguous";
    return link("patient", status, `the name matches ${byName.length} record(s) but no birth date does; ${noDoc}`, byName, [
      "name",
    ]);
  }
  return link("patient", "none", "no record matches: a patient the lab has not seen");
}

export function linkPhysician(doc: DocumentValues, lis: LisSnapshot): RecordLink {
  const nameOf = (m: LisPhysician) => same("NombreMedico", doc.NombreMedico, fullName(m));
  const byNumber = lis.physicians.find((m) => same("NumeroColegiado", doc.NumeroColegiado, m.colegiado));
  if (byNumber) {
    return nameOf(byNumber)
      ? link("physician", "linked", "registration number and name agree", [byNumber], ["colegiado", "name"])
      : link("physician", "candidate", "the registration number matches a record with another name", [byNumber], [
          "colegiado",
        ]);
  }
  // Physicians have no namesakes in practice; a unique name is enough.
  const byName = lis.physicians.filter(nameOf);
  if (byName.length === 1) return link("physician", "linked", "the name matches one record", byName, ["name"]);
  if (byName.length > 1) return link("physician", "ambiguous", `the name matches ${byName.length} records`, byName, ["name"]);
  return link("physician", "none", "no record matches: a physician the lab does not know");
}

export function linkInsurer(doc: DocumentValues, lis: LisSnapshot): RecordLink {
  const name = doc.NombreMutua;
  const found = lis.insurers.filter((i) => [i.name, ...i.aliases].some((n) => same("NombreMutua", name, n)));
  if (found.length === 1) return link("insurer", "linked", "the name matches a registered insurer", found, ["name"]);
  if (found.length > 1) return link("insurer", "ambiguous", `the name matches ${found.length} insurers`, found, ["name"]);
  if (name === null) return link("insurer", "none", "the document names no insurer");
  return link("insurer", "none", "the insurer is not registered in the LIS");
}
