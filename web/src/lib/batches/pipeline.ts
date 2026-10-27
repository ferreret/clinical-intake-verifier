/**
 * The chain one document goes through before a technician sees it: read (the extractor, or
 * its recorded reply in replay mode), fused against the workspace's LIS, its lines mapped to
 * the lab's codes. The result is a proposal; nothing in it is accepted until approved.
 */
import { DEFAULT_MODEL, extract } from "@/lib/extractor";
import { resolveLocalModel } from "@/lib/extractor/local";
import { fuse } from "@/lib/fusion/fuse";
import type { FusedDocument } from "@/lib/fusion/types";
import type { LisDb } from "@/lib/lis/db";
import { readSnapshot } from "@/lib/lis/snapshot";
import { readCatalog, type Catalog } from "@/lib/mapping/catalog";
import { proposeDocument, type ModelOptions } from "@/lib/mapping/document";
import { DbMemory } from "@/lib/mapping/memory";
import { resolveProvider, type Provider as MappingProvider } from "@/lib/mapping/model";
import { CatalogIndex } from "@/lib/mapping/search";
import { compareKey } from "@/lib/schema/compare";
import type { Prediction } from "@/lib/schema/prediction";

import { appMode, modelCacheDir, replaySpeed, type AppMode, type Provider } from "./config";
import type { TestProposal } from "./schema";
import { recordedPrediction } from "./sources";

export class ProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessingError";
  }
}

export interface Reading {
  prediction: Prediction;
  /** The reply was recorded, not asked for now. */
  recorded: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The extractor's reading of the PDF: called live, or recorded and served after its latency. */
export async function readDocument(
  pdf: Uint8Array,
  doc: { id: string; fileName: string; sha256: string },
  provider: Provider,
  mode: AppMode = appMode(),
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Reading> {
  let prediction: Prediction;
  if (mode === "live") {
    prediction = await extract(pdf, { provider, file: doc.fileName, id: doc.id });
  } else {
    const recorded = await recordedPrediction(provider, doc.sha256);
    if (!recorded) throw new ProcessingError(`no recorded ${provider} reply for ${doc.fileName}`);
    await wait(recorded.extractor.latency_ms / replaySpeed());
    prediction = recorded;
  }
  const error = prediction.extractor.error;
  if (error) throw new ProcessingError(`the extractor failed: ${error.code}: ${error.message}`);
  return { prediction, recorded: mode === "replay" };
}

/** In replay mode, the mapping model answers from its recorded replies only. */
class RecordedReplies implements MappingProvider {
  constructor(
    readonly name: "gemini" | "local",
    readonly model: string,
  ) {}

  async complete(): Promise<never> {
    throw Object.assign(new Error("no recorded reply for this request"), { retryable: false });
  }
}

function mappingProvider(mode: AppMode): MappingProvider | null {
  if (mode === "replay") {
    const name = process.env.MAPPING_MODEL_PROVIDER?.trim() === "gemini" ? "gemini" : "local";
    const model = name === "gemini" ? process.env.MAPPING_GEMINI_MODEL?.trim() || DEFAULT_MODEL : resolveLocalModel();
    return new RecordedReplies(name, model);
  }
  try {
    return resolveProvider();
  } catch (err) {
    console.warn(`test mapping without its model: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const catalogs = new WeakMap<LisDb, Promise<{ catalog: Catalog; index: CatalogIndex }>>();

/** The workspace's catalog and its search index, read once. */
export function catalogOf(db: LisDb) {
  let c = catalogs.get(db);
  if (!c) {
    c = readCatalog(db).then((catalog) => ({ catalog, index: new CatalogIndex(catalog) }));
    catalogs.set(db, c);
  }
  return c;
}

/**
 * Whose approvals a document's lines are looked up in, and taught to: its insurer's record
 * when linked, else the insurer as printed, else none. The same for proposing and learning.
 */
export function memoryScope(fused: FusedDocument, prediction: Prediction): string {
  const insurer = prediction.fields.NombreMutua?.value ?? null;
  const link = fused.links.insurer;
  if (link.status === "linked" && link.recordId) return link.recordId;
  return insurer ? `name:${compareKey(insurer, "casefold")}` : "none";
}

/** The fusion and the codes proposed for each line, from what the workspace knows now. */
export async function proposeFor(
  db: LisDb,
  prediction: Prediction,
  mode: AppMode = appMode(),
): Promise<{ fused: FusedDocument; tests: TestProposal[] }> {
  const fused = fuse(prediction, await readSnapshot(db));
  const { catalog, index } = await catalogOf(db);
  const insurer = prediction.fields.NombreMutua?.value ?? null;
  // The form's language is not read by the extractor; the model is told Spanish.
  const ctx = { scope: memoryScope(fused, prediction), insurer, language: "es" };
  const lines = prediction.tests.map((t) => t.value);
  const memory = new DbMemory(db);
  const provider = mappingProvider(mode);
  const model: ModelOptions | undefined = provider
    ? { provider, policy: "red", catalog, cacheDir: modelCacheDir() }
    : undefined;

  let proposals;
  try {
    ({ proposals } = await proposeDocument(lines, ctx, memory, index, undefined, model));
  } catch (err) {
    // Without the model, red lines stay red: the technician chooses their codes. In replay
    // mode that is what a request with no recorded reply gets, and says nothing worth logging.
    if (!model) throw err;
    if (mode === "live") console.warn(`test mapping without its model: ${err instanceof Error ? err.message : String(err)}`);
    ({ proposals } = await proposeDocument(lines, ctx, memory, index));
  }
  const tests = prediction.tests.map((t, i) => ({
    text: t.value,
    page: t.page,
    bbox: t.bbox,
    ...(t.box_source ? { box_source: t.box_source } : {}),
    mapping: proposals[i],
  }));
  return { fused, tests };
}
