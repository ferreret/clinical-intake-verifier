/** POST /api/documents/:id/release: the technician leaves the document unfinished; it waits again. */
import { NextResponse } from "next/server";

import { getSession, noSession } from "@/lib/batches/session";
import { releaseDocument } from "@/lib/batches/store";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const released = await releaseDocument(session.db, (await ctx.params).id, session.technician.id);
  return NextResponse.json({ released });
}
