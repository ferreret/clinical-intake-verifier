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

import { openLis, type LisDb } from "@/lib/lis/db";

import { dataDir, maxSandboxes, sandboxTtlHours, templateDb } from "./config";

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

/** The workspace's database, created from the template the first time. */
export function openWorkspace(id: string): Promise<LisDb> {
  const opened = openedDbs();
  let db = opened.get(id);
  if (!db) {
    db = (async () => {
      const file = fileOf(id);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.copyFile(templateDb(), file, fs.constants.COPYFILE_EXCL).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "EEXIST") throw err;
      });
      return openLis(`file:${file}`);
    })();
    db.catch(() => opened.delete(id));
    opened.set(id, db);
  }
  return db;
}

export async function workspaceExists(id: string): Promise<boolean> {
  return isWorkspaceId(id) && (await fs.stat(fileOf(id)).catch(() => null)) !== null;
}

/** A new sandbox, ready to use; beyond MAX_SANDBOXES, the ones unused for longest make room. */
export async function createSandbox(): Promise<string> {
  const sandboxes = await Promise.all(
    (await listWorkspaces())
      .filter((w) => w !== LIVE_WORKSPACE)
      .map(async (w) => ({ id: w, used: (await fs.stat(fileOf(w)).catch(() => null))?.mtimeMs ?? 0 })),
  );
  sandboxes.sort((a, b) => a.used - b.used);
  for (const old of sandboxes.slice(0, Math.max(0, sandboxes.length - maxSandboxes() + 1))) await deleteSandbox(old.id);
  const id = randomUUID();
  await openWorkspace(id);
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
