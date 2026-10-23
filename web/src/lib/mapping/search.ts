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

/** A test or profile of the catalog with every form a line may be compared with. */
export interface CatalogEntry {
  kind: Candidate["kind"];
  ref: string;
  codes: string[];
  label: string;
  forms: string[];
}

export function catalogEntries(catalog: Catalog): CatalogEntry[] {
  const tests: CatalogEntry[] = catalog.tests.map((t) => {
    const forms = new Set<string>([t.name]);
    for (const name of [t.analyte, ...t.synonyms]) {
      const base = t.variant ? `${name} ${t.variant}` : name;
      if (t.specimen) forms.add(`${base} ${t.specimen}`);
      if (!t.specimen || t.defaultSpecimen) forms.add(base);
    }
    return { kind: "test", ref: t.code, codes: [t.code], label: t.name, forms: [...forms] };
  });
  const profiles: CatalogEntry[] = catalog.profiles.map((p) => ({
    kind: "profile",
    ref: p.id,
    codes: [...p.codes].sort(),
    label: p.name,
    forms: [p.name],
  }));
  return [...tests, ...profiles];
}

/** Anything that ranks the catalog for a printed line. */
export interface Searcher {
  /** The `k` best candidates, best first. */
  search(text: string, k?: number): Promise<Candidate[]>;
}

/** The best `k` entries for per-entry scores aligned with `entries`. */
export function rank(entries: CatalogEntry[], scores: number[], k: number): Candidate[] {
  return entries
    .map((e, i) => ({ kind: e.kind, ref: e.ref, codes: e.codes, label: e.label, score: scores[i] }))
    .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
    .slice(0, k);
}

export class CatalogIndex implements Searcher {
  readonly entries: CatalogEntry[];
  private readonly grams: Set<string>[][];

  constructor(catalog: Catalog) {
    this.entries = catalogEntries(catalog);
    this.grams = this.entries.map((e) => [...new Set(e.forms.map(searchKey))].map(trigrams));
  }

  /** Each entry's score for a line: the best Dice coefficient over its forms. */
  scores(text: string): number[] {
    const query = trigrams(searchKey(text));
    return this.grams.map((forms) => Math.max(...forms.map((f) => dice(query, f))));
  }

  async search(text: string, k = 20): Promise<Candidate[]> {
    return rank(this.entries, this.scores(text), k);
  }
}
