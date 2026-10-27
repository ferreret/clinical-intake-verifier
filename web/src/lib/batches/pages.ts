/**
 * A document's pages as images, for the verification viewer. Rendered on the server with the
 * extractor's own renderer, so the browser needs no PDF library, and kept for the documents
 * opened last.
 */
import { renderPages } from "@/lib/extractor/render";

/** Sharp enough to read small print on a laptop screen, light enough to load at once. */
export const VIEWER_DPI = 130;
const KEPT = 12;

const rendered = new Map<string, Promise<Uint8Array[]>>();

export function documentPages(key: string, pdf: () => Promise<Uint8Array>): Promise<Uint8Array[]> {
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
