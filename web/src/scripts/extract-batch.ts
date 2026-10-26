/**
 * Run the extractor over a directory of PDFs and write one prediction per document plus a
 * run.json (docs/extractor-contract.md, "Batch runs").
 *
 *   npm run extract -- --in ../data/synth/seed-42 [--out ../data/runs/<run-id>] [--limit 20]
 *                      [--provider gemini|local] [--concurrency 4] [--model gemini-x]
 *                      [--only synth-000003,synth-000007] [--force]
 *
 * The provider defaults to EXTRACTOR_PROVIDER, else gemini. The local model answers one
 * request at a time, so its concurrency defaults to 1. Experiments with the local model:
 * [--dpi 200] renders the pages at another resolution, [--grounding] locates the values again
 * in a second pass per page; both are recorded under `options` in run.json.
 *
 * Reads only the PDFs: golden files are never opened here.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  extract,
  INPUT_MODE_OF,
  PROMPT_VERSION,
  PROVIDERS,
  resolveModel,
  resolveProvider,
  type Provider,
  type RawReply,
} from "@/lib/extractor";

import { loadDotEnv } from "./env";
import type { Prediction } from "@/lib/schema/prediction";

interface RunDocument {
  id: string;
  prediction: string;
  ok: boolean;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  warnings: number;
}

interface RunManifest {
  run_id: string;
  source: string;
  model: string;
  prompt_version: string;
  input_mode: string;
  /** Local-model experiments, when any was used. */
  options?: { dpi?: number; grounding?: boolean };
  temperature: number;
  started_at: string;
  finished_at: string | null;
  documents: RunDocument[];
  totals: {
    documents: number;
    failed: number;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
  };
}

