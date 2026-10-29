/**
 * Workspaces: one database each, a copy of the template (the mock LIS, the catalog and the
 * mapping memory) with the workflow's tables added by migration.
 *
 * Live mode has a single workspace. Replay mode, the public demo, gives each visitor a
 * sandbox of their own (decision of 2026-10-27): their batches, approvals, the requests they
 * register in the LIS and what the memory learns from them stay theirs, and the sandbox is
 * deleted some hours after its last use.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";

import { openLis, type LisDb } from "@/lib/lis/db";

import { dataDir, maxSandboxes, newSandboxesPerHour, sandboxIdleMinutes, sandboxTtlHours, templateDb } from "./config";

export const LIVE_WORKSPACE = "live";
const SANDBOX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Only these names ever reach the file system. */
export function isWorkspaceId(id: string): boolean {
  return id === LIVE_WORKSPACE || SANDBOX_ID.test(id);
}

function workspacesDir(): string {
  return path.join(dataDir(), "workspaces");
}

function fileOf(id: string): string {
  if (!isWorkspaceId(id)) throw new Error(`not a workspace id: ${id}`);
  return path.join(workspacesDir(), `${id}.sqlite`);
}

const KEY = Symbol.for("clinical-intake-verifier.workspaces");
type WithWorkspaces = typeof globalThis & { [KEY]?: Map<string, Promise<LisDb>> };

/**
 * The open databases, on the global object like the queue: the queue, started with the
 * server, and the routes load their own copies of this module, and would otherwise each
 * keep a client to the same file, of which deleting a sandbox closed only one.
 */
function openedDbs(): Map<string, Promise<LisDb>> {
  const g = globalThis as WithWorkspaces;
  return (g[KEY] ??= new Map());
}

const DELETED = Symbol.for("clinical-intake-verifier.deleted-workspaces");
type WithDeleted = typeof globalThis & { [DELETED]?: Set<string> };

/**
 * Sandboxes deleted since the server started, never opened again: a request that found the
 * file just before it was removed would otherwise open it once more, and the driver create it
 * again, empty. Their ids are random and never reused, so the set only grows by the sandboxes
 * deleted, a few dozen bytes each.
 */
function deletedIds(): Set<string> {
  const g = globalThis as WithDeleted;
  return (g[DELETED] ??= new Set());
}

/** The workspace's file is gone: the sandbox was deleted (its visitor started over, or the sweep). */
export class WorkspaceGone extends Error {}

/**
 * A copy of the template at `file`, unless there is one already. Copied beside it and then
 * renamed, so that a copy cut short (a full disk, a crash) never leaves a broken workspace.
 */
async function copyTemplate(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (await fs.stat(file).catch(() => null)) return;
  const partial = `${file}.partial-${randomUUID()}`;
  try {
    await fs.copyFile(templateDb(), partial);
    await fs.rename(partial, file);
  } finally {
    await fs.rm(partial, { force: true });
  }
}

/**
 * The workspace's database. The live workspace is created from the template the first time; a
 * sandbox only by createSandbox, and one deleted meanwhile is not created again (WorkspaceGone):
 * requests still in flight when its visitor started over brought it back, empty, with no
 * cookie pointing to it, counted against MAX_SANDBOXES for a day.
 */
export function openWorkspace(id: string): Promise<LisDb> {
  const opened = openedDbs();
  let db = opened.get(id);
  if (!db) {
    db = (async () => {
      const file = fileOf(id);
      if (id === LIVE_WORKSPACE) await copyTemplate(file);
      else if (deletedIds().has(id) || !(await fs.stat(file).catch(() => null))) throw new WorkspaceGone(`workspace ${id} is gone`);
      const lis = await openLis(`file:${file}`);
      // Readers and the writer no longer wait for each other, also across processes: someone
      // reading the file no longer holds up the server's writes. The template stays as it is,
      // so that copying it never leaves behind what a -wal file still holds.
      await lis.run(sql`PRAGMA journal_mode = WAL`);
      return lis;
    })();
    db.catch(() => opened.delete(id));
    opened.set(id, db);
  }
  return db;
}

export async function workspaceExists(id: string): Promise<boolean> {
  return isWorkspaceId(id) && (await fs.stat(fileOf(id)).catch(() => null)) !== null;
}

