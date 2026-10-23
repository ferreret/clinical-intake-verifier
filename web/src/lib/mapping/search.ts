/**
 * Candidate search in the lab's catalog: which tests or profiles a printed line looks like.
 *
 * Lexical on purpose: character trigrams, scored with the Dice coefficient against every form
 * of a test (its names and synonyms, with and without its specimen; without it only for the
 * analyte's usual specimen, which forms leave unwritten). Lexical search can be measured on
 * its own (recall@k), and its limits, Catalan lines against a Spanish catalog among them, are
 * what the memory of approvals and, later, the model are for.
 */
import type { Catalog } from "./catalog";

export interface Candidate {
  /** "test" or "profile", and its code or id. */
  kind: "test" | "profile";
  ref: string;
  /** What requesting it means: one code for a test, several for a profile. */
  codes: string[];
  label: string;
  score: number;
}

/** The form a line is compared in: lower case, no accents, punctuation as spaces. */
export function searchKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function trigrams(key: string): Set<string> {
  const padded = ` ${key} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}

interface Entry {
  kind: Candidate["kind"];
  ref: string;
  codes: string[];
  label: string;
  forms: Set<string>[];
}

export class CatalogIndex {
  private readonly entries: Entry[];

  constructor(catalog: Catalog) {
    const tests: Entry[] = catalog.tests.map((t) => {
      const forms = new Set<string>([searchKey(t.name)]);
      for (const name of [t.analyte, ...t.synonyms]) {
        const base = t.variant ? `${name} ${t.variant}` : name;
        if (t.specimen) forms.add(searchKey(`${base} ${t.specimen}`));
        if (!t.specimen || t.defaultSpecimen) forms.add(searchKey(base));
      }
      return { kind: "test", ref: t.code, codes: [t.code], label: t.name, forms: [...forms].map(trigrams) };
    });
    const profiles: Entry[] = catalog.profiles.map((p) => ({
      kind: "profile",
      ref: p.id,
      codes: [...p.codes].sort(),
      label: p.name,
      forms: [trigrams(searchKey(p.name))],
    }));
    this.entries = [...tests, ...profiles];
  }

  /** The `k` best candidates for a printed line, best first. */
  search(text: string, k = 20): Candidate[] {
    const query = trigrams(searchKey(text));
    return this.entries
      .map((e) => ({
        kind: e.kind,
        ref: e.ref,
        codes: e.codes,
        label: e.label,
        score: Math.max(...e.forms.map((f) => dice(query, f))),
      }))
      .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
      .slice(0, k);
  }
}
