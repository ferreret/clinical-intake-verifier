/**
 * POST /api/documents/:id/reject: the technician rejects the document, saying why. JSON
 * `{ "reason": "illegible" | "not_a_request" | "duplicate" | "other", "note": "…" }`; a note
 * is required with "other". Returns the decision and the batch's next document to verify.
 */
import { NextResponse } from "next/server";

import { REJECT_REASONS, rejectDocument, type RejectReason } from "@/lib/batches/decide";
import { getSession, noSession } from "@/lib/batches/session";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown; note?: unknown };
  const reason = body.reason as RejectReason;
  const note = typeof body.note === "string" ? body.note : "";
  if (!REJECT_REASONS.includes(reason)) return NextResponse.json({ error: `reason must be one of ${REJECT_REASONS.join(", ")}` }, { status: 400 });
  if (reason === "other" && !note.trim()) return NextResponse.json({ error: "say why in a note" }, { status: 400 });
  const result = await rejectDocument(session.db, (await ctx.params).id, session.technician.id, reason, note);
  if (result.ok) return NextResponse.json({ decision: result.decision, next: result.next });
  if (result.reason === "missing") return NextResponse.json({ error: "no such document" }, { status: 404 });
  return NextResponse.json({ error: "the document is not in verification by you" }, { status: 409 });
}
