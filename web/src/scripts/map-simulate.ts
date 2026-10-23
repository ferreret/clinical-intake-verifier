/**
 * Replay a dataset's requests, in order, through test mapping with a simulated technician,
 * and write every line's proposal and outcome (scored by `intake-synth evaluate-mapping`).
 *
 *   npm run map-simulate -- --dataset ../data/synth/seed-42-n1000 [--error-rate 0.02]
 *                           [--seed 1] [--out ../data/mapping/<mapping-id>]
 *                           [--search lexical|embedding|hybrid --min-score 0.55 --min-lead 0.05]
 *                           [--model gemini|local --policy red|all]
 *
 * With --model, a language model chooses among the candidates of the lines the memory did
 * not settle: under policy "all" every such line (its answer replaces the search's, and none
 * means red), under "red" only the lines the search left red. Replies are cached in
 * data/model-cache, so a rerun costs nothing.
 *
 * Lines are read from the goldens, as a perfect extractor would read them, so the run
 * measures mapping alone. The technician approves green lines without acting, confirms an
 * orange proposal that is right and corrects one that is wrong, and chooses the codes of a
 * red line. With --error-rate, that share of their actions picks wrong codes. The memory
 * learns only from approved requests, in memory: the run leaves no database behind.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { catalogFromFile, type CatalogFile } from "@/lib/mapping/catalog";
import { Embedder, EmbeddingSearch, HybridSearch } from "@/lib/mapping/embeddings";
import { InMemoryMemory, type ApprovalKind } from "@/lib/mapping/memory";
import { proposeDocument, type ModelPolicy } from "@/lib/mapping/document";
import { MAPPING_PROMPT_VERSION, resolveProvider, type Provider } from "@/lib/mapping/model";
import { CANDIDATES, GREEN_APPROVALS, LEXICAL_SETTINGS, textKey } from "@/lib/mapping/propose";
import { CatalogIndex, type Searcher } from "@/lib/mapping/search";
import { compareKey } from "@/lib/schema/compare";

import { loadDotEnv } from "./env";

const NOT_GOLDEN = new Set(["manifest.json", "catalog.json", "lis.json"]);

interface Golden {
  id: string;
  fields: Record<string, { value: string } | null>;
  tests: { value: string; codes: string[] }[];
  lis: { insurer_id: string | null };
  context: { language?: string };
}

/** A small seeded generator (mulberry32), so a run is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const setKey = (codes: string[]) => [...codes].sort().join(",");

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      "error-rate": { type: "string", default: "0" },
      seed: { type: "string", default: "1" },
      out: { type: "string" },
      search: { type: "string", default: "lexical" },
      model: { type: "string" },
      policy: { type: "string", default: "red" },
      "min-score": { type: "string" },
      "min-lead": { type: "string" },
    },
  });
  if (!values.dataset) {
    console.error("usage: npm run map-simulate -- --dataset <dir> [--error-rate 0.02] [--seed 1] [--out <dir>]");
    return 1;
  }
  const dataset = path.resolve(values.dataset);
  const errorRate = Number(values["error-rate"]);
  const seed = Number(values.seed);
  const random = rng(seed);
  await loadDotEnv(path.resolve(process.cwd(), ".env.local"));
  const method = values.search ?? "lexical";
  const policy = (values.policy ?? "red") as ModelPolicy;
  if (policy !== "red" && policy !== "all") throw new Error(`unknown --policy ${policy}: use red or all`);
  const provider: Provider | null = values.model ? resolveProvider(values.model) : null;
  const cacheDir = path.resolve("..", "data", "model-cache");
  const modelStats = { calls: 0, cached: 0, linesSent: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  const settings = {
    minScore: values["min-score"] ? Number(values["min-score"]) : LEXICAL_SETTINGS.minScore,
    minLead: values["min-lead"] ? Number(values["min-lead"]) : LEXICAL_SETTINGS.minLead,
  };
  const modelTag = provider ? `-${provider.name}-${policy}` : "";
  const mappingId = `${timestamp(new Date())}-${path.basename(dataset)}-${method}${modelTag}-e${errorRate}`;
  const outDir = path.resolve(values.out ?? path.join("..", "data", "mapping", mappingId));

  const read = async <T>(file: string) => JSON.parse(await fs.readFile(path.join(dataset, file), "utf8")) as T;
  const catalogFile = await read<CatalogFile>("catalog.json");
  const catalog = catalogFromFile(catalogFile);
  const lexical = new CatalogIndex(catalog);
  let index: Searcher = lexical;
  let embedder: Embedder | null = null;
  if (method !== "lexical") {
    const dataDir = path.resolve("..", "data");
    embedder = await Embedder.open(path.join(dataDir, "models"), path.join(dataDir, "embeddings"));
    const semantic = await EmbeddingSearch.build(catalog, embedder);
    if (method === "embedding") index = semantic;
    else if (method === "hybrid") index = new HybridSearch(lexical, semantic);
    else throw new Error(`unknown --search ${method}`);
  }
  const allCodes = catalogFile.tests.map((t) => t.code);
  const memory = new InMemoryMemory();

  const files = (await fs.readdir(dataset)).filter((f) => f.endsWith(".json") && !NOT_GOLDEN.has(f)).sort();
  const seen = new Map<string, number>();
  const lines: string[] = [];
  const tally: Record<string, number> = {};

  for (const file of files) {
    const g = await read<Golden>(file);
    const insurer = g.fields.NombreMutua?.value ?? null;
    const scope = g.lis.insurer_id ?? (insurer ? `name:${compareKey(insurer, "casefold")}` : "none");
    const k = (seen.get(scope) ?? 0) + 1;
    seen.set(scope, k);

    const approvals: { text: string; codes: string[]; kind: ApprovalKind; corrected: string[] | null }[] = [];
    const { proposals, model: sent, consultation } = await proposeDocument(
      g.tests.map((t) => t.value),
      { scope, insurer, language: g.context.language ?? "es" },
      memory,
      index,
      settings,
      provider ? { provider, policy, catalog, cacheDir } : undefined,
    );
    if (consultation) {
      modelStats.calls += 1;
      modelStats.cached += consultation.cached ? 1 : 0;
      modelStats.linesSent += sent.size;
      modelStats.inputTokens += consultation.usage.inputTokens ?? 0;
      modelStats.outputTokens += consultation.usage.outputTokens ?? 0;
      modelStats.latencyMs += consultation.latencyMs;
    }

    for (const [i, t] of g.tests.entries()) {
      const truth = [...t.codes].sort();
      const p = proposals[i];
      const proposedRight = p.codes ? setKey(p.codes) === setKey(truth) : null;
      const wrongPick = () =>
        p.candidates.find((c) => setKey(c.codes) !== setKey(truth))?.codes ?? [allCodes[Math.floor(random() * allCodes.length)]];

      let action: string;
      let chosen: string[];
      let kind: ApprovalKind = "active";
      let corrected: string[] | null = null;
      if (p.state === "green") {
        [action, chosen, kind] = ["approve", p.codes!, "passive"];
      } else if (p.state === "orange" && (proposedRight || random() < errorRate)) {
        [action, chosen] = ["confirm", p.codes!];
      } else if (p.state === "orange") {
        [action, chosen, corrected] = ["correct", truth, p.codes];
      } else {
        [action, chosen] = ["choose", random() < errorRate ? wrongPick() : truth];
      }
      approvals.push({ text: t.value, codes: chosen, kind, corrected });
      tally[p.state] = (tally[p.state] ?? 0) + 1;

      lines.push(
        JSON.stringify({
          doc: g.id,
          scope,
          k,
          insurer,
          language: g.context.language ?? "es",
          text: t.value,
          truth,
          state: p.state,
          source: p.source,
          proposed: p.codes,
          proposed_right: proposedRight,
          in_candidates: p.candidates.some((c) => setKey(c.codes) === setKey(truth)),
          top_score: p.candidates[0]?.score ?? 0,
          lead: (p.candidates[0]?.score ?? 0) - (p.candidates[1]?.score ?? 0),
          action,
          chosen: [...chosen].sort(),
          chosen_right: setKey(chosen) === setKey(truth),
          model_called: sent.has(i),
          model_codes: sent.get(i) ?? null,
        }),
      );
    }
    // The request is approved: only now does the memory learn.
    for (const a of approvals) {
      if (a.corrected) await memory.correct(scope, textKey(a.text), a.corrected);
      await memory.approve(scope, textKey(a.text), a.codes, a.kind);
    }
  }

  await embedder?.save();
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "lines.jsonl"), `${lines.join("\n")}\n`);
  const manifest = {
    mapping_id: mappingId,
    mapping_version: 1,
    dataset: path.relative(path.resolve(".."), dataset),
    documents: files.length,
    lines: lines.length,
    error_rate: errorRate,
    seed,
    green_approvals: GREEN_APPROVALS,
    search: method,
    search_min_score: settings.minScore,
    search_min_lead: settings.minLead,
    candidates: CANDIDATES,
    model: provider
      ? {
          provider: provider.name,
          name: provider.model,
          policy,
          prompt_version: MAPPING_PROMPT_VERSION,
          calls: modelStats.calls,
          cached_calls: modelStats.cached,
          lines_sent: modelStats.linesSent,
          input_tokens: modelStats.inputTokens,
          output_tokens: modelStats.outputTokens,
          latency_ms: modelStats.latencyMs,
        }
      : null,
    created_at: new Date().toISOString(),
  };
  await fs.writeFile(path.join(outDir, "mapping.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`mapping ${mappingId}: ${files.length} documents, ${lines.length} lines`);
  console.log(`  states  : ${Object.entries(tally).sort().map(([s, n]) => `${s}=${n}`).join(" ")}`);
  if (provider) {
    const fresh = modelStats.calls - modelStats.cached;
    console.log(
      `  model   : ${provider.name} ${provider.model}, policy ${policy}: ${modelStats.calls} calls (${modelStats.cached} cached), ` +
        `${modelStats.linesSent} lines, ${modelStats.inputTokens} in / ${modelStats.outputTokens} out tokens, ` +
        `${fresh ? Math.round(modelStats.latencyMs / fresh) : 0} ms per uncached call`,
    );
  }
  console.log(`  written : ${outDir}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
