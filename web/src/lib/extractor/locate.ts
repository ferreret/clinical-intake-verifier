/**
 * Boxes from the page's OCR: the model reads the values, the OCR says where they are printed.
 *
 * The local model reads values about as well as Gemini but places its boxes loosely (26% at
 * IoU 0.5 over 200 documents, 2026-10-26). Each value it read is looked for among the words a
 * plain OCR found on its page: runs of consecutive words on a line, compared on letters and
 * digits only, near the model's own box. The best run gives the box; with no run close enough,
 * the model's box stays. Values are never touched.
 *
 * Pure: the OCR itself is in ocr.ts.
 */
import { fieldSpec } from "@/lib/schema/fields";
import type { BBox, PredictedField } from "@/lib/schema/prediction";
import { stripTitle, type NormalisedExtraction } from "./normalize";

export interface OcrWord {
  text: string;
  /** On 0-1 of the page, origin top-left, like the prediction's boxes. */
  box: BBox;
}

/** One page as the OCR read it: its lines, each a list of words in reading order. */
export type OcrPage = OcrWord[][];

/** Below this similarity a run of words is not the value. */
const MIN_SIMILARITY = 0.7;
/** Similarity given up per unit of distance (in page widths) from the model's box centre. */
const DISTANCE_WEIGHT = 2;
/**
 * Values this short ("TSH", "37", "M") occur all over a form: they must match exactly and lie
 * this close to the model's box.
 */
const SHORT_LENGTH = 3;
const SHORT_RADIUS = 0.15;

/** Letters and digits only, without accents or case: how OCR text and values are compared. */
export function matchKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** 1 for equal keys, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - editDistance(a, b) / longest;
}

/**
 * The keys a value may be printed as. Normalised fields are rewritten by the model, so they
 * are also looked for as forms print them: a date as 1985-05-09 or 01-maig-1971, a sex as
 * "Mujer" or "Home", with the words of `printed` in fields.json.
 */
export function printedKeys(field: string, value: string): string[] {
  const keys = new Set([matchKey(value)]);
  if (field === "tests") return [...keys];
  const spec = fieldSpec(field);
  const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (spec.normalize === "dd/mm/yyyy" && date) {
    const [, dd, mm, yyyy] = date;
    const d = String(Number(dd));
    keys.add(`${yyyy}${mm}${dd}`).add(`${d}${Number(mm)}${yyyy}`).add(`${dd}${mm}${yyyy.slice(2)}`);
    for (const name of spec.printed?.month_names?.[Number(mm) - 1] ?? []) {
      keys.add(matchKey(`${dd}${name}${yyyy}`)).add(matchKey(`${d}${name}${yyyy}`));
    }
  }
  for (const word of spec.printed?.values?.[value] ?? []) keys.add(matchKey(word));
  keys.delete("");
  return [...keys];
}

/** A ticked box in front of an option, "[X] Mujer": part of what is printed, not of the value. */
const TICK = /^\[?\s*[xX✓✔]\s*\]?\s+(?=\S)/;

/**
 * What of a run of words is compared with the value. A title in front of a name the model
 * stripped (`no-title`) and a tick in front of an option are left out of the comparison but
 * kept in the box, which covers the text as printed.
 */
function comparedText(field: string, text: string): string {
  if (field === "tests") return text;
  const spec = fieldSpec(field);
  if (spec.normalize === "no-title") return stripTitle(text);
  if (spec.type === "enum") return text.replace(TICK, "");
  return text;
}

function union(boxes: BBox[]): BBox {
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return {
    x0: round(Math.min(...boxes.map((b) => b.x0))),
    y0: round(Math.min(...boxes.map((b) => b.y0))),
    x1: round(Math.max(...boxes.map((b) => b.x1))),
    y1: round(Math.max(...boxes.map((b) => b.y1))),
  };
}

function centreDistance(a: BBox, b: BBox): number {
  return Math.hypot((a.x0 + a.x1 - b.x0 - b.x1) / 2, (a.y0 + a.y1 - b.y0 - b.y1) / 2);
}

export interface Located {
  box: BBox;
  score: number;
}

/**
 * The run of words on `page` that best matches `value`, or null. `near` is the model's box:
 * the farther from it, the lower the score, and short values must lie close to it. Without
 * it, distance does not count and short values are not looked for.
 */
export function locateOnPage(field: string, value: string, page: OcrPage, near: BBox | null): Located | null {
  const keys = printedKeys(field, value);
  if (keys.length === 0) return null;
  const longest = Math.max(...keys.map((k) => k.length));
  const maxWords = value.trim().split(/\s+/).length + 2;
  let best: (Located & { words: number }) | null = null;
  for (const line of page) {
    for (let i = 0; i < line.length; i += 1) {
      for (let j = i; j < Math.min(line.length, i + maxWords); j += 1) {
        const words = line.slice(i, j + 1);
        // A run starts and ends on a word: a lone "|" or "—" next to it is not part of the value.
        if (matchKey(words[0].text) === "" || matchKey(words[words.length - 1].text) === "") continue;
        const candidate = matchKey(comparedText(field, words.map((w) => w.text).join(" ")));
        if (candidate.length > 2 * longest + 4) break;
        if (candidate === "") continue;
        const box = union(words.map((w) => w.box));
        const distance = near ? centreDistance(box, near) : 0;
        let s = 0;
        for (const key of keys) {
          const short = key.length <= SHORT_LENGTH;
          if (short && (candidate !== key || near === null || distance > SHORT_RADIUS)) continue;
          s = Math.max(s, similarity(key, candidate));
        }
        if (s < MIN_SIMILARITY) continue;
        const score = s - DISTANCE_WEIGHT * distance;
        // On a tie, the longer run: it is the one that includes a title or a tick.
        if (!best || score > best.score + 1e-9 || (score > best.score - 1e-9 && words.length > best.words)) {
          best = { box, score, words: words.length };
        }
      }
    }
  }
  return best && { box: best.box, score: best.score };
}

export interface RelocateResult {
  /** Values with a box from the OCR. */
  located: number;
  /** Values looked for. */
  asked: number;
}

/**
 * Replaces, in place, the box of every value the OCR finds: on the model's page near its box
 * first, then on any other page. A box found there takes that page; a value not found keeps
 * the model's box and page. Every box ends with its `box_source`.
 */
export function relocateBoxes(extraction: Pick<NormalisedExtraction, "fields" | "tests">, pages: OcrPage[]): RelocateResult {
  const items: [string, PredictedField][] = [
    ...Object.entries(extraction.fields).filter((e): e is [string, PredictedField] => e[1] !== null),
    ...extraction.tests.map((t): [string, PredictedField] => ["tests", t]),
  ];
  const result: RelocateResult = { located: 0, asked: 0 };
  for (const [field, item] of items) {
    result.asked += 1;
    let found: (Located & { page: number }) | null = null;
    if (item.page !== null && pages[item.page - 1]) {
      const here = locateOnPage(field, item.value, pages[item.page - 1], item.bbox);
      if (here) found = { ...here, page: item.page };
    }
    if (!found) {
      let best: (Located & { page: number }) | null = null;
      for (let n = 1; n <= pages.length; n += 1) {
        if (n === item.page) continue;
        const there = locateOnPage(field, item.value, pages[n - 1], null);
        if (there && (!best || there.score > best.score)) best = { ...there, page: n };
      }
      found = best;
    }
    if (found) {
      item.bbox = found.box;
      item.page = found.page;
      item.box_source = "ocr";
      result.located += 1;
    } else if (item.bbox !== null) {
      item.box_source ??= "model";
    }
  }
  return result;
}
