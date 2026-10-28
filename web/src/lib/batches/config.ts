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

import { LOCK_RENEW_MINUTES } from "./locks";
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
 * Data, not code: the build must not trace what is there. A leading "~" is the home folder,
 * as in a shell: written in .env.local it would otherwise be a folder named "~" inside the
 * repository, where live mode's uploads must never go.
 */
function dir(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  const home = value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), home);
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
 * How much faster than recorded a replayed reply comes: 1 is the measured latency. Twenty
 * times by default, so a demo batch does not take minutes, even read by the local model
 * (product owner, 2026-10-27; doubled twice on 2026-10-28); the measured latency is still
 * what each document shows.
 */
export const DEFAULT_REPLAY_SPEED = 20;

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

/**
 * Sandboxes kept at most: a new visitor beyond it takes the place of the one unused for
 * longest, so that visits (or a robot) cannot fill the disk. About half a megabyte each.
 * Only one unused for SANDBOX_IDLE_MINUTES is taken: when none is, the new visitor is told
 * the demo is full, rather than someone's work being deleted while they use it.
 */
export function maxSandboxes(): number {
  const n = Number.parseInt(process.env.MAX_SANDBOXES ?? "", 10);
  return n > 0 ? n : 500;
}

/**
 * Minutes a document stays locked to a technician without word from their page, which renews
 * the lock every LOCK_RENEW_MINUTES while it is open: a lock outlives its page only when the
 * page could not say goodbye (a browser that hung, a network or power cut), and then counts as
 * free. At least three renewals' worth, so that one renewal lost on the way does not free it.
 */
export function lockMinutes(): number {
  const n = Number(process.env.LOCK_MINUTES ?? "30");
  return n >= 3 * LOCK_RENEW_MINUTES ? n : 30;
}

export function sandboxIdleMinutes(): number {
  const n = Number(process.env.SANDBOX_IDLE_MINUTES ?? "30");
  return n >= 0 ? n : 30;
}

/** Documents read at a time per provider, across workspaces: Gemini in parallel, the local GPU one by one. */
export function concurrency(provider: Provider): number {
  const fallback = provider === "gemini" ? 4 : 1;
  const n = Number.parseInt(process.env[`QUEUE_CONCURRENCY_${provider.toUpperCase()}`] ?? "", 10);
  return n > 0 ? n : fallback;
}