/** There is no room for another sandbox: every one was used in the last minutes. */
export class SandboxesFull extends Error {}

/** The client made NEW_SANDBOXES_PER_HOUR sandboxes in the last hour. */
export class TooManySandboxes extends Error {}

const MAKING = Symbol.for("clinical-intake-verifier.making-sandboxes");
type WithMaking = typeof globalThis & { [MAKING]?: { last: Promise<unknown>; byClient: Map<string, number[]> } };

/**
 * A new sandbox, ready to use; beyond MAX_SANDBOXES, the ones unused for longest make room,
 * if they have been idle for SANDBOX_IDLE_MINUTES. Throws SandboxesFull when too few have, and
 * TooManySandboxes when `client` (its address) made too many in the last hour.
 *
 * One at a time: made together, each counted the others' room as free and the cap was passed.
 */
export function createSandbox(now: Date = new Date(), client?: string): Promise<string> {
  const making = ((globalThis as WithMaking)[MAKING] ??= { last: Promise.resolve(), byClient: new Map() });
  const made = making.last.catch(() => undefined).then(() => makeSandbox(now, client, making.byClient));
  making.last = made;
  return made;
}

async function makeSandbox(now: Date, client: string | undefined, byClient: Map<string, number[]>): Promise<string> {
  const hourAgo = now.getTime() - 3600 * 1000;
  for (const [c, times] of byClient) {
    const recent = times.filter((t) => t > hourAgo);
    if (recent.length > 0) byClient.set(c, recent);
    else byClient.delete(c);
  }
  if (client !== undefined && (byClient.get(client)?.length ?? 0) >= newSandboxesPerHour()) {
    throw new TooManySandboxes("too many new sandboxes from this address: try again later");
  }
  const sandboxes = await Promise.all(
    (await listWorkspaces())
      .filter((w) => w !== LIVE_WORKSPACE)
      .map(async (w) => ({ id: w, used: (await fs.stat(fileOf(w)).catch(() => null))?.mtimeMs ?? 0 })),
  );
  sandboxes.sort((a, b) => a.used - b.used);
  const excess = sandboxes.slice(0, Math.max(0, sandboxes.length - maxSandboxes() + 1));
  const idleSince = now.getTime() - sandboxIdleMinutes() * 60 * 1000;
  if (excess.some((s) => s.used > idleSince)) throw new SandboxesFull("every sandbox is in use: try again later");
  for (const old of excess) await deleteSandbox(old.id);
  const id = randomUUID();
  await copyTemplate(fileOf(id));
  await openWorkspace(id);
  if (client !== undefined) byClient.set(client, [...(byClient.get(client) ?? []), now.getTime()]);
  return id;
}

/** Marks a workspace as used now, which keeps a sandbox alive. */
export async function touchWorkspace(id: string): Promise<void> {
  const now = new Date();
  await fs.utimes(fileOf(id), now, now).catch(() => undefined);
}

export async function listWorkspaces(): Promise<string[]> {
  const names = await fs.readdir(workspacesDir()).catch(() => [] as string[]);
  return names
    .filter((n) => n.endsWith(".sqlite"))
    .map((n) => n.slice(0, -".sqlite".length))
    .filter(isWorkspaceId);
}

/** Deletes a sandbox and everything in it: the visitor starting from scratch, or the sweep. */
export async function deleteSandbox(id: string): Promise<void> {
  if (id === LIVE_WORKSPACE) throw new Error("the live workspace is not a sandbox");
  deletedIds().add(id);
  const opened = openedDbs();
  const db = opened.get(id);
  opened.delete(id);
  if (db) (await db.catch(() => null))?.$client.close();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) await fs.rm(fileOf(id) + suffix, { force: true });
}

/** Deletes the sandboxes unused for longer than SANDBOX_TTL_HOURS; returns their ids. */
export async function sweepSandboxes(now: Date = new Date()): Promise<string[]> {
  const limit = now.getTime() - sandboxTtlHours() * 3600 * 1000;
  const deleted: string[] = [];
  for (const id of await listWorkspaces()) {
    if (id === LIVE_WORKSPACE) continue;
    const stat = await fs.stat(fileOf(id)).catch(() => null);
    if (!stat || stat.mtimeMs >= limit) continue;
    await deleteSandbox(id);
    deleted.push(id);
  }
  return deleted;
}
