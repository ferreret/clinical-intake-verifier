/**
 * GET /api/bundled?provider=gemini|local: the synthetic documents a batch can be made of, with
 * what their goldens say about them (pages, scanned, handwriting, language). In replay mode,
 * only those the provider has a recorded reply for.
 */
import { NextResponse } from "next/server";

import { appMode } from "@/lib/batches/config";
import { PROVIDERS } from "@/lib/batches/schema";
import { getSession, noSession } from "@/lib/batches/session";
import { describeBundled, listBundled } from "@/lib/batches/sources";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  if (!(await getSession())) return noSession();
  const provider = new URL(req.url).searchParams.get("provider") ?? "gemini";
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json({ error: `provider must be one of ${PROVIDERS.join(", ")}` }, { status: 400 });
  }
  const names = await listBundled(appMode() === "replay" ? (provider as (typeof PROVIDERS)[number]) : null);
  const documents = await describeBundled(names);
  return NextResponse.json({ provider, documents });
}
