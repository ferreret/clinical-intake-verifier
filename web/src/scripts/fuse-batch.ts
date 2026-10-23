/**
 * Run the fusion engine over a set of predictions and write one fused document each plus a
 * fusion.json (scored by `intake-synth evaluate-fusion`).
 *
 *   npm run fuse -- --golden ../data/synth/seed-42 [--run ../data/runs/<run-id>]
 *                   [--db ../data/lis/seed-42.sqlite] [--out ../data/fusion/<fusion-id>]
 *
 * Without --run, every golden is turned into the prediction a perfect extractor would make,
 * which measures the fusion engine alone. With --run, the run's predictions are fused.
 * The LIS is read from the database `npm run seed-lis` loads.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { fuse } from "@/lib/fusion/fuse";
import { perfectPrediction, type GoldenLike } from "@/lib/fusion/perfect";
import { FUSION_VERSION, type FusedDocument } from "@/lib/fusion/types";
import { openLis } from "@/lib/lis/db";
import { readSnapshot } from "@/lib/lis/snapshot";
import { FIELDS_VERSION } from "@/lib/schema/fields";
import { assertPrediction, type Prediction } from "@/lib/schema/prediction";

const NOT_GOLDEN = new Set(["manifest.json", "catalog.json", "lis.json"]);
const PREDICTION_SUFFIX = ".pred.json";

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function predictions(goldenDir: string, runDir: string | undefined): Promise<Prediction[]> {
  if (runDir) {
    const files = (await fs.readdir(runDir)).filter((f) => f.endsWith(PREDICTION_SUFFIX)).sort();
    const out: Prediction[] = [];
    for (const f of files) {
      const doc: unknown = await readJson(path.join(runDir, f));
      assertPrediction(doc);
      out.push(doc);
    }
    return out;
  }
  const files = (await fs.readdir(goldenDir)).filter((f) => f.endsWith(".json") && !NOT_GOLDEN.has(f)).sort();
  return Promise.all(files.map(async (f) => perfectPrediction(await readJson<GoldenLike>(path.join(goldenDir, f)))));
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      golden: { type: "string" },
      run: { type: "string" },
      db: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.golden) {
    console.error("usage: npm run fuse -- --golden <golden dir> [--run <run dir>] [--db <lis.sqlite>] [--out <dir>]");
    return 1;
  }
  const goldenDir = path.resolve(values.golden);
  const runDir = values.run ? path.resolve(values.run) : undefined;
  const dbFile = path.resolve(values.db ?? path.join("..", "data", "lis", `${path.basename(goldenDir)}.sqlite`));
  try {
    await fs.access(dbFile);
  } catch {
    console.error(`no LIS database at ${dbFile}; load it with: npm run seed-lis -- ${path.join(goldenDir, "lis.json")} ${dbFile}`);
    return 1;
  }

  const input = runDir ? path.basename(runDir) : "golden";
  const fusionId = `${timestamp(new Date())}-${input}`;
  const outDir = path.resolve(values.out ?? path.join("..", "data", "fusion", fusionId));
  await fs.mkdir(outDir, { recursive: true });

  const db = await openLis(`file:${dbFile}`);
  const lis = await readSnapshot(db);
  db.$client.close();

  const docs: FusedDocument[] = (await predictions(goldenDir, runDir)).map((p) => fuse(p, lis));
  for (const d of docs) {
    await fs.writeFile(path.join(outDir, `${d.id}.fused.json`), `${JSON.stringify(d, null, 2)}\n`);
  }
  const relative = (p: string) => path.relative(path.resolve(".."), p);
  const manifest = {
    fusion_id: fusionId,
    fusion_version: FUSION_VERSION,
    fields_version: FIELDS_VERSION,
    source: relative(goldenDir),
    predictions: runDir ? relative(runDir) : "golden",
    lis: relative(dbFile),
    created_at: new Date().toISOString(),
    documents: docs.map((d) => ({ id: d.id, fused: `${d.id}.fused.json` })),
  };
  await fs.writeFile(path.join(outDir, "fusion.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const tally = (pick: (d: FusedDocument) => string[]) => {
    const t: Record<string, number> = {};
    for (const d of docs) for (const k of pick(d)) t[k] = (t[k] ?? 0) + 1;
    return Object.entries(t)
      .sort()
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
  };
  console.log(`fusion ${fusionId}: ${docs.length} document(s), LIS ${patientsLine(lis)}`);
  console.log(`  patient links : ${tally((d) => [d.links.patient.status])}`);
  console.log(`  field states  : ${tally((d) => d.fields.map((f) => f.state))}`);
  console.log(`  written to    : ${outDir}`);
  return 0;
}

function patientsLine(lis: { patients: unknown[]; physicians: unknown[]; insurers: unknown[] }): string {
  return `${lis.patients.length} patients, ${lis.physicians.length} physicians, ${lis.insurers.length} insurers`;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
