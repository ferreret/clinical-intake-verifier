/** GET /api/documents/:id/pdf: the document's PDF, for the viewer. */
import { getSession, noSession } from "@/lib/batches/session";
import { readBundled, readUpload } from "@/lib/batches/sources";
import { getDocument } from "@/lib/batches/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session) return noSession();
  const doc = await getDocument(session.db, (await ctx.params).id);
  if (!doc) return Response.json({ error: "no such document" }, { status: 404 });
  const pdf = doc.origin === "bundled" ? await readBundled(doc.location) : await readUpload(doc.location);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=3600" },
  });
}
