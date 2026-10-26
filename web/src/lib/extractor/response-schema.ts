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

const PAGE_DESCRIPTION = "1-based number of the page the value was read from. Null when value is null.";

function boxDescription(boxes: BoxConvention): string {
  return (
    `Bounding box of the value on that page as ${boxes.order}, integers on a 0-1000 ` +
    "scale relative to the page. Covers the value only, never its label. Null when value is null."
  );
}

function itemSchema(valueDescription: string, nullableValue: boolean, boxes: BoxConvention): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      value: nullableValue
        ? { anyOf: [{ type: "string" }, { type: "null" }], description: valueDescription }
        : { type: "string", description: valueDescription },
      page: { anyOf: [{ type: "integer" }, { type: "null" }], description: PAGE_DESCRIPTION },
      [boxes.key]: {
        anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
        description: boxDescription(boxes),
      },
    },
    required: ["value", "page", boxes.key],
  };
}

export function buildResponseSchema(boxes: BoxConvention = GEMINI_BOXES): Record<string, unknown> {
  const fieldProperties = Object.fromEntries(
    FIELDS.map((f) => [
      f.name,
      itemSchema(`${f.description} Null when not clearly present in the document.`, true, boxes),
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
        items: itemSchema("One requested test, exactly as printed.", false, boxes),
      },
    },
    required: ["fields", "tests"],
  };
}

/**
 * A parsed reply in `boxes`' convention, rewritten in layer 1's: each item's box under
 * `box_2d`, in Gemini's order. Anything malformed is passed through for the validator to
 * reject; nothing is repaired here. An item without `boxes.key` loses any `box_2d` it has,
 * so that it fails validation: the order of a box under the wrong key cannot be known. Two
 * shorthands the local model uses without constrained decoding are read for what they say: a
 * bare null is a field not present, and a bare string is a value it did not locate (page and
 * box null).
 */
export function toLayer1(doc: unknown, boxes: BoxConvention): unknown {
  if (boxes === GEMINI_BOXES || typeof doc !== "object" || doc === null) return doc;
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
