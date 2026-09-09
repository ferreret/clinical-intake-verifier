/**
 * Layer 1 of the extractor contract: the JSON Schema Gemini is asked to fill.
 *
 * Built from `schema/fields.json` at runtime so that the model is never asked for a field the
 * rest of the system does not know about. Boxes are in the model's native convention
 * (`[ymin, xmin, ymax, xmax]` on a 0-1000 scale); the boundary in normalize.ts converts them.
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

const PAGE_DESCRIPTION = "1-based number of the page the value was read from. Null when value is null.";
const BOX_DESCRIPTION =
  "Bounding box of the value on that page as [ymin, xmin, ymax, xmax], integers on a 0-1000 " +
  "scale relative to the page. Covers the value only, never its label. Null when value is null.";

function itemSchema(valueDescription: string, nullableValue: boolean): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      value: nullableValue
        ? { anyOf: [{ type: "string" }, { type: "null" }], description: valueDescription }
        : { type: "string", description: valueDescription },
      page: { anyOf: [{ type: "integer" }, { type: "null" }], description: PAGE_DESCRIPTION },
      box_2d: {
        anyOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }],
        description: BOX_DESCRIPTION,
      },
    },
    required: ["value", "page", "box_2d"],
  };
}

export function buildResponseSchema(): Record<string, unknown> {
  const fieldProperties = Object.fromEntries(
    FIELDS.map((f) => [
      f.name,
      itemSchema(`${f.description} Null when not clearly present in the document.`, true),
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
        items: itemSchema("One requested test, exactly as printed.", false),
      },
    },
    required: ["fields", "tests"],
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
