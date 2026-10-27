/**
 * A plain OCR of the pages, for placing the values a model read (locate.ts).
 *
 * Tesseract compiled to WebAssembly (tesseract.js), with its Spanish data from npm: no system
 * tool, and nothing downloaded at run time. Accents are ignored when matching, so the Spanish
 * data serves Catalan forms as well (measured on 2026-10-27).
 *
 * The workers are started on first use and shared by every call; a script that is done with
 * them calls closeOcr(), or exits.
 */
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createScheduler, createWorker, OEM, type Scheduler } from "tesseract.js";
import { matchKey, type OcrPage } from "./locate";
import { renderPages } from "./render";

/** Higher than the model's 150: Tesseract reads small print better at 300. */
export const OCR_DPI = 300;
const LANGUAGE = "spa";

/** The language data shipped by npm, resolved from the working directory like render.ts's fonts. */
function languageDir(): string {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  return path.join(path.dirname(require.resolve(`@tesseract.js-data/${LANGUAGE}/package.json`)), "4.0.0_best_int");
}

/** OCR_WORKERS, or up to four: one page per worker at a time. */
function workerCount(): number {
  const n = Number.parseInt(process.env.OCR_WORKERS ?? "", 10);
  return n > 0 ? n : Math.min(4, os.availableParallelism());
}

let scheduler: Promise<Scheduler> | null = null;

function getScheduler(): Promise<Scheduler> {
  scheduler ??= (async () => {
    const s = createScheduler();
    const langPath = languageDir();
    const workers = await Promise.all(
      Array.from({ length: workerCount() }, async () => {
        const worker = await createWorker(LANGUAGE, OEM.LSTM_ONLY, { langPath, cacheMethod: "none" });
        // Tesseract's own notices ("Line cannot be recognized!!") would otherwise go to stderr.
        await worker.setParameters({ debug_file: "/dev/null" });
        return worker;
      }),
    );
    for (const worker of workers) s.addWorker(worker);
    return s;
  })();
  return scheduler;
}

export async function closeOcr(): Promise<void> {
  if (scheduler === null) return;
  const s = await scheduler;
  scheduler = null;
  await s.terminate();
}

/** Width and height of a PNG, from its header. */
function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

/** Every page's lines of words, boxes on 0-1 of the page; words of punctuation alone left out. */
export async function ocrPages(pdf: Uint8Array): Promise<OcrPage[]> {
  const [s, images] = await Promise.all([getScheduler(), renderPages(pdf, OCR_DPI)]);
  return Promise.all(
    images.map(async (png) => {
      const [width, height] = pngSize(png);
      const { data } = await s.addJob("recognize", Buffer.from(png), {}, { blocks: true });
      const page: OcrPage = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const words = line.words
              .filter((w) => matchKey(w.text) !== "")
              .map((w) => ({
                text: w.text,
                box: { x0: w.bbox.x0 / width, y0: w.bbox.y0 / height, x1: w.bbox.x1 / width, y1: w.bbox.y1 / height },
              }));
            if (words.length > 0) page.push(words);
          }
        }
      }
      return page;
    }),
  );
}
