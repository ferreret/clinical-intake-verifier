/**
 * How the app runs, from the environment (documented in .env.example).
 *
 * Two modes, one code path (docs/roadmap.md, section 5, "Batches"):
 * - replay, the public demo: the extractor's recorded replies are served, after the latency
 *   measured when they were recorded; each visitor works in a sandbox of their own;
 * - live, the development machine: the extractor is called, and PDFs can be uploaded; one
 *   workspace.
 */
import os from "node:os";
import path from "node:path";

import { PROVIDERS } from "./schema";

export type AppMode = "replay" | "live";
export type Provider = (typeof PROVIDERS)[number];

export function appMode(): AppMode {
  const mode = process.env.APP_MODE?.trim() || "replay";
  if (mode !== "replay" && mode !== "live") throw new Error(`unknown APP_MODE "${mode}": use replay or live`);
  return mode;
}

/**
 * A path from the environment, relative to the working directory (web/), or the default.
 * Data, not code: the build must not trace what is there.
 */
function dir(name: string, fallback: string): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env[name]?.trim() || fallback);
}

/**
 * Where workspaces and uploads are kept. Outside the repository by default: in live mode
 * they may hold real documents and what was read from them.
 */
export function dataDir(): string {
  return dir("APP_DATA_DIR", path.join(os.homedir(), ".clinical-intake-verifier"));
}

/**
 * The database every workspace starts as a copy of: the mock LIS and the catalog, seeded, with
 * the memory of earlier approved requests (scripts/seed-memory.ts), so that a sandbox starts
 * where a lab with some history would.
 */
export function templateDb(): string {
  return dir("LIS_TEMPLATE", "../data/lis/seed-42-demo.sqlite");
}

/** The bundled synthetic documents a batch can be made of. */
export function bundledDir(): string {
  return dir("DEMO_DOCUMENTS", "../data/synth/seed-42");
}

/** The extractor runs whose replies replay mode serves, per provider. */
export function replayRun(provider: Provider): string {
  return provider === "gemini"
    ? dir("REPLAY_GEMINI_RUN", "../data/runs/20261026-gemini-3.8-flash-p6")
    : dir("REPLAY_LOCAL_RUN", "../data/runs/20261026-qwen3.6-35b-a3b-p6-ocr");
}

/**
 * How much faster than recorded a replayed reply comes: 1 is the measured latency. Five times
 * by default, so a demo batch does not take minutes (product owner, 2026-10-27); the measured
 * latency is still what each document shows.
 */
export const DEFAULT_REPLAY_SPEED = 5;

export function replaySpeed(): number {
  const n = Number(process.env.REPLAY_SPEED ?? DEFAULT_REPLAY_SPEED);
  return n > 0 ? n : DEFAULT_REPLAY_SPEED;
}

/** Cached replies of the mapping model, by request. */
export function modelCacheDir(): string {
  return dir("MAPPING_MODEL_CACHE", "../data/model-cache");
}

/** The mapping model's recorded replies, which replay mode serves (mapping/recorded.ts). */
export function replayMapping(): string {
  return dir("REPLAY_MAPPING", "../data/replay/mapping-gemini.json");
}

/** Hours a sandbox lives after its last use. */
export function sandboxTtlHours(): number {
  const n = Number(process.env.SANDBOX_TTL_HOURS ?? "24");
  return n > 0 ? n : 24;
}

/** Documents read at a time per provider, across workspaces: Gemini in parallel, the local GPU one by one. */
export function concurrency(provider: Provider): number {
  const fallback = provider === "gemini" ? 4 : 1;
  const n = Number.parseInt(process.env[`QUEUE_CONCURRENCY_${provider.toUpperCase()}`] ?? "", 10);
  return n > 0 ? n : fallback;
}
