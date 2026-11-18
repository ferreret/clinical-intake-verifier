/**
 * GET /api/bundled?provider=gemini|local: the synthetic documents a batch can be made of, with
 * what their goldens say about them (pages, scanned, handwriting, language). In replay mode,
 * only those the provider has a recorded reply for.
 *
 * On a deployment with a private set, also `privateSet: { unlocked }` and, once the visitor's
 * workspace unlocked it (POST /api/private-set), the set's documents in `private`, chosen by
 * the same rule. Without a set, neither key is there.
 */
import { NextResponse } from "next/server";

import { appMode, privateSetConfig } from "@/lib/batches/config";
import { isUnlocked } from "@/lib/batches/private-set";
import { PROVIDERS } from "@/lib/batches/schema";
import { getSession, noSession } from "@/lib/batches/session";
import { describeBundled, describePrivate, listBundled, listPrivate } from "@/lib/batches/sources";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const provider = new URL(req.url).searchParams.get("provider") ?? "gemini";
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json({ error: `provider must be one of ${PROVIDERS.join(", ")}` }, { status: 400 });
  }
  const recordedBy = appMode() === "replay" ? (provider as (typeof PROVIDERS)[number]) : null;
  const documents = await describeBundled(await listBundled(recordedBy));
  if (!privateSetConfig()) return NextResponse.json({ provider, documents });
  const unlocked = await isUnlocked(session.db);
  return NextResponse.json({
    provider,
    documents,
    privateSet: { unlocked },
    ...(unlocked ? { private: await describePrivate(await listPrivate(recordedBy)) } : {}),
  });
}
