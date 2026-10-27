/**
 * GET /api/session: the mode (with how much faster than recorded replies come, in replay
 * mode), the technicians to pick from, and who is working now (null before one is picked, or
 * once the sandbox has expired).
 * POST /api/session: JSON `{ "technician": "T01" }`; starts working as that technician, in a
 * new sandbox if the visitor has none.
 * DELETE /api/session: replay mode only; the visitor starts from scratch, their sandbox
 * deleted with all its batches.
 */
import { NextResponse } from "next/server";

import { appMode, replaySpeed } from "@/lib/batches/config";
import { endSession, getSession, startSession } from "@/lib/batches/session";
import { technician, TECHNICIANS } from "@/lib/batches/technicians";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  return NextResponse.json({ ...modeInfo(), technicians: TECHNICIANS, technician: session?.technician ?? null });
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { technician?: unknown } | null;
  const tech = typeof body?.technician === "string" ? technician(body.technician) : null;
  if (!tech) {
    return NextResponse.json({ error: `technician must be one of ${TECHNICIANS.map((t) => t.id).join(", ")}` }, { status: 400 });
  }
  const session = await startSession(tech);
  return NextResponse.json({ ...modeInfo(), technicians: TECHNICIANS, technician: session.technician });
}

export async function DELETE(): Promise<NextResponse> {
  if (appMode() !== "replay") return NextResponse.json({ error: "only a sandbox can be started over" }, { status: 400 });
  await endSession();
  return NextResponse.json({ ...modeInfo(), technicians: TECHNICIANS, technician: null });
}

function modeInfo() {
  const mode = appMode();
  return { mode, replaySpeed: mode === "replay" ? replaySpeed() : null };
}
