/**
 * Layer 1 of the extractor contract: the JSON Schema Gemini is asked to fill.
 *
 * Built from `schema/fields.json` at runtime so that the model is never asked for a field the
 * rest of the system does not know about. Boxes are in Gemini's native convention
 * (`[ymin, xmin, ymax, xmax]` on a 0-1000 scale); the boundary in normalize.ts converts them.
 * A model family with another convention is asked in its own, and its reply is brought to
 * this one by `toLayer1` before anything else reads it.
 */
import Ajv2020 from "ajv/dist/2020";
import { FIELDS, TESTS } from "@/lib/schema/fields";
import type { BBox, PredictionWarning } from "@/lib/schema/prediction";
import { findLine, type OcrTextPage } from "./ocr-text";

export interface RawItem {
  value: string | null;
  page: number | null;
  box_2d: number[] | null;
}

export interface RawExtraction {
  fields: Record<string, RawItem>;
  tests: RawItem[];
}

/** How a model family writes a box: the key it uses and the order of the four numbers. */
export interface BoxConvention {
  key: string;
  /** The four numbers as the prompt and the schema name them. */
  order: string;
  /** The four numbers in layer 1's order, `[ymin, xmin, ymax, xmax]`. */
  toLayer1(box: number[]): number[];
}

export const GEMINI_BOXES: BoxConvention = {
  key: "box_2d",
  order: "[ymin, xmin, ymax, xmax]",
  toLayer1: (box) => box,
};

/**
 * Qwen's own convention, from its grounding training. Asked for Gemini's instead, it kept the
 * order but invented the vertical positions (manual check of 2026-10-26).
 */
export const QWEN_BOXES: BoxConvention = {
  key: "bbox_2d",
  order: "[xmin, ymin, xmax, ymax]",
  toLayer1: ([xmin, ymin, xmax, ymax]) => [ymin, xmin, ymax, xmax],
};

/**
 * The convention a local model is asked in, by its name. Gemma writes Gemini's: asked for
 * Qwen's, it still answered `box_2d` in Gemini's order (manual check of 2026-10-27).
 */
export function localBoxes(model: string): BoxConvention {
  return /gemma/i.test(model) ? GEMINI_BOXES : QWEN_BOXES;
}

const PAGE_DESCRIPTION = "1-based number of the page the value was read from. Null when value is null.";

function boxDescription(boxes: BoxConvention): string {
  return (
    `Bounding box of the value on that page as ${boxes.order}, integers on a 0-1000 ` +
    "scale relative to the page. Covers the value only, never its label. Null when value is null."
  );
}

/** One item of the reply: its value, its page, and where on the page, under `location`. */
function itemSchema(
  valueDescription: string,
  nullableValue: boolean,
  location: [key: string, schema: Record<string, unknown>],
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      value: nullableValue
        ? { anyOf: [{ type: "string" }, { type: "null" }], description: valueDescription }
        : { type: "string", description: valueDescription },
      page: { anyOf: [{ type: "integer" }, { type: "null" }], description: PAGE_DESCRIPTION },
      [location[0]]: location[1],
    },
    required: ["value", "page", location[0]],
  };
}

function boxLocation(boxes: BoxConvention): [string, Record<string, unknown>] {
  return [
    boxes.key,
    { anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }], description: boxDescription(boxes) },
  ];
}

function responseSchema(location: [string, Record<string, unknown>]): Record<string, unknown> {
  const fieldProperties = Object.fromEntries(
    FIELDS.map((f) => [
      f.name,
      itemSchema(`${f.description} Null when not clearly present in the document.`, true, location),
    ]),
  );
  return {
    type: "object",
    properties: {
      fields: {
        type: "object",
        properties: fieldProperties,
        required: FIELDS.map((f) => f.name),
      },
      tests: {
        type: "array",
        description: TESTS.description,
        items: itemSchema("One requested test, exactly as printed.", false, location),
      },
    },
    required: ["fields", "tests"],
  };
}

