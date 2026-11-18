/**
 * The deployment's private set: anonymized real requests, offered behind a password
 * (docs/roadmap.md, 2026-11-18; docs/deploy.md, "A private set"). Where it is and what it
 * holds: config.ts (privateSetConfig) and sources.ts (listPrivate, readPrivate).
 *
 * The password is a second layer; the first is that the documents are anonymized. It is
 * compared in constant time, the wrong ones from each client address are limited, and it
 * unlocks the visitor's workspace, not their browser: the workspace's database records who
 * gave it and when, and only a workspace with that record lists, adds or is served the set's
 * documents. A sandbox that starts over is deleted, and the record with it.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import type { LisDb } from "@/lib/lis/db";

import { privateSetConfig, type PrivateSetConfig } from "./config";
import { privateSetUnlocks } from "./schema";

/** Wrong passwords one client address may give in ATTEMPT_WINDOW_MINUTES. */
export const MAX_WRONG_PASSWORDS = 5;
export const ATTEMPT_WINDOW_MINUTES = 15;

/** The client gave MAX_WRONG_PASSWORDS wrong passwords in the last ATTEMPT_WINDOW_MINUTES. */
export class TooManyAttempts extends Error {}

/** Compared in constant time: hashed first, so that neither the length nor any prefix shows in the time taken. */
export function samePassword(given: string, expected: string): boolean {
  const digest = (text: string) => createHash("sha256").update(text, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

const WRONG = Symbol.for("clinical-intake-verifier.private-set-wrong-passwords");
type WithWrong = typeof globalThis & { [WRONG]?: Map<string, number[]> };

/** When each client address gave a wrong password, on the global object like the queue: the routes load their own copies of this module. */
function wrongPasswords(): Map<string, number[]> {
  const g = globalThis as WithWrong;
  return (g[WRONG] ??= new Map());
}

export async function isUnlocked(db: LisDb): Promise<boolean> {
  const [row] = await db.select({ id: privateSetUnlocks.id }).from(privateSetUnlocks).limit(1);
  return row !== undefined;
}

/** The deployment has a private set, and this workspace unlocked it. */
export async function privateSetOpen(db: LisDb): Promise<boolean> {
  return privateSetConfig() !== null && (await isUnlocked(db));
}

/**
 * Unlocks the set for the workspace when `password` is the set's; false when it is not.
 * Throws TooManyAttempts once `client` gave too many wrong ones lately, the right one included,
 * so that guessing goes no faster than MAX_WRONG_PASSWORDS per ATTEMPT_WINDOW_MINUTES.
 */
export async function unlockPrivateSet(
  db: LisDb,
  set: PrivateSetConfig,
  input: { password: string; technician: string; client: string; now?: Date },
): Promise<boolean> {
  const now = (input.now ?? new Date()).getTime();
  const since = now - ATTEMPT_WINDOW_MINUTES * 60 * 1000;
  const wrong = wrongPasswords();
  for (const [client, times] of wrong) {
    const recent = times.filter((t) => t > since);
    if (recent.length > 0) wrong.set(client, recent);
    else wrong.delete(client);
  }
  if ((wrong.get(input.client)?.length ?? 0) >= MAX_WRONG_PASSWORDS) {
    throw new TooManyAttempts("too many wrong passwords from this address: try again later");
  }
  if (!samePassword(input.password, set.password)) {
    wrong.set(input.client, [...(wrong.get(input.client) ?? []), now]);
    return false;
  }
  if (!(await isUnlocked(db))) {
    await db.insert(privateSetUnlocks).values({ technician: input.technician, at: new Date(now).toISOString() });
  }
  return true;
}
