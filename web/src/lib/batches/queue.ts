/**
 * The worker: takes queued documents from every workspace and runs them through the chain
 * (pipeline.ts), a few at a time per provider, inside the server process. The same in both
 * modes; in replay mode the extractor's step is the wait for a recorded reply.
 *
 * The queue itself is the documents' state in each workspace's database, so nothing is lost
 * when the server stops: on start, documents left extracting go back to the queue.
 */
import type { LisDb } from "@/lib/lis/db";

import { appMode, concurrency, type Provider } from "./config";
import { documentPages } from "./pages";
import { proposeFor, readDocument } from "./pipeline";
import { PROVIDERS } from "./schema";
import { readBundled, readUpload } from "./sources";
import { claimNext, completeDocument, failDocument, hasQueued, requeueInterrupted, type BatchDocument } from "./store";
import { listWorkspaces, LIVE_WORKSPACE, openWorkspace, sweepSandboxes, workspaceExists } from "./workspace";

const SWEEP_EVERY_MS = 60 * 60 * 1000;
/** Attempts at marking a document failed, a second apart, then a second more each time. */
const FAIL_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BatchQueue {
  private readonly running: Record<Provider, number> = { gemini: 0, local: 0 };
  /** Workspaces that may have queued documents. */
  private readonly pending = new Set<string>();
  private pumping: Promise<void> | null = null;
  private again = false;
  private readonly settled = new Set<Promise<void>>();

  /** Look for queued documents in this workspace. */
  kick(workspace: string): void {
    this.pending.add(workspace);
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = this.pump().finally(() => {
      this.pumping = null;
      if (this.again) this.kick(workspace);
    });
  }

  /** Resolves when nothing is running or queued: for scripts and tests. */
  async idle(): Promise<void> {
    while (this.pumping || this.settled.size > 0) {
      await Promise.all([this.pumping, ...this.settled]);
    }
  }

  private async pump(): Promise<void> {
    do {
      this.again = false;
      for (const workspace of [...this.pending]) {
        try {
          await this.claim(workspace);
        } catch (err) {
          // One workspace that cannot be read must not hold up the others; it is looked at
          // again the next time something is queued in it.
          console.error(`queue: workspace ${workspace} skipped:`, err);
          this.pending.delete(workspace);
        }
      }
    } while (this.again);
  }

  /** Starts as many of the workspace's queued documents as the providers have room for. */
  private async claim(workspace: string): Promise<void> {
    // A sandbox deleted meanwhile (its visitor started over, or the sweep) is not opened,
    // which would create it again.
    if (workspace !== LIVE_WORKSPACE && !(await workspaceExists(workspace))) {
      this.pending.delete(workspace);
      return;
    }
    const db = await openWorkspace(workspace);
    for (;;) {
      const free = PROVIDERS.filter((p) => this.running[p] < concurrency(p));
      const doc = await claimNext(db, free);
      if (!doc) break;
      this.running[doc.provider] += 1;
      const run = this.process(workspace, doc).finally(() => {
        this.running[doc.provider] -= 1;
        this.settled.delete(run);
        this.kick(workspace);
      });
      this.settled.add(run);
    }
    if (!(await hasQueued(db))) this.pending.delete(workspace);
  }

  private async process(workspace: string, doc: BatchDocument & { provider: Provider }): Promise<void> {
    const db = await openWorkspace(workspace);
    try {
      const pdf = new Uint8Array(doc.origin === "bundled" ? await readBundled(doc.location) : await readUpload(doc.location));
      const { prediction, recorded } = await readDocument(pdf, doc, doc.provider);
      const { fused, tests, trace } = await proposeFor(db, prediction);
      await completeDocument(db, doc.id, { prediction, fused, tests, recorded, trace });
      // Ready for the viewer before anyone opens it; a failure here is the viewer's to show.
      void documentPages(`${workspace}:${doc.id}`, async () => pdf).catch(() => undefined);
    } catch (err) {
      await this.fail(workspace, db, doc.id, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Marks the document failed, so that it can be retried. The cause may be the database
   * itself (busy, full), so it is tried again for a while; if it still cannot be marked, it
   * stays extracting until the server restarts, which queues it again.
   */
  private async fail(workspace: string, db: LisDb, id: string, message: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await failDocument(db, id, message);
        return;
      } catch (err) {
        if (workspace !== LIVE_WORKSPACE && !(await workspaceExists(workspace))) return;
        if (attempt >= FAIL_ATTEMPTS) {
          console.error(`queue: document ${id} of ${workspace} could not be marked failed:`, err);
          return;
        }
        await sleep(1000 * attempt);
      }
    }
  }

  /** On start: what the last run left extracting is queued again, and every workspace looked at. */
  async resume(): Promise<void> {
    const workspaces = await listWorkspaces();
    if (appMode() === "live" && !workspaces.includes(LIVE_WORKSPACE)) workspaces.push(LIVE_WORKSPACE);
    for (const workspace of workspaces) {
      // A workspace that cannot be opened (a damaged file) must not keep the server down.
      try {
        await requeueInterrupted(await openWorkspace(workspace));
        this.kick(workspace);
      } catch (err) {
        console.error(`queue: workspace ${workspace} not resumed:`, err);
      }
    }
  }
}

const KEY = Symbol.for("clinical-intake-verifier.queue");
type WithQueue = typeof globalThis & { [KEY]?: BatchQueue };

/** The server's one queue, shared by every route (and kept across hot reloads). */
export function queue(): BatchQueue {
  const g = globalThis as WithQueue;
  g[KEY] ??= new BatchQueue();
  return g[KEY];
}

/** Called once when the server starts (src/instrumentation.ts). */
export async function startQueue(): Promise<void> {
  if (appMode() === "replay") {
    await sweepSandboxes().catch((err) => console.error("sandbox sweep:", err));
    setInterval(() => void sweepSandboxes().catch((err) => console.error("sandbox sweep:", err)), SWEEP_EVERY_MS).unref();
  }
  await queue().resume();
}
