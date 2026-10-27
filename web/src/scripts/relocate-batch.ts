/**
 * Replace the boxes of an existing run with the page's OCR (src/lib/extractor/locate.ts) and
 * write the result as a new run, without calling the model again: the values stay exactly as
 * the model read them, so the harness measures the boxes alone.
 *
 *   npm run relocate -- --in ../data/runs/<run-id> [--out ../data/runs/<run-id>-ocr] [--limit 20]
 *
 * Reads the PDFs named in the run's predictions, from the source recorded in its run.json.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { relocateBoxes } from "@/lib/extractor/locate";
import { ocrPages } from "@/lib/extractor/ocr";
import { assertPrediction, type Prediction } from "@/lib/schema/prediction";

interface RunManifest {
  run_id: string;
  source: string;
  options?: Record<string, unknown>;
  documents: { id: string; prediction: string }[];
  totals?: unknown;
  [key: string]: unknown;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      in: { type: "string" },
      out: { type: "string" },
      limit: { type: "string" },
    },
  });
  if (!values.in) {
    console.error("usage: npm run relocate -- --in <run dir> [--out <dir>] [--limit N]");
    return 1;
  }
  const inDir = path.resolve(values.in);
  const outDir = path.resolve(values.out ?? `${inDir}-ocr`);
  if (outDir === inDir) {
    console.error("--out must differ from --in: the original run is kept for comparison");
    return 1;
  }
  const run = JSON.parse(await fs.readFile(path.join(inDir, "run.json"), "utf8")) as RunManifest;
  const source = path.resolve(process.cwd(), "..", run.source);
  const limit = values.limit ? Number.parseInt(values.limit, 10) : undefined;
  // A failed prediction has no value to place and is copied as it is.
  const documents = run.documents.slice(0, limit);
  await fs.mkdir(outDir, { recursive: true });

  // The documents of a run are independent: several at a time keep all OCR workers busy.
  process.env.OCR_WORKERS ??= String(Math.min(8, os.availableParallelism()));
  const started = Date.now();
  let located = 0;
  let asked = 0;
  let next = 0;
  const worker = async () => {
    while (next < documents.length) {
      const doc = documents[next++];
      const prediction = JSON.parse(await fs.readFile(path.join(inDir, doc.prediction), "utf8")) as Prediction;
      const pdf = new Uint8Array(await fs.readFile(path.join(source, prediction.file)));
      const result = relocateBoxes(prediction, await ocrPages(pdf));
      located += result.located;
      asked += result.asked;
      assertPrediction(prediction);
      await fs.writeFile(path.join(outDir, doc.prediction), JSON.stringify(prediction, null, 2) + "\n", "utf8");
      console.log(`  ${doc.id}  ${result.located}/${result.asked} boxes from OCR`);
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.OCR_WORKERS) }, worker));

  const manifest: RunManifest = {
    ...run,
    run_id: path.basename(outDir),
    options: { ...run.options, ocr_boxes: true, relocated_from: run.run_id },
    documents,
    // The totals are the model's, over the whole run: they no longer add up for a part of it.
    totals: limit === undefined ? run.totals : undefined,
  };
  await fs.writeFile(path.join(outDir, "run.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const seconds = (Date.now() - started) / 1000;
  console.log("");
  console.log(`${documents.length} prediction(s) in ${outDir}`);
  console.log(`  boxes from OCR: ${located} of ${asked}`);
  console.log(`  time: ${seconds.toFixed(0)}s (${(seconds / documents.length).toFixed(1)} s per document)`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  },
);