export function buildResponseSchema(boxes: BoxConvention = GEMINI_BOXES): Record<string, unknown> {
  return responseSchema(boxLocation(boxes));
}

/** One value of the text reply: `[value, page, line]`. */
function textItemSchema(valueDescription: string): Record<string, unknown> {
  return {
    type: "array",
    description: "[value, page, line]",
    prefixItems: [
      { type: "string", description: valueDescription },
      { type: "integer", description: "1-based number N of the page the value was read from, from the [pN] in front of it." },
      { type: "integer", description: "Number k of the line the value is on, from the Lk in front of it." },
    ],
    minItems: 3,
    maxItems: 3,
  };
}

/**
 * The schema of the text pipeline's reply (prompt-text.ts, since t3): each value as `[value,
 * page, line]`, the number of the OCR line it is on instead of a box, and a field not present
 * as null. `linesToLayer1` turns the line into the box.
 */
export function buildTextResponseSchema(): Record<string, unknown> {
  const fieldProperties = Object.fromEntries(
    FIELDS.map((f) => [
      f.name,
      { anyOf: [textItemSchema(f.description), { type: "null" }], description: "Null when not clearly present in the document." },
    ]),
  );
  return {
    type: "object",
    properties: {
      fields: { type: "object", properties: fieldProperties, required: FIELDS.map((f) => f.name) },
      tests: { type: "array", description: TESTS.description, items: textItemSchema("One requested test, exactly as printed.") },
    },
    required: ["fields", "tests"],
  };
}

/**
 * A parsed reply in `boxes`' convention, rewritten in layer 1's: each item's box under
 * `box_2d`, in Gemini's order. Anything malformed is passed through for the validator to
 * reject; nothing is repaired here. An item without `boxes.key` loses any `box_2d` it has,
 * so that it fails validation: the order of a box under the wrong key cannot be known. Two
 * shorthands a local model uses without constrained decoding are read for what they say,
 * whatever its convention: a bare null is a field not present, and a bare string is a value it
 * did not locate (page and box null). Gemini's constrained replies are not passed through here.
 */
export function toLayer1(doc: unknown, boxes: BoxConvention): unknown {
  if (typeof doc !== "object" || doc === null) return doc;
  const item = (raw: unknown): unknown => {
    if (typeof raw === "string") return { value: raw, page: null, box_2d: null };
    if (typeof raw !== "object" || raw === null) return raw;
    if (!(boxes.key in raw)) {
      const rest = { ...(raw as Record<string, unknown>) };
      delete rest.box_2d;
      return rest;
    }
    const { [boxes.key]: box, ...rest } = raw as Record<string, unknown>;
    const isBox = Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === "number");
    return { ...rest, box_2d: isBox ? boxes.toLayer1(box as number[]) : box };
  };
  const { fields, tests, ...rest } = doc as Record<string, unknown>;
  return {
    ...rest,
    fields:
      typeof fields === "object" && fields !== null
        ? Object.fromEntries(
            Object.entries(fields).map(([name, raw]) => [
              name,
              raw === null ? { value: null, page: null, box_2d: null } : item(raw),
            ]),
          )
        : fields,
    tests: Array.isArray(tests) ? tests.map(item) : tests,
  };
}

/** A line number as the text reply writes it: 17, or "17" or "L17" when written as text. */
function lineNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  const m = typeof raw === "string" ? /^\s*L?(\d+)\s*$/i.exec(raw) : null;
  return m ? Number(m[1]) : null;
}

/**
 * A field the text reply says is not present with an array that holds nothing: up to three
 * items, the first null or the word "null", the rest null. Qwen wrote `["null", null, null]`
 * for two fields on prompt t3's smoke (synth-000003) and `[null]` on its 200 (synth-000179),
 * 2026-11-06. With a page or a line, it is left as written.
 */
