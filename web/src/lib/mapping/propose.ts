/**
 * Proposing the lab codes of a requested line. Layers, most trusted first:
 *
 *   1. this insurer's approved requests: green once actively approved enough times with no
 *      contradiction, orange before that;
 *   2. other insurers' approved requests: orange, a suggestion;
 *   3. catalog search: orange when one candidate stands out, red otherwise;
 *   4. nothing clear: red, the technician chooses.
 *
 * The model layer (F4 block 5) goes between 2 and 3. A proposal is never an acceptance: every
 * line, green included, waits for the technician's approval of the request.
 */
import { compareKey } from "@/lib/schema/compare";

import type { MappingMemory, MemoryEntry } from "./memory";
import type { Candidate, Searcher } from "./search";

/** Active approvals, with no contradiction, after which a line is proposed green. */
export const GREEN_APPROVALS = 2;
export const CANDIDATES = 20;

/** When a search's best candidate is proposed: its score reaches `minScore` and leads the
 * next one by `minLead`. Each searcher has its own, its scores being on its own scale. */
export interface SearchSettings {
  minScore: number;
  minLead: number;
}

/** The lexical search's, first choices of block 4. */
export const LEXICAL_SETTINGS: SearchSettings = { minScore: 0.55, minLead: 0.05 };

export type MappingSource = "memory" | "memory_elsewhere" | "search" | null;

export interface Proposal {
  state: "green" | "orange" | "red";
  /** The proposed codes, or null when the technician has to choose. */
  codes: string[] | null;
  source: MappingSource;
  reason: string;
  /** Approvals behind a memory proposal. */
  evidence: MemoryEntry | null;
  /** Catalog candidates, best first, for the technician to choose from. */
  candidates: Candidate[];
}

/** The line as the memory keys it. */
export function textKey(line: string): string {
  return compareKey(line, "casefold");
}

export async function propose(
  line: string,
  scope: string,
  memory: MappingMemory,
  index: Searcher,
  settings: SearchSettings = LEXICAL_SETTINGS,
): Promise<Proposal> {
  const key = textKey(line);
  const candidates = await index.search(line, CANDIDATES);
  const out = (
    state: Proposal["state"],
    codes: string[] | null,
    source: MappingSource,
    reason: string,
    evidence: MemoryEntry | null = null,
  ): Proposal => ({ state, codes, source, reason, evidence, candidates });

  const trusted = (await memory.lookup(scope, key)).filter((e) => e.active > 0);
  if (trusted.length > 1) {
    return out("red", null, null, `approved with ${trusted.length} different meanings for this insurer`);
  }
  if (trusted.length === 1) {
    const e = trusted[0];
    if (e.active >= GREEN_APPROVALS && e.corrections === 0) {
      return out("green", e.codes, "memory", `approved ${e.active} times for this insurer`, e);
    }
    const why = e.corrections > 0 ? `, corrected ${e.corrections} times` : "";
    return out("orange", e.codes, "memory", `approved ${e.active} time(s) for this insurer${why}`, e);
  }

  const other = (await memory.elsewhere(scope, key))
    .filter((e) => e.active > 0)
    .sort((a, b) => b.active - a.active);
  if (other.length > 0) {
    return out("orange", other[0].codes, "memory_elsewhere", `approved ${other[0].active} time(s) for other insurers`, other[0]);
  }

  const [first, second] = candidates;
  if (first && first.score >= settings.minScore && first.score - (second?.score ?? 0) >= settings.minLead) {
    return out("orange", first.codes, "search", `closest catalog entry: ${first.label}`);
  }
  return out("red", null, null, first ? "no catalog entry stands out" : "nothing in the catalog looks like it");
}
