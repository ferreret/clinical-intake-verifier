/** GET /api/documents/:id/pdf: the document's PDF, for the viewer. */
import { privateSetOpen } from "@/lib/batches/private-set";
import { getSession, noSession } from "@/lib/batches/session";
import { readSource } from "@/lib/batches/sources";
import { getDocument } from "@/lib/batches/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session) return noSession();
  const doc = await getDocument(session.db, (await ctx.params).id);
  // A private document only to a workspace that unlocked the set, and while the deployment has it.
  if (!doc || (doc.origin === "private" && !(await privateSetOpen(session.db)))) {
    return Response.json({ error: "no such document" }, { status: 404 });
  }
  const pdf = await readSource(doc);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=3600" },
  });
}
