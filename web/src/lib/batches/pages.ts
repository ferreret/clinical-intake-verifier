/**
 * A document's pages as images, for the verification viewer. Rendered on the server with the
 * extractor's own renderer, so the browser needs no PDF library, and kept for the documents
 * read or opened last: the queue renders them as soon as a document is read, so that opening
 * it, or moving to it from the one before, does not wait for the rendering.
 */
import { renderPages } from "@/lib/extractor/render";

/** Sharp enough to read small print on a laptop screen, light enough to load at once. */
export const VIEWER_DPI = 130;
/** Documents kept: about 1 MB each (some 400 KB a page), so a few batches at once. */
const KEPT = 60;

const KEY = Symbol.for("clinical-intake-verifier.pages");
type WithPages = typeof globalThis & { [KEY]?: Map<string, Promise<Uint8Array[]>> };

export function documentPages(key: string, pdf: () => Promise<Uint8Array>): Promise<Uint8Array[]> {
  // On the global object, like the queue: the queue, started with the server, and the routes
  // load their own copies of this module, and would otherwise keep a cache each.
  const g = globalThis as WithPages;
  const rendered = (g[KEY] ??= new Map());
  let pages = rendered.get(key);
  if (pages) {
    rendered.delete(key);
  } else {
    pages = pdf().then((bytes) => renderPages(bytes, VIEWER_DPI));
    pages.catch(() => rendered.delete(key));
  }
  rendered.set(key, pages);
  while (rendered.size > KEPT) rendered.delete(rendered.keys().next().value!);
  return pages;
}
