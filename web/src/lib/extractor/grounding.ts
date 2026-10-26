/**
 * A second pass for the local model's boxes: once the values are read, each page is sent again
 * with only the values found on it, and the model is asked to locate them, in the words of its
 * own grounding training.
 *
 * Reading and locating in one long structured reply placed Qwen's boxes loosely (26% at IoU
 * 0.5 over 200 documents); asked only to locate five values on a page, it placed every one in
 * the manual check of 2026-10-26. Experimental: measured before it is adopted.
 *
 * It only ever replaces a box. Values, pages and warnings are untouched, and a value the model
 * does not locate keeps the box it had.
 */
import type { PredictedField, Usage } from "@/lib/schema/prediction";
import { toBBox, type NormalisedExtraction } from "./normalize";
import { QWEN_BOXES } from "./response-schema";

/** One request to the model: a page image and the text that goes with it. */
export type GroundingCall = (page: Uint8Array, prompt: string) => Promise<{ text: string; usage: Usage }>;

export interface GroundingResult {
  /** Boxes replaced by the second pass. */
  replaced: number;
  /** Values the second pass was asked to locate. */
  asked: number;
  usage: Usage[];
}

/** The wording of the manual check, which placed every value it was given. */
export function groundingPrompt(values: string[]): string {
  return (
    'Locate these texts in the image and output their bounding boxes in JSON as [{"label": ..., ' +
    `"bbox_2d": [x1, y1, x2, y2]}]: ${values.map((v) => JSON.stringify(v)).join(", ")}.`
  );
}

/** The located boxes of a reply, by label, in reply order; anything malformed is skipped. */
export function parseGrounding(text: string): Map<string, number[][]> {
  const boxes = new Map<string, number[][]>();
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(text);
  let doc: unknown;
  try {
    doc = JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return boxes;
  }
  if (!Array.isArray(doc)) return boxes;
  for (const entry of doc) {
    if (typeof entry !== "object" || entry === null) continue;
    const { label, bbox_2d: box } = entry as { label?: unknown; bbox_2d?: unknown };
    if (typeof label !== "string" || !Array.isArray(box) || box.length !== 4) continue;
    if (!box.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    boxes.set(label, [...(boxes.get(label) ?? []), box as number[]]);
  }
  return boxes;
}

/** Locates every value of `extraction` again, page by page, and replaces the boxes found. */
export async function groundBoxes(
  extraction: NormalisedExtraction,
  pages: Uint8Array[],
  call: GroundingCall,
): Promise<GroundingResult> {
  const items: PredictedField[] = [
    ...Object.values(extraction.fields).filter((f): f is PredictedField => f !== null),
    ...extraction.tests,
  ];
  const result: GroundingResult = { replaced: 0, asked: 0, usage: [] };
  for (let n = 1; n <= pages.length; n += 1) {
    const onPage = items.filter((item) => item.page === n);
    if (onPage.length === 0) continue;
    const values = [...new Set(onPage.map((item) => item.value))];
    result.asked += onPage.length;
    let reply;
    try {
      reply = await call(pages[n - 1], groundingPrompt(values));
    } catch {
      continue; // The first pass's boxes stand.
    }
    result.usage.push(reply.usage);
    const located = parseGrounding(reply.text);
    // The same value twice on a page takes the located boxes in order, the last one repeated.
    const used = new Map<string, number>();
    for (const item of onPage) {
      const boxes = located.get(item.value);
      if (!boxes) continue;
      const i = used.get(item.value) ?? 0;
      used.set(item.value, i + 1);
      const bbox = toBBox(QWEN_BOXES.toLayer1(boxes[Math.min(i, boxes.length - 1)]));
      if (bbox === null) continue;
      item.bbox = bbox;
      result.replaced += 1;
    }
  }
  return result;
}
