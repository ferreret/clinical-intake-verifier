/**
 * POST /api/documents/:id/approve: the technician approves the document as they leave it.
 * JSON `{ fields, lines, added, confirmed, links? }` (lib/batches/decide.ts). 422 with the problems
 * when it cannot be approved as it is; 409 when it is not the technician's to approve.
 * Returns the decision and the batch's next document to verify.
 */
import { NextResponse } from "next/server";

import { approveDocument, type ApprovalInput } from "@/lib/batches/decide";
import { getSession, noSession } from "@/lib/batches/session";
import { parseChosenLinks } from "@/lib/fusion/link";

export const runtime = "nodejs";

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((c) => typeof c === "string");

/** The body as an approval, or null when it is not shaped like one. */
function parse(body: unknown): ApprovalInput | null {
  const b = body as Partial<Record<keyof ApprovalInput, unknown>>;
  const links = parseChosenLinks(b?.links);
  if (!links) return null;
  if (!b || typeof b.fields !== "object" || b.fields === null || !Array.isArray(b.lines) || !Array.isArray(b.added) || !strings(b.confirmed)) {
    return null;
  }
  const fields = Object.entries(b.fields as Record<string, unknown>);
  if (!fields.every(([, v]) => v === null || typeof v === "string")) return null;
  if (!b.lines.every((l) => l === null || strings(l))) return null;
  const added = b.added as { text?: unknown; codes?: unknown }[];
  if (!added.every((a) => typeof a?.text === "string" && strings(a.codes))) return null;
  return {
    fields: Object.fromEntries(fields) as Record<string, string | null>,
    lines: b.lines as (string[] | null)[],
    added: added.map((a) => ({ text: a.text as string, codes: a.codes as string[] })),
    confirmed: b.confirmed,
    links,
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const input = parse(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "expected { fields, lines, added, confirmed }" }, { status: 400 });
  const result = await approveDocument(session.db, (await ctx.params).id, session.technician.id, input);
  if (result.ok) return NextResponse.json({ decision: result.decision, next: result.next });
  if (result.reason === "missing") return NextResponse.json({ error: "no such document" }, { status: 404 });
  if (result.reason === "invalid") return NextResponse.json({ error: "not ready to approve", problems: result.problems }, { status: 422 });
  return NextResponse.json({ error: "the document is not in verification by you" }, { status: 409 });
}
