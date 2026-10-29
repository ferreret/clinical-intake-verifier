/**
 * Who is working, and in which workspace, from the request's cookies.
 *
 * The technician is picked, not authenticated (technicians.ts). In replay mode the sandbox
 * cookie names the visitor's workspace; live mode has a single one.
 */
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_PATH } from "@/lib/base-path";
import type { LisDb } from "@/lib/lis/db";

import { appMode } from "./config";
import { ACTING_HEADER, technician, type Technician } from "./technicians";
import { createSandbox, deleteSandbox, LIVE_WORKSPACE, openWorkspace, touchWorkspace, workspaceExists } from "./workspace";

const SANDBOX_COOKIE = "civ_sandbox";
const TECHNICIAN_COOKIE = "civ_technician";

export interface Session {
  workspace: string;
  technician: Technician;
  db: LisDb;
}

async function currentWorkspace(): Promise<string | null> {
  if (appMode() === "live") return LIVE_WORKSPACE;
  const id = (await cookies()).get(SANDBOX_COOKIE)?.value;
  return id && (await workspaceExists(id)) ? id : null;
}

/** The technician picked, if any, whether or not their workspace still exists. */
export async function currentTechnician(): Promise<Technician | null> {
  return technician((await cookies()).get(TECHNICIAN_COOKIE)?.value);
}

/** The page acts as a technician who is no longer the one picked: another tab picked someone else. */
async function actingAsAnother(tech: Technician | null): Promise<boolean> {
  const acting = (await headers()).get(ACTING_HEADER);
  return acting !== null && acting !== tech?.id;
}

/**
 * The session, or null when no technician was picked, the sandbox has expired, or the page
 * shows another technician than the one picked.
 */
export async function getSession(): Promise<Session | null> {
  const [workspace, tech] = await Promise.all([currentWorkspace(), currentTechnician()]);
  if (!workspace || !tech || (await actingAsAnother(tech))) return null;
  await touchWorkspace(workspace);
  return { workspace, technician: tech, db: await openWorkspace(workspace) };
}

/**
 * The client's address, for the limit on new sandboxes (pure, for tests):
 * - CLIENT_ADDRESS_HEADER's value, when a deployment names the header its proxy puts it in;
 * - else Cloudflare's CF-Connecting-IP: behind Cloudflare, X-Forwarded-For ends with one of
 *   Cloudflare's own addresses, the same for every visitor, who would all share one limit;
 * - else the last address the proxy added to X-Forwarded-For (anything before it the client
 *   could have written itself), then X-Real-IP, then "direct".
 * A client that writes a CF-Connecting-IP of its own, where no Cloudflare is in front, only
 * escapes the limit: MAX_SANDBOXES still holds, and no visitor is ever counted as another.
 */
export function addressFrom(h: Headers, header = process.env.CLIENT_ADDRESS_HEADER?.trim()): string {
  const first = (name: string) => h.get(name)?.split(",")[0]?.trim();
  if (header) return first(header) || "direct";
  return first("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || h.get("x-real-ip")?.trim() || "direct";
}

export async function clientAddress(): Promise<string> {
  return addressFrom(await headers());
}

/** Works as `tech` from now on; a visitor without a live sandbox gets a new one. */
export async function startSession(tech: Technician): Promise<Session> {
  const jar = await cookies();
  let workspace = await currentWorkspace();
  if (!workspace) {
    workspace = await createSandbox(new Date(), await clientAddress());
    jar.set(SANDBOX_COOKIE, workspace, { httpOnly: true, sameSite: "lax", path: COOKIE_PATH });
  }
  jar.set(TECHNICIAN_COOKIE, tech.id, { httpOnly: true, sameSite: "lax", path: COOKIE_PATH });
  return { workspace, technician: tech, db: await openWorkspace(workspace) };
}

/**
 * Replay mode: the visitor starts from scratch. Their sandbox is deleted and the technician
 * forgotten; picking one again makes a new sandbox from the template.
 */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const workspace = await currentWorkspace();
  if (workspace && workspace !== LIVE_WORKSPACE) await deleteSandbox(workspace);
  jar.delete({ name: SANDBOX_COOKIE, path: COOKIE_PATH });
  jar.delete({ name: TECHNICIAN_COOKIE, path: COOKIE_PATH });
}

export async function noSession(): Promise<NextResponse> {
  const tech = await currentTechnician();
  if (tech && (await actingAsAnother(tech))) {
    return NextResponse.json({ error: `another tab works as ${tech.name} now: reload the page` }, { status: 409 });
  }
  return NextResponse.json({ error: "pick a technician first (POST /api/session)" }, { status: 401 });
}
