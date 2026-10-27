/**
 * Records the mapping model's replies for the demo (mapping/recorded.ts): for every document
 * of the given extractor runs, the model is asked about all its lines at once, with the whole
 * form as context, and each line's answer is kept. Replay mode then serves them to whichever
 * lines are red, whatever the sandbox's memory.
 *
 *   npm run record-mapping -- [--provider gemini] [--runs <run dir>,<run dir>]
 *                             [--out <file>] [--template <db>] [--limit n] [--parallel 4]
 *
 * Replies are cached by request (MAPPING_MODEL_CACHE), so a second run costs nothing. The
 * request is the one the app makes: the insurer as read, the form's lines, Spanish. Runs
 * reading the same PDF share its recording: a later run asks only about lines it read
 * differently.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { modelCacheDir } from "@/lib/batches/config";
import { openLis } from "@/lib/lis/db";
import { readCatalog } from "@/lib/mapping/catalog";
import { consult, MAPPING_PROMPT_VERSION, resolveProvider, type ModelLine } from "@/lib/mapping/model";
import { CANDIDATES, textKey } from "@/lib/mapping/propose";
import { RECORDING_VERSION, type RecordedMapping } from "@/lib/mapping/recorded";
import { CatalogIndex } from "@/lib/mapping/search";
import type { Prediction } from "@/lib/schema/prediction";

import { loadDotEnv } from "./env";

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  await loadDotEnv(".env.local");
  const providerName = option("provider", "gemini");
  const runs = option("runs", "../data/runs/20261026-gemini-3.8-flash-p6,../data/runs/20261026-qwen3.6-35b-a3b-p6-ocr").split(",");
  const out = option("out", `../data/replay/mapping-${providerName}.json`);
  const template = option("template", "../data/lis/seed-42.sqlite");
  const limit = Number(option("limit", "0"));
  const parallel = Number(option("parallel", providerName === "gemini" ? "4" : "1"));

  const db = await openLis(`file:${path.resolve(template)}`);
  const catalog = await readCatalog(db);
  db.$client.close();
  const index = new CatalogIndex(catalog);
  const provider = resolveProvider(providerName);

  const predictions: Prediction[] = [];
  for (const run of runs) {
    const names = (await readdir(run)).filter((n) => n.endsWith(".pred.json")).sort();
    for (const n of limit > 0 ? names.slice(0, limit) : names) {
      const p = JSON.parse(await readFile(path.join(run, n), "utf8")) as Prediction;
      if (!p.extractor.error && p.tests.length > 0) predictions.push(p);
    }
  }

  const recording: RecordedMapping = {
    recording_version: RECORDING_VERSION,
    provider: provider.name,
    model: provider.model,
    prompt_version: MAPPING_PROMPT_VERSION,
    recorded_at: new Date().toISOString(),
    documents: {},
  };
  const totals = { asked: 0, cached: 0, skipped: 0, inputTokens: 0, outputTokens: 0, lines: 0, answered: 0 };
  let next = 0;
  async function worker() {
    while (next < predictions.length) {
      const p = predictions[next++];
      const lines = p.tests.map((t) => t.value);
      // Another run read the same PDF: only the lines it read differently are asked.
      const known = recording.documents[p.sha256]?.lines ?? {};
      const missing = lines.map((text, i) => ({ text, i })).filter(({ text }) => !(textKey(text) in known));
      if (missing.length === 0) {
        totals.skipped += 1;
        continue;
      }
      const asked: ModelLine[] = await Promise.all(
        missing.map(async ({ text, i }) => ({ id: `L${i + 1}`, text, candidates: await index.search(text, CANDIDATES) })),
      );
      const insurer = p.fields.NombreMutua?.value ?? null;
      const c = await consult({ insurer, language: "es", formLines: lines, lines: asked }, catalog, provider, modelCacheDir());
      const doc = (recording.documents[p.sha256] ??= { latency_ms: c.latencyMs, lines: {} });
      for (const line of asked) {
        doc.lines[textKey(line.text)] = c.choices.get(line.id) ?? null;
        totals.lines += 1;
        if (c.choices.get(line.id)) totals.answered += 1;
      }
      totals.asked += c.cached ? 0 : 1;
      totals.cached += c.cached ? 1 : 0;
      totals.inputTokens += c.cached ? 0 : (c.usage.inputTokens ?? 0);
      totals.outputTokens += c.cached ? 0 : (c.usage.outputTokens ?? 0);
      const done = totals.asked + totals.cached + totals.skipped;
      if (done % 20 === 0) console.log(`${done}/${predictions.length} documents`);
    }
  }
  await Promise.all(Array.from({ length: parallel }, worker));

  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(recording));
  console.log(
    `${out}: ${Object.keys(recording.documents).length} documents, ${totals.lines} lines (${totals.answered} with codes); ` +
      `${totals.asked} asked, ${totals.cached} from the cache, ${totals.skipped} already recorded from another run; ` +
      `${totals.inputTokens} input and ${totals.outputTokens} output tokens`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
