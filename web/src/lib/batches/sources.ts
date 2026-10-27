/**
 * Where a batch's PDFs come from, and the recorded replies replay mode serves for them.
 *
 * Bundled documents are the synthetic set shipped with the demo. Uploads exist in live mode
 * only and are kept under the data directory, outside the repository, since they may be real.
 * A recording is an extractor run (`npm run extract`), its predictions found by the PDF's hash.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Prediction } from "@/lib/schema/prediction";

import { bundledDir, dataDir, replayRun, type Provider } from "./config";

const PREDICTION_SUFFIX = ".pred.json";

/** A plain file name: nothing that could climb out of its directory. */
function plainName(name: string): string {
  if (name !== path.basename(name) || name.startsWith(".")) throw new Error(`not a plain file name: ${name}`);
  return name;
}

interface Recording {
  bySha: Map<string, string>;
  files: Set<string>;
}

const recordings = new Map<Provider, Promise<Recording>>();

/** The predictions of the provider's recorded run, by PDF hash and by PDF name. */
function recording(provider: Provider): Promise<Recording> {
  let r = recordings.get(provider);
  if (!r) {
    r = (async () => {
      const run = replayRun(provider);
      const names = (await fs.readdir(run).catch(() => [] as string[])).filter((n) => n.endsWith(PREDICTION_SUFFIX));
      const bySha = new Map<string, string>();
      const files = new Set<string>();
      for (const n of names) {
        const p = JSON.parse(await fs.readFile(path.join(run, n), "utf8")) as Prediction;
        bySha.set(p.sha256, path.join(run, n));
        files.add(p.file);
      }
      return { bySha, files };
    })();
    recordings.set(provider, r);
  }
  return r;
}

/** The bundled PDFs; in replay mode, only those the provider has a recorded reply for. */
export async function listBundled(provider: Provider | null): Promise<string[]> {
  const names = (await fs.readdir(bundledDir()).catch(() => [] as string[])).filter((n) => n.endsWith(".pdf")).sort();
  if (provider === null) return names;
  const { files } = await recording(provider);
  return names.filter((n) => files.has(n));
}

/** What the demo says about a bundled document, from its golden when it is next to it. */
export interface BundledInfo {
  name: string;
  pages: number | null;
  scanned: boolean | null;
  /** Fields written by hand. */
  handwritten: number | null;
  language: string | null;
  template: string | null;
}

export async function describeBundled(names: string[]): Promise<BundledInfo[]> {
  return Promise.all(
    names.map(async (name) => {
      const golden = await fs
        .readFile(path.join(bundledDir(), plainName(name).replace(/\.pdf$/, ".json")), "utf8")
        .then((t) => JSON.parse(t) as GoldenInfo)
        .catch(() => null);
      return {
        name,
        pages: golden?.pages?.length ?? null,
        scanned: golden?.generator ? golden.generator.scan !== null : null,
        handwritten: golden?.generator?.handwritten_fields?.length ?? null,
        language: golden?.context?.language ?? null,
        template: golden?.generator?.template ?? null,
      };
    }),
  );
}

interface GoldenInfo {
  pages?: unknown[];
  generator?: { template?: string; scan?: unknown; handwritten_fields?: string[] };
  context?: { language?: string };
}

export function readBundled(name: string): Promise<Buffer> {
  return fs.readFile(path.join(bundledDir(), plainName(name)));
}

function uploadsDir(): string {
  return path.join(dataDir(), "uploads");
}

/** Keeps an uploaded PDF; returns where it is, for `readUpload`. */
export async function saveUpload(pdf: Uint8Array): Promise<string> {
  const name = `${randomUUID()}.pdf`;
  await fs.mkdir(uploadsDir(), { recursive: true });
  await fs.writeFile(path.join(uploadsDir(), name), pdf);
  return name;
}

export function readUpload(location: string): Promise<Buffer> {
  return fs.readFile(path.join(uploadsDir(), plainName(location)));
}

/** Removes an uploaded PDF, when the batch it was uploaded for is deleted. */
export function deleteUpload(location: string): Promise<void> {
  return fs.unlink(path.join(uploadsDir(), plainName(location)));
}

/** The recorded prediction for this PDF, or null when the provider's run has none. */
export async function recordedPrediction(provider: Provider, sha256: string): Promise<Prediction | null> {
  const file = (await recording(provider)).bySha.get(sha256);
  return file ? (JSON.parse(await fs.readFile(file, "utf8")) as Prediction) : null;
}
