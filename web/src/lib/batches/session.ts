/**
 * Who is working, and in which workspace, from the request's cookies.
 *
 * The technician is picked, not authenticated (technicians.ts). In replay mode the sandbox
 * cookie names the visitor's workspace; live mode has a single one.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { LisDb } from "@/lib/lis/db";

import { appMode } from "./config";
import { technician, type Technician } from "./technicians";
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

/** The session, or null when no technician was picked or the sandbox has expired. */
export async function getSession(): Promise<Session | null> {
  const [workspace, tech] = await Promise.all([currentWorkspace(), currentTechnician()]);
  if (!workspace || !tech) return null;
  await touchWorkspace(workspace);
  return { workspace, technician: tech, db: await openWorkspace(workspace) };
}

/** Works as `tech` from now on; a visitor without a live sandbox gets a new one. */
export async function startSession(tech: Technician): Promise<Session> {
  const jar = await cookies();
  let workspace = await currentWorkspace();
  if (!workspace) {
    workspace = await createSandbox();
    jar.set(SANDBOX_COOKIE, workspace, { httpOnly: true, sameSite: "lax", path: "/" });
  }
  jar.set(TECHNICIAN_COOKIE, tech.id, { httpOnly: true, sameSite: "lax", path: "/" });
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
  jar.delete(SANDBOX_COOKIE);
  jar.delete(TECHNICIAN_COOKIE);
}

export function noSession(): NextResponse {
  return NextResponse.json({ error: "pick a technician first (POST /api/session)" }, { status: 401 });
}
