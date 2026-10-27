/** GET /api/batches/:id: the batch and its documents, in order, with their states. */
import { NextResponse } from "next/server";

import { getSession, noSession } from "@/lib/batches/session";
import { getBatch } from "@/lib/batches/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const found = await getBatch(session.db, (await ctx.params).id);
  if (!found) return NextResponse.json({ error: "no such batch" }, { status: 404 });
  return NextResponse.json(found);
}
