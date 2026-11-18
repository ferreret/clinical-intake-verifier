/**
 * Where a batch's PDFs come from, and the recorded replies replay mode serves for them.
 *
 * Bundled documents are the synthetic set shipped with the demo. Uploads exist in live mode
 * only and are kept under the data directory, outside the repository, since they may be real.
 * Private documents are a deployment's private set (config.ts, privateSetConfig), outside the
 * image, offered only to a workspace that unlocked it (private-set.ts). A recording is an
 * extractor run (`npm run extract`), its predictions found by the PDF's hash.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { readPages } from "@/lib/extractor/pdf";
import type { Prediction } from "@/lib/schema/prediction";

import { bundledDir, dataDir, privateSetConfig, replayRun, type PrivateSetConfig, type Provider } from "./config";
import type { DocumentOrigin } from "./schema";

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

/** Each run, read once: a new recording is served once the app starts again. */
const recordings = new Map<string, Promise<Recording>>();

/** The predictions of a recorded run, by PDF hash and by PDF name. */
function recording(run: string): Promise<Recording> {
  let r = recordings.get(run);
  if (!r) {
    r = (async () => {
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
    recordings.set(run, r);
  }
  return r;
}

async function pdfsIn(dir: string): Promise<string[]> {
  return (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".pdf") && !n.startsWith(".")).sort();
}

/** The bundled PDFs; in replay mode, only those the provider has a recorded reply for. */
export async function listBundled(provider: Provider | null): Promise<string[]> {
  const names = await pdfsIn(bundledDir());
  if (provider === null) return names;
  const { files } = await recording(replayRun(provider));
  return names.filter((n) => files.has(n));
}

/** Where the private set keeps its PDFs, its recorded runs and its mapping replies. */
export const privateSetPaths = (set: PrivateSetConfig) => ({
  documents: path.join(set.dir, "documents"),
  run: (provider: Provider) => path.join(set.dir, "runs", provider),
  mapping: path.join(set.dir, "mapping.json"),
});

/**
 * The private set's PDFs, none when the deployment has no set; in replay mode, only those the
 * provider has a recorded reply for. Whether the workspace may see them is the caller's to ask
 * (private-set.ts, privateSetOpen).
 */
export async function listPrivate(provider: Provider | null): Promise<string[]> {
  const set = privateSetConfig();
  if (!set) return [];
  const paths = privateSetPaths(set);
  const names = await pdfsIn(paths.documents);
  if (provider === null) return names;
  const { files } = await recording(paths.run(provider));
  return names.filter((n) => files.has(n));
}

/** Pages of each private PDF, counted once per version of the file. */
const privatePages = new Map<string, Promise<number | null>>();

/**
 * What the new-batch screen says about private documents: scans rebuilt from their page images
 * (docs/anonymize.md), with no golden beside them, so their pages are counted from the PDF.
 */
export async function describePrivate(names: string[]): Promise<BundledInfo[]> {
  const set = privateSetConfig();
  if (!set) return [];
  const dir = privateSetPaths(set).documents;
  return Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, plainName(name));
      const stat = await fs.stat(file).catch(() => null);
      const key = `${file}:${stat?.mtimeMs}:${stat?.size}`;
      let pages = privatePages.get(key);
      if (!pages) {
        pages = fs.readFile(file).then(
          async (pdf) => (await readPages(new Uint8Array(pdf))).length,
          () => null,
        );
        privatePages.set(key, pages);
      }
      return { name, pages: await pages.catch(() => null), scanned: true, handwritten: null, language: null, template: null };
    }),
  );
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

export async function readPrivate(name: string): Promise<Buffer> {
  const set = privateSetConfig();
  // The deployment's settings no longer name it: its documents in older batches cannot be read.
  if (!set) throw new Error("the private set is not available");
  return fs.readFile(path.join(privateSetPaths(set).documents, plainName(name)));
}

/** A batch document's PDF, wherever it came from. */
export function readSource(doc: { origin: DocumentOrigin; location: string }): Promise<Buffer> {
  if (doc.origin === "bundled") return readBundled(doc.location);
  if (doc.origin === "private") return readPrivate(doc.location);
  return readUpload(doc.location);
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

/** The recorded prediction for this PDF, or null when the provider's run has none: the demo's, or the private set's. */
export async function recordedPrediction(provider: Provider, sha256: string): Promise<Prediction | null> {
  const set = privateSetConfig();
  const runs = [replayRun(provider), ...(set ? [privateSetPaths(set).run(provider)] : [])];
  for (const run of runs) {
    const file = (await recording(run)).bySha.get(sha256);
    if (file) return JSON.parse(await fs.readFile(file, "utf8")) as Prediction;
  }
  return null;
}
