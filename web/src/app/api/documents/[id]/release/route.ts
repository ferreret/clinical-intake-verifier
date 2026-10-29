/**
 * POST /api/documents/:id/release: the technician leaves the document unfinished; it waits
 * again. JSON `{ since }`, the lock's time as the page got it, releases only that lock.
 */
import { NextResponse } from "next/server";

import { jsonBody, tooLarge } from "@/lib/http";

import { getSession, noSession } from "@/lib/batches/session";
import { releaseDocument } from "@/lib/batches/store";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const read = await jsonBody(req);
  if ("tooLarge" in read) return tooLarge();
  const since = typeof read.body?.since === "string" ? read.body.since : undefined;
  const released = await releaseDocument(session.db, (await ctx.params).id, session.technician.id, since);
  return NextResponse.json({ released });
}
