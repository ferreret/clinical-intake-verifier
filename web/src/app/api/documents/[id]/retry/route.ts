/** POST /api/documents/:id/retry: a failed document goes back to the queue. */
import { NextResponse } from "next/server";

import { queue } from "@/lib/batches/queue";
import { getSession, noSession } from "@/lib/batches/session";
import { getDocument, retryDocument } from "@/lib/batches/store";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const { id } = await ctx.params;
  if (!(await retryDocument(session.db, id))) {
    const doc = await getDocument(session.db, id);
    if (!doc) return NextResponse.json({ error: "no such document" }, { status: 404 });
    return NextResponse.json({ error: `only a failed document can be retried; this one is ${doc.state}` }, { status: 409 });
  }
  queue().kick(session.workspace);
  return NextResponse.json({ document: await getDocument(session.db, id) });
}
