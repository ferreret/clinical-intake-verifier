/**
 * Compare catalog searches on the same lines: lexical (trigrams), embedding and hybrid.
 * Writes, per line and method, the rank of the right codes among the candidates and the
 * best two scores (scored by `intake-synth evaluate-search`).
 *
 *   npm run search-compare -- --dataset ../data/synth/seed-42-n1000 [--out ../data/search/<id>]
 *
 * Lines are the distinct (insurer, printed text) pairs of the dataset, in order of first
 * appearance: what reaches the search once the memory of approvals is in place, since a
 * line seen before for the same insurer is the memory's.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { catalogFromFile, type CatalogFile } from "@/lib/mapping/catalog";
import { EMBEDDING_MODEL, Embedder, EmbeddingSearch, HybridSearch } from "@/lib/mapping/embeddings";
import { CANDIDATES } from "@/lib/mapping/propose";
import { CatalogIndex, type Searcher } from "@/lib/mapping/search";
import { compareKey } from "@/lib/schema/compare";

const NOT_GOLDEN = new Set(["manifest.json", "catalog.json", "lis.json"]);

interface Golden {
  id: string;
  fields: Record<string, { value: string } | null>;
  tests: { value: string; codes: string[] }[];
  lis: { insurer_id: string | null };
  context: { language?: string };
}

const setKey = (codes: string[]) => [...codes].sort().join(",");

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { dataset: { type: "string" }, out: { type: "string" } } });
  if (!values.dataset) {
    console.error("usage: npm run search-compare -- --dataset <dir> [--out <dir>]");
    return 1;
  }
  const dataset = path.resolve(values.dataset);
  const id = `${timestamp(new Date())}-${path.basename(dataset)}`;
  const outDir = path.resolve(values.out ?? path.join("..", "data", "search", id));
  const read = async <T>(file: string) => JSON.parse(await fs.readFile(path.join(dataset, file), "utf8")) as T;

  const catalog = catalogFromFile(await read<CatalogFile>("catalog.json"));
  const dataDir = path.resolve("..", "data");
  const started = Date.now();
  const embedder = await Embedder.open(path.join(dataDir, "models"), path.join(dataDir, "embeddings"));
  const lexical = new CatalogIndex(catalog);
  const semantic = await EmbeddingSearch.build(catalog, embedder);
  const methods: Record<string, Searcher> = {
    lexical,
    embedding: semantic,
    hybrid: new HybridSearch(lexical, semantic),
  };
  const catalogMs = Date.now() - started;

  const files = (await fs.readdir(dataset)).filter((f) => f.endsWith(".json") && !NOT_GOLDEN.has(f)).sort();
  const seen = new Set<string>();
  const lines: { scope: string; language: string; text: string; truth: string[] }[] = [];
  for (const file of files) {
    const g = await read<Golden>(file);
    const insurer = g.fields.NombreMutua?.value ?? null;
    const scope = g.lis.insurer_id ?? (insurer ? `name:${compareKey(insurer, "casefold")}` : "none");
    for (const t of g.tests) {
      const k = `${scope}\u0000${compareKey(t.value, "casefold")}`;
      if (seen.has(k)) continue;
      seen.add(k);
      lines.push({ scope, language: g.context.language ?? "es", text: t.value, truth: [...t.codes].sort() });
    }
  }

  const timing: Record<string, number> = {};
  const out: string[] = [];
  const rows = lines.map((l) => ({ ...l, methods: {} as Record<string, unknown> }));
  for (const [name, searcher] of Object.entries(methods)) {
    const t0 = Date.now();
    for (const row of rows) {
      const c = await searcher.search(row.text, CANDIDATES);
      const at = c.findIndex((x) => setKey(x.codes) === setKey(row.truth));
      row.methods[name] = {
        top1_right: at === 0,
        rank: at < 0 ? null : at + 1,
        top1: c[0]?.score ?? 0,
        top2: c[1]?.score ?? 0,
      };
    }
    timing[name] = Math.round((Date.now() - t0) / rows.length * 100) / 100;
  }
  for (const row of rows) out.push(JSON.stringify(row));
  await embedder.save();

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "lines.jsonl"), `${out.join("\n")}\n`);
  const manifest = {
    search_id: id,
    search_version: 1,
    dataset: path.relative(path.resolve(".."), dataset),
    lines: rows.length,
    methods: Object.keys(methods),
    embedding_model: EMBEDDING_MODEL,
    candidates: CANDIDATES,
    ms_per_line: timing,
    catalog_setup_ms: catalogMs,
    created_at: new Date().toISOString(),
  };
  await fs.writeFile(path.join(outDir, "search.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`search ${id}: ${rows.length} distinct lines; ms per line ${JSON.stringify(timing)}; catalog setup ${catalogMs} ms`);
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
