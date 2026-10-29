/**
 * Pages rendered to images, for the `page-images` input mode: models that cannot open a PDF
 * (the local vision model) see one PNG per page instead.
 *
 * pdf.js with a native canvas, both installed by npm, so that no system tool is needed.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** The resolution the manual check of 2026-10-26 was made at: an A4 page is 1241 x 1754. */
export const DEFAULT_DPI = 150;

/**
 * Forms generated with the standard PDF fonts do not embed them; pdf.js needs its own copies.
 * Resolved from the working directory, not from this module: once bundled by Next.js, this
 * module has no file URL of its own.
 */
function standardFontsDir(): string {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  return path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
}

/** One PNG per page, in page order, on a white background. */
export async function renderPages(pdf: Uint8Array, dpi = DEFAULT_DPI): Promise<Uint8Array[]> {
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const task = getDocument({
    data: pdf.slice(),
    standardFontDataUrl: standardFontsDir(),
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const images: Uint8Array[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      // Encoded off the main thread: toBuffer's encoding, synchronous, was most of the CPU a
      // page took, with every other request of the server waiting meanwhile.
      images.push(new Uint8Array(await canvas.encode("png")));
      page.cleanup();
    }
    return images;
  } finally {
    await task.destroy();
  }
}
