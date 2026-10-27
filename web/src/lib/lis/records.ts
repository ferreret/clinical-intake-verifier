/**
 * The LIS records as people see them, and searching them by hand: the technician looking for
 * the patient, physician or insurer a document is about when the engine did not link it.
 */
import { fullName } from "@/lib/fusion/link";
import type { FusedDocument, LisSnapshot, RecordKind } from "@/lib/fusion/types";
import { compareKey } from "@/lib/schema/compare";

export interface RecordView {
  id: string;
  kind: RecordKind;
  title: string;
  detail: string;
}

/** A record as shown: its name, and what tells it apart (the server's English; translated on screen). */
export function recordView(lis: LisSnapshot, id: string): RecordView | null {
  const p = lis.patients.find((r) => r.id === id);
  if (p) return { id, kind: "patient", title: fullName(p), detail: `${p.docId} · born ${p.birthDate}` };
  const m = lis.physicians.find((r) => r.id === id);
  if (m) return { id, kind: "physician", title: fullName(m), detail: `No. ${m.colegiado}` };
  const i = lis.insurers.find((r) => r.id === id);
  if (i) return { id, kind: "insurer", title: i.name, detail: i.id };
  return null;
}

const words = (text: string) => compareKey(text, "casefold").split(" ").filter(Boolean);
const alnum = (text: string) => text.toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * The records of one kind that a typed query finds, at most `k`: every word of it in the
 * name (accents and case aside), or the query in an identifying number (identity document,
 * birth date, phone, registration number, insurer code). By name first, then by id.
 */
export function searchRecords(lis: LisSnapshot, kind: RecordKind, query: string, k = 20): RecordView[] {
  const q = words(query);
  const n = alnum(query);
  if (q.length === 0) return [];
  const matches = (name: string[], numbers: string[]) => {
    const key = words(name.join(" ")).join(" ");
    return q.every((w) => key.includes(w)) || (n.length >= 3 && numbers.some((x) => alnum(x).includes(n)));
  };
  const ids =
    kind === "patient"
      ? lis.patients.filter((p) => matches([fullName(p)], [p.docId, p.birthDate, p.phone ?? ""]))
      : kind === "physician"
        ? lis.physicians.filter((m) => matches([fullName(m)], [m.colegiado]))
        : lis.insurers.filter((i) => matches([i.name, ...i.aliases], [i.id]));
  return ids
    .map((r) => recordView(lis, r.id)!)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .slice(0, k);
}

/** The records a fusion links to or offers as candidates, as shown. */
export function recordsOf(fused: FusedDocument, lis: LisSnapshot): Record<string, RecordView> {
  const ids = new Set<string>();
  for (const link of Object.values(fused.links)) {
    if (link.recordId) ids.add(link.recordId);
    for (const c of link.candidates) ids.add(c);
  }
  return Object.fromEntries([...ids].flatMap((id) => {
    const view = recordView(lis, id);
    return view ? [[id, view]] : [];
  }));
}