function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, doc: unknown): Promise<void> {
  await fs.writeFile(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

function toRunDocument(p: Prediction, predictionFile: string): RunDocument {
  return {
    id: p.id,
    prediction: predictionFile,
    ok: p.extractor.error === null,
    latency_ms: p.extractor.latency_ms,
    input_tokens: p.extractor.usage.input_tokens,
    output_tokens: p.extractor.usage.output_tokens,
    warnings: p.warnings.length,
  };
}

function totals(docs: RunDocument[]): RunManifest["totals"] {
  return {
    documents: docs.length,
    failed: docs.filter((d) => !d.ok).length,
    input_tokens: docs.reduce((s, d) => s + (d.input_tokens ?? 0), 0),
    output_tokens: docs.reduce((s, d) => s + (d.output_tokens ?? 0), 0),
    latency_ms: docs.reduce((s, d) => s + d.latency_ms, 0),
  };
}

async function main(): Promise<number> {
  await loadDotEnv(path.resolve(process.cwd(), ".env.local"));

  const { values } = parseArgs({
    options: {
      in: { type: "string" },
      out: { type: "string" },
      limit: { type: "string" },
      provider: { type: "string" },
      dpi: { type: "string" },
      grounding: { type: "boolean", default: false },
      concurrency: { type: "string" },
      model: { type: "string" },
      only: { type: "string" },
      force: { type: "boolean", default: false },
    },
  });
  if (!values.in) {
    console.error(
      "usage: npm run extract -- --in <dir of PDFs> [--out <dir>] [--limit N] [--provider gemini|local] [--concurrency N] [--model id] [--only id,id] [--force]",
    );
    return 1;
  }
  if (values.provider !== undefined && !(PROVIDERS as readonly string[]).includes(values.provider)) {
    console.error(`unknown provider "${values.provider}": use ${PROVIDERS.join(" or ")}`);
    return 1;
  }
  const provider = (values.provider as Provider | undefined) ?? resolveProvider();
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set (put it in web/.env.local)");
    return 1;
  }

  const model = values.model ?? resolveModel(provider);
  const inputMode = INPUT_MODE_OF[provider];
  const inDir = path.resolve(values.in);
  // Local model ids have a publisher prefix ("qwen/..."), which cannot go in a directory name.
  const runId = `${timestamp(new Date())}-${model.replaceAll("/", "-")}-p${PROMPT_VERSION}`;
  const outDir = path.resolve(values.out ?? path.join(process.cwd(), "..", "data", "runs", runId));
  const dpi = values.dpi ? Number.parseInt(values.dpi, 10) : undefined;
  const grounding = values.grounding ?? false;
  if ((dpi !== undefined || grounding) && provider !== "local") {
    console.error("--dpi and --grounding apply to the local provider only");
    return 1;
  }
  if (dpi !== undefined && !(dpi >= 50 && dpi <= 400)) {
    console.error("--dpi must be between 50 and 400");
    return 1;
  }
  const options = dpi !== undefined || grounding ? { ...(dpi !== undefined && { dpi }), ...(grounding && { grounding }) } : undefined;
  const defaultConcurrency = provider === "local" ? "1" : "4";
  const concurrency = Math.max(1, Number.parseInt(values.concurrency ?? defaultConcurrency, 10) || 1);
  const limit = values.limit ? Number.parseInt(values.limit, 10) : undefined;
  const only = values.only ? new Set(values.only.split(",").map((s) => s.trim()).filter(Boolean)) : null;

  let pdfs = (await fs.readdir(inDir)).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  if (only) pdfs = pdfs.filter((f) => only.has(f.replace(/\.pdf$/i, "")));
  if (limit !== undefined) pdfs = pdfs.slice(0, limit);
  if (pdfs.length === 0) {
    console.error(`no PDFs to process in ${inDir}`);
    return 1;
  }

  await fs.mkdir(outDir, { recursive: true });
  const manifestFile = path.join(outDir, "run.json");
  const previous = await readJson<RunManifest>(manifestFile);
  const manifest: RunManifest = previous ?? {
    run_id: path.basename(outDir),
    source: path.relative(path.resolve(process.cwd(), ".."), inDir).split(path.sep).join("/"),
    model,
    prompt_version: PROMPT_VERSION,
    input_mode: inputMode,
    ...(options && { options }),
    temperature: 0,
    started_at: new Date().toISOString(),
    finished_at: null,
    documents: [],
    totals: totals([]),
  };
  const documents = new Map(manifest.documents.map((d) => [d.id, d]));

  const flush = async () => {
    manifest.documents = [...documents.values()].sort((a, b) => a.id.localeCompare(b.id));
    manifest.totals = totals(manifest.documents);
    await writeJson(manifestFile, manifest);
  };

  console.log(`run ${manifest.run_id}: ${pdfs.length} PDF(s) from ${inDir}`);
  console.log(
    `${provider} model ${model}, prompt v${PROMPT_VERSION}, ${inputMode}, concurrency ${concurrency}` +
      (options ? `, options ${JSON.stringify(options)}` : ""),
  );
  console.log(`writing to ${outDir}`);

  let skipped = 0;
  let next = 0;
  const worker = async () => {
    while (next < pdfs.length) {
      const file = pdfs[next++];
      const id = file.replace(/\.pdf$/i, "");
      const predictionFile = `${id}.pred.json`;
      const predictionPath = path.join(outDir, predictionFile);

      if (!values.force) {
        const existing = await readJson<Prediction>(predictionPath);
        if (
          existing &&
          existing.extractor.error === null &&
          existing.extractor.model === model &&
          existing.extractor.prompt_version === PROMPT_VERSION
        ) {
          skipped += 1;
          documents.set(id, toRunDocument(existing, predictionFile));
          continue;
        }
      }

      const bytes = new Uint8Array(await fs.readFile(path.join(inDir, file)));
      const replies: RawReply[] = [];
      const prediction = await extract(bytes, {
        id,
        file,
        provider,
        model,
        dpi,
        grounding,
        onReply: (r) => replies.push(r),
      });
      await writeJson(predictionPath, prediction);
      await writeJson(path.join(outDir, `${id}.raw.json`), {
        id,
        model,
        prompt_version: PROMPT_VERSION,
        replies,
      });
      documents.set(id, toRunDocument(prediction, predictionFile));
      await flush();

      const e = prediction.extractor;
      const seconds = (e.latency_ms / 1000).toFixed(1);
      if (e.error) {
        console.log(`  ${id}  FAIL ${e.error.code} after ${e.attempts} attempt(s): ${e.error.message}`);
      } else {
        const tokens = `in=${e.usage.input_tokens ?? "?"} out=${e.usage.output_tokens ?? "?"}`;
        const nulls = Object.values(prediction.fields).filter((f) => f === null).length;
        console.log(
          `  ${id}  ok ${seconds}s ${tokens} tests=${prediction.tests.length} null=${nulls} warn=${prediction.warnings.length}` +
            (e.attempts > 1 ? ` attempts=${e.attempts}` : ""),
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pdfs.length) }, worker));

  manifest.finished_at = new Date().toISOString();
  await flush();

  const t = manifest.totals;
  console.log("");
  console.log(`${t.documents} prediction(s) in ${outDir}${skipped ? ` (${skipped} reused)` : ""}`);
  console.log(`  failed : ${t.failed}`);
  console.log(`  tokens : in=${t.input_tokens} out=${t.output_tokens}`);
  console.log(`  latency: ${(t.latency_ms / 1000).toFixed(0)}s total`);
  return t.failed > 0 ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  },
);
