/**
 * Searching the catalog by hand: what the technician types to find a test the chain did not
 * propose, by its name or by its code. The same trigram search the proposals use, with the
 * codes themselves first, so that a technician who knows the code gets it at once.
 */
import type { Catalog } from "./catalog";
import type { Candidate, CatalogIndex } from "./search";

/** Below this, a trigram match is noise for a typed query. */
const MIN_SCORE = 0.15;

/** The catalog's entries for a typed query, best first. */
export function browse(index: CatalogIndex, query: string, k = 12): Candidate[] {
  const text = query.trim();
  if (!text) return [];
  const code = text.toUpperCase().replace(/\s+/g, "");
  const byCode =
    code.length >= 2
      ? index.entries
          .filter((e) => e.ref.toUpperCase().startsWith(code))
          .sort((a, b) => a.ref.localeCompare(b.ref))
          .slice(0, k)
          .map((e) => ({ kind: e.kind, ref: e.ref, codes: e.codes, label: e.label, score: 1 }))
      : [];
  const seen = new Set(byCode.map((c) => c.ref));
  const scores = index.scores(text);
  const byName = index.entries
    .map((e, i) => ({ kind: e.kind, ref: e.ref, codes: e.codes, label: e.label, score: scores[i] }))
    .filter((c) => c.score >= MIN_SCORE && !seen.has(c.ref))
    .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
  return [...byCode, ...byName].slice(0, k);
}

/** The catalog's name of each code, as the screens show it (the name carries the specimen). */
export function codeNames(catalog: Catalog, codes: Iterable<string>): Record<string, string> {
  const names = new Map(catalog.tests.map((t) => [t.code, t.name]));
  return Object.fromEntries([...new Set(codes)].map((c) => [c, names.get(c) ?? c]));
}
