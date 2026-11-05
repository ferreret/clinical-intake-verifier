/**
 * The OCR of a document as text for a language model, and the positions kept beside it.
 *
 * The text pipeline (provider `local-text`, input mode `ocr-text`) does not show the model the
 * pages: it gives it the lines an OCR read, numbered, and the model answers with the line each
 * value is on. The line's box, which the OCR measured, becomes the value's box
 * (`linesToLayer1` in response-schema.ts), and is then tightened to the value (locate.ts).
 *
 * The document is `schema/ocr.schema.json`: what `intake-ocr run` writes as `<id>.ocr.json`,
 * or what Tesseract read in-process (ocr.ts) when no file is given. Pure: no OCR runs here.
 */
import Ajv2020 from "ajv/dist/2020";
import ocrSchema from "../../../../schema/ocr.schema.json";
import type { BBox } from "@/lib/schema/prediction";
import type { OcrPage, OcrWord } from "./locate";

export const OCR_VERSION = 1 as const;

/** The checkbox in front of a line: ticked, empty, or none detected. */
export type Mark = "checked" | "unchecked" | null;

export interface OcrLine {
  /** `p<page>l<n>`, n counting the page's lines from 1. */
  id: string;
  box: BBox;
  text: string;
  /** Empty when the engine reports lines only. */
  words: OcrWord[];
  mark: Mark;
}

export interface OcrTextPage {
  number: number;
  /** Of the rendered page, in pixels. */
  width: number;
  height: number;
  elapsed_ms?: number;
  lines: OcrLine[];
}

export interface OcrDocument {
  ocr_version: typeof OCR_VERSION;
  engine: string;
  model: string | null;
  dpi: number;
  sha256: string;
  /** The whole document, rendering included; added to the prediction's latency. */
  elapsed_ms?: number;
  checkboxes?: boolean;
  pages: OcrTextPage[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validateFn = ajv.compile(ocrSchema);

/** Validation errors against schema/ocr.schema.json; empty when valid. */
export function validateOcrDocument(doc: unknown): string[] {
  if (validateFn(doc)) return [];
  return (validateFn.errors ?? []).map((e) => `${e.instancePath || "<root>"}: ${e.message ?? "invalid"}`);
}

export function lineId(page: number, n: number): string {
  return `p${page}l${n}`;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function union(boxes: BBox[]): BBox {
  return {
    x0: round(Math.min(...boxes.map((b) => b.x0))),
    y0: round(Math.min(...boxes.map((b) => b.y0))),
    x1: round(Math.max(...boxes.map((b) => b.x1))),
    y1: round(Math.max(...boxes.map((b) => b.y1))),
  };
}

export interface WordLinesMeta {
  engine: string;
  model: string | null;
  dpi: number;
  sha256: string;
  /** Each page's size in pixels, in page order. */
  sizes: [number, number][];
  elapsed_ms?: number;
}

/** A document from lines of words (what ocrPages returns): each line's box is its words'. */
export function fromWordLines(pages: OcrPage[], meta: WordLinesMeta): OcrDocument {
  return {
    ocr_version: OCR_VERSION,
    engine: meta.engine,
    model: meta.model,
    dpi: meta.dpi,
    sha256: meta.sha256,
    ...(meta.elapsed_ms !== undefined && { elapsed_ms: meta.elapsed_ms }),
    checkboxes: false,
    pages: pages.map((lines, i) => ({
      number: i + 1,
      width: meta.sizes[i][0],
      height: meta.sizes[i][1],
      lines: lines
        .filter((words) => words.length > 0)
        .map((words, j) => ({
          id: lineId(i + 1, j + 1),
          box: union(words.map((w) => w.box)),
          text: words.map((w) => w.text).join(" "),
          words,
          mark: null,
        })),
    })),
  };
}

/**
 * The pages as locate.ts reads them: lines of words. A line reported without words is one
 * word, its whole text, so that it can still be matched as a whole.
 */
export function wordPages(pages: readonly OcrTextPage[]): OcrPage[] {
  return pages.map((p) => p.lines.map((l) => (l.words.length > 0 ? l.words : [{ text: l.text, box: l.box }])));
}

const MARK_TOKEN: Record<NonNullable<Mark>, string> = { checked: "[X] ", unchecked: "[ ] " };

/**
 * The text the model reads: one line per OCR line, in reading order, with its page and its
 * number on that page, as `[p2] L17: Hemograma completo`. A checkbox in front of a line is
 * written as a token at its start, `[X] ` when ticked and `[ ] ` when empty. A page where the
 * OCR read nothing says so, so that the page numbers still add up.
 */
export function renderOcrText(pages: readonly OcrTextPage[]): string {
  const out: string[] = [];
  for (const page of pages) {
    if (page.lines.length === 0) {
      out.push(`[p${page.number}] (no text)`);
      continue;
    }
    page.lines.forEach((line, i) => {
      const mark = line.mark ? MARK_TOKEN[line.mark] : "";
      out.push(`[p${page.number}] L${i + 1}: ${mark}${line.text.replace(/\s+/g, " ").trim()}`);
    });
  }
  return out.join("\n");
}

/** The line `n` of page `page` as renderOcrText numbered it, or null. */
export function findLine(pages: readonly OcrTextPage[], page: number, n: number): OcrLine | null {
  return pages.find((p) => p.number === page)?.lines[n - 1] ?? null;
}
