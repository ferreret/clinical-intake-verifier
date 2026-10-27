/**
 * Packs what the replay demo serves into one archive, for the container image to fetch at
 * build time (docs/deploy.md): data/ is outside version control, and every file in it is
 * synthetic, made by the project.
 *
 *   npm run pack-demo -- [--out ../data/dist]
 *
 * The archive, demo-data-<date>.tar.gz, holds under demo/:
 * - documents/: the bundled synthetic PDFs and their goldens (what the new-batch screen says
 *   about each: pages, scanned, handwriting, language);
 * - runs/gemini/ and runs/local/: the extractor's recorded predictions;
 * - lis.sqlite: the template, with the LIS, the catalog and the starting memory;
 * - mapping.json: the mapping model's recorded replies;
 * - manifest.json: where each part came from.
 * Its sha256 is printed, for the Dockerfile's DEMO_DATA_SHA256.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { bundledDir, replayMapping, replayRun, templateDb } from "@/lib/batches/config";

const run = promisify(execFile);

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function copyMatching(from: string, to: string, keep: (name: string) => boolean): Promise<number> {
  await mkdir(to, { recursive: true });
  const names = (await readdir(from)).filter(keep);
  for (const n of names) await copyFile(path.join(from, n), path.join(to, n));
  return names.length;
}

async function main(): Promise<void> {
  const out = path.resolve(option("out", "../data/dist"));
  const stage = await mkdtemp(path.join(os.tmpdir(), "civ-demo-"));
  const demo = path.join(stage, "demo");
  try {
    const sources = {
      documents: bundledDir(),
      gemini: replayRun("gemini"),
      local: replayRun("local"),
      template: templateDb(),
      mapping: replayMapping(),
    };
    const counts = {
      documents: await copyMatching(sources.documents, path.join(demo, "documents"), (n) => /^synth-\d+\.(pdf|json)$/.test(n)),
      gemini: await copyMatching(sources.gemini, path.join(demo, "runs", "gemini"), (n) => n.endsWith(".pred.json")),
      local: await copyMatching(sources.local, path.join(demo, "runs", "local"), (n) => n.endsWith(".pred.json")),
    };
    await copyFile(sources.template, path.join(demo, "lis.sqlite"));
    await copyFile(sources.mapping, path.join(demo, "mapping.json"));
    const date = new Date().toISOString().slice(0, 10);
    const manifest = {
      created_at: new Date().toISOString(),
      sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, path.relative(process.cwd(), v)])),
      files: counts,
    };
    await writeFile(path.join(demo, "manifest.json"), JSON.stringify(manifest, null, 2));

    await mkdir(out, { recursive: true });
    const archive = path.join(out, `demo-data-${date}.tar.gz`);
    // Owner, group and times fixed, so the same data makes the same archive.
    await run("tar", ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", "--mtime=2026-01-01", "-czf", archive, "-C", stage, "demo"]);
    const sha = createHash("sha256").update(await readFile(archive)).digest("hex");
    console.log(`${archive}: ${counts.documents / 2} documents, ${counts.gemini} + ${counts.local} recorded readings`);
    console.log(`sha256 ${sha}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
