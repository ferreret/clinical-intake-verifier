/**
 * A document's pages as images, for the verification viewer. Rendered on the server with the
 * extractor's own renderer, so the browser needs no PDF library, and kept for the documents
 * read or opened last. The queue renders the first documents of a batch as soon as they are
 * read, so that opening a batch does not wait; the viewer fetches the documents either side
 * of the one open, so that moving to them does not either.
 */
import { renderPages } from "@/lib/extractor/render";

/** Sharp enough to read small print on a laptop screen, light enough to load at once. */
export const VIEWER_DPI = 130;
/** Documents kept: about 1 MB each (some 400 KB a page), so a few batches at once. */
const KEPT = 60;
/**
 * Documents rendered at once. pdf.js draws on the main thread, so many page requests at once
 * (several visitors opening batches) would otherwise take it from every other request.
 */
const RENDERING_AT_ONCE = 2;

/** The queue renders this many documents of each batch, the first ones, as soon as they are read. */
export const RENDERED_AHEAD = 2;

const TURNS = Symbol.for("clinical-intake-verifier.rendering");
type WithTurns = typeof globalThis & { [TURNS]?: { running: number; waiting: (() => void)[] } };

/** Runs `render` when fewer than RENDERING_AT_ONCE are running, in every copy of this module. */
async function inTurn<T>(render: () => Promise<T>): Promise<T> {
  const turns = ((globalThis as WithTurns)[TURNS] ??= { running: 0, waiting: [] });
  if (turns.running >= RENDERING_AT_ONCE) await new Promise<void>((resolve) => turns.waiting.push(resolve));
  else turns.running += 1;
  try {
    return await render();
  } finally {
    // The turn goes to the next one waiting, if any.
    const next = turns.waiting.shift();
    if (next) next();
    else turns.running -= 1;
  }
}

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
    pages = pdf().then((bytes) => inTurn(() => renderPages(bytes, VIEWER_DPI)));
    pages.catch(() => rendered.delete(key));
  }
  rendered.set(key, pages);
  while (rendered.size > KEPT) rendered.delete(rendered.keys().next().value!);
  return pages;
}
