/**
 * Proposing the codes of every requested line of one document: each line through the memory
 * and the catalog search, then, once per document, the model for the lines the policy hands
 * it. The entry point the verification UI uses; the learning-curve simulation replays it.
 */
import type { Catalog } from "./catalog";
import type { MappingMemory } from "./memory";
import { consult, type Consultation, type ModelLine, type Provider } from "./model";
import { propose, type Proposal, type SearchSettings } from "./propose";
import type { Searcher } from "./search";

/**
 * Which lines go to the model: `red`, only those the memory and the search left red (the
 * default, measured in F4 block 5b as the best trade between work saved and calls made);
 * `all`, every line the memory did not settle, the model's answer replacing the search's.
 */
export type ModelPolicy = "red" | "all";

export interface DocumentContext {
  /** Memory scope: the LIS insurer id, `name:<insurer>` for an unregistered one, or `none`. */
  scope: string;
  insurer: string | null;
  language: string;
}

export interface ModelOptions {
  provider: Provider;
  policy: ModelPolicy;
  catalog: Catalog;
  /** Where replies are cached; null for no cache. */
  cacheDir: string | null;
  /** In replay mode: the recorded answers instead of asking the provider (recorded.ts). */
  replay?: (lines: ModelLine[]) => Consultation;
}

export interface DocumentProposals {
  proposals: Proposal[];
  /** Per line index sent to the model: its answer, null when it said none fits. */
  model: Map<number, string[] | null>;
  consultation: Consultation | null;
}

export async function proposeDocument(
  lines: string[],
  ctx: DocumentContext,
  memory: MappingMemory,
  index: Searcher,
  settings?: SearchSettings,
  model?: ModelOptions,
): Promise<DocumentProposals> {
  const proposals: Proposal[] = [];
  for (const line of lines) proposals.push(await propose(line, ctx.scope, memory, index, settings));

  const sent = new Map<number, string[] | null>();
  if (!model) return { proposals, model: sent, consultation: null };
  const needs = proposals
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => (model.policy === "all" ? p.source === "search" || p.source === null : p.state === "red"));
  if (needs.length === 0) return { proposals, model: sent, consultation: null };

  const asked: ModelLine[] = needs.map(({ p, i }) => ({ id: `L${i + 1}`, text: lines[i], candidates: p.candidates }));
  const consultation = model.replay
    ? model.replay(asked)
    : await consult({ insurer: ctx.insurer, language: ctx.language, formLines: lines, lines: asked }, model.catalog, model.provider, model.cacheDir);
  for (const { p, i } of needs) {
    const codes = consultation.choices.get(`L${i + 1}`) ?? null;
    sent.set(i, codes);
    const seen = { ...p.seen, model: { answer: codes } };
    if (codes) {
      proposals[i] = { ...p, seen, state: "orange", codes, source: "model", reason: "chosen by the model among the catalog candidates" };
    } else if (model.policy === "all") {
      proposals[i] = { ...p, seen, state: "red", codes: null, source: null, reason: "the model found no candidate that fits" };
    } else {
      proposals[i] = { ...p, seen };
    }
  }
  return { proposals, model: sent, consultation };
}
