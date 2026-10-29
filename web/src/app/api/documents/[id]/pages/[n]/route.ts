/** GET /api/documents/:id/pages/:n: page n of the document as a PNG, for the viewer. */
import { documentPages } from "@/lib/batches/pages";
import { getSession, noSession } from "@/lib/batches/session";
import { readBundled, readUpload } from "@/lib/batches/sources";
import { getDocument } from "@/lib/batches/store";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session) return noSession();
  const { id, n } = await ctx.params;
  const doc = await getDocument(session.db, id);
  if (!doc) return Response.json({ error: "no such document" }, { status: 404 });
  let pages: Uint8Array[];
  try {
    pages = await documentPages(`${session.workspace}:${doc.id}`, async () =>
      new Uint8Array(doc.origin === "bundled" ? await readBundled(doc.location) : await readUpload(doc.location)),
    );
  } catch (err) {
    // A document pdf.js cannot draw: said, rather than an empty 500.
    console.error(`pages: document ${doc.id} of ${session.workspace} could not be rendered:`, err instanceof Error ? err.message : err);
    return Response.json({ error: "the document's pages could not be shown" }, { status: 422 });
  }
  const page = /^\d+$/.test(n) ? pages[Number(n) - 1] : undefined;
  if (!page) return Response.json({ error: `the document has ${pages.length} page(s)` }, { status: 404 });
  return new Response(new Uint8Array(page), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400, immutable" },
  });
}