function isWrittenNull(written: unknown): boolean {
  return (
    Array.isArray(written) &&
    written.length >= 1 &&
    written.length <= 3 &&
    (written[0] === null || written[0] === "null") &&
    written.slice(1).every((x) => x === null)
  );
}

/** A box on 0-1 of the page as layer 1 writes it: `[ymin, xmin, ymax, xmax]`, integers on 0-1000, covering it. */
function boxToLayer1(box: BBox): number[] {
  return [Math.floor(box.y0 * 1000), Math.floor(box.x0 * 1000), Math.ceil(box.y1 * 1000), Math.ceil(box.x1 * 1000)];
}

/**
 * A parsed reply of the text pipeline, `[value, page, line]` per item (prompt t3) or
 * `{value, page, line}` (t1 and t2), rewritten in layer 1's shape: the line's box, which the
 * OCR measured, as `box_2d` in Gemini's order. normalize.ts, the harness and the UI then read
 * it as any other reply. The box covers the whole line; the caller tightens it to the value
 * (relocateBoxes).
 *
 * A value with no line, or with a line that is not on its page, gives no box, the value and
 * page kept, and is reported in `warnings` as `bbox_invalid`. A box written instead of a line is
 * dropped: in this pipeline the model never sees the page, so it cannot measure one. The
 * shorthands of toLayer1 are read in the same way: a bare null is a field not present, a bare
 * string a value with no page and no line; and in a field, an array that holds nothing, such as
 * `["null", null, null]` or `[null]`, a field not present (isWrittenNull). Any other array not
 * of three items is passed through for the validator to reject.
 */
export function linesToLayer1(doc: unknown, pages: readonly OcrTextPage[], warnings?: PredictionWarning[]): unknown {
  if (typeof doc !== "object" || doc === null) return doc;
  const item = (written: unknown, field: string): unknown => {
    if (field !== "tests" && isWrittenNull(written)) return { value: null, page: null, box_2d: null };
    if (Array.isArray(written) && written.length !== 3) return written;
    const raw = Array.isArray(written) ? { value: written[0], page: written[1], line: written[2] } : written;
    if (typeof raw === "string") return { value: raw, page: null, box_2d: null };
    if (typeof raw !== "object" || raw === null) return raw;
    const rest = { ...(raw as Record<string, unknown>) };
    const line = rest.line;
    delete rest.line;
    delete rest.box_2d;
    delete rest.bbox_2d;
    let box: number[] | null = null;
    if (typeof rest.value === "string" && rest.value.trim() !== "") {
      const n = lineNumber(line);
      const found = typeof rest.page === "number" && n !== null ? findLine(pages, rest.page, n) : null;
      if (found) box = boxToLayer1(found.box);
      else warnings?.push({ code: "bbox_invalid", field, detail: `line ${JSON.stringify(line ?? null)} of page ${JSON.stringify(rest.page ?? null)}` });
    }
    return { ...rest, box_2d: box };
  };
  const { fields, tests, ...rest } = doc as Record<string, unknown>;
  return {
    ...rest,
    fields:
      typeof fields === "object" && fields !== null
        ? Object.fromEntries(
            Object.entries(fields).map(([name, raw]) => [
              name,
              raw === null ? { value: null, page: null, box_2d: null } : item(raw, name),
            ]),
          )
        : fields,
    tests: Array.isArray(tests) ? tests.map((t) => item(t, "tests")) : tests,
  };
}

let rawValidator: ReturnType<Ajv2020["compile"]> | null = null;

/** Errors of a parsed model response against the layer-1 schema; empty when it conforms. */
export function validateRawExtraction(doc: unknown): string[] {
  if (!rawValidator) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    rawValidator = ajv.compile(buildResponseSchema());
  }
  if (rawValidator(doc)) return [];
  return (rawValidator.errors ?? []).map(
    (e) => `${e.instancePath || "<root>"}: ${e.message ?? "invalid"}`,
  );
}
