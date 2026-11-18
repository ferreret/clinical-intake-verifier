/**
 * POST /api/private-set `{ "password": "…" }`: unlocks the deployment's private set for the
 * visitor's workspace (lib/batches/private-set.ts); its documents then come with the bundled
 * ones (GET /api/bundled). 404 when the deployment has no set, 403 for a wrong password, 429
 * after too many wrong ones from the client's address.
 */
import { NextResponse } from "next/server";

import { privateSetConfig } from "@/lib/batches/config";
import { TooManyAttempts, unlockPrivateSet } from "@/lib/batches/private-set";
import { clientAddress, getSession, noSession } from "@/lib/batches/session";

export const runtime = "nodejs";

const MAX_BODY = 4096;

export async function POST(req: Request): Promise<NextResponse> {
  const set = privateSetConfig();
  if (!set) return NextResponse.json({ error: "not found" }, { status: 404 });
  const session = await getSession();
  if (!session) return noSession();
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!(length <= MAX_BODY)) return NextResponse.json({ error: `send at most ${MAX_BODY} bytes, with their length` }, { status: 413 });
  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  if (typeof body?.password !== "string" || body.password === "") return NextResponse.json({ error: "send the password" }, { status: 400 });
  let unlocked: boolean;
  try {
    unlocked = await unlockPrivateSet(session.db, set, {
      password: body.password,
      technician: session.technician.id,
      client: await clientAddress(),
    });
  } catch (err) {
    if (!(err instanceof TooManyAttempts)) throw err;
    return NextResponse.json({ error: err.message }, { status: 429 });
  }
  if (!unlocked) return NextResponse.json({ error: "wrong password" }, { status: 403 });
  return NextResponse.json({ unlocked: true });
}
