/**
 * POST /api/documents/:id/open: the technician starts verifying the document, which is locked
 * to them. JSON `{ "takeOver": true }` takes one another technician left open.
 */
import { NextResponse } from "next/server";

import { getSession, noSession } from "@/lib/batches/session";
import { openDocument } from "@/lib/batches/store";
import { technician } from "@/lib/batches/technicians";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const body = (await req.json().catch(() => ({}))) as { takeOver?: unknown };
  const result = await openDocument(session.db, (await ctx.params).id, session.technician.id, body.takeOver === true);
  if (result.ok) return NextResponse.json({ document: result.document });
  if (result.reason === "missing") return NextResponse.json({ error: "no such document" }, { status: 404 });
  if (result.reason === "locked") {
    const holder = technician(result.document?.lockedBy)?.name ?? result.document?.lockedBy;
    return NextResponse.json({ error: `${holder} is verifying this document`, lockedBy: result.document?.lockedBy }, { status: 409 });
  }
  return NextResponse.json({ error: `the document is ${result.document?.state}, not awaiting verification` }, { status: 409 });
}
