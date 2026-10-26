import { describe, expect, it } from "vitest";
import {
  buildResponseSchema,
  GEMINI_BOXES,
  QWEN_BOXES,
  toLayer1,
  validateRawExtraction,
} from "@/lib/extractor/response-schema";
import { FIELD_NAMES } from "@/lib/schema/fields";

interface Shape {
  properties: {
    fields: { properties: Record<string, unknown>; required: string[] };
    tests: { items: { required: string[] } };
  };
  required: string[];
}

describe("layer-1 schema", () => {
  it("asks for exactly the configured fields", () => {
    const schema = buildResponseSchema() as unknown as Shape;
    expect(schema.required).toEqual(["fields", "tests"]);
    expect(Object.keys(schema.properties.fields.properties)).toEqual([...FIELD_NAMES]);
    expect(schema.properties.fields.required).toEqual([...FIELD_NAMES]);
    expect(schema.properties.tests.items.required).toEqual(["value", "page", "box_2d"]);
  });

  it("accepts a conforming response and rejects malformed ones", () => {
    const fields = Object.fromEntries(FIELD_NAMES.map((n) => [n, { value: null, page: null, box_2d: null }]));
    expect(validateRawExtraction({ fields, tests: [] })).toEqual([]);
    expect(validateRawExtraction({ fields: {}, tests: [] }).length).toBeGreaterThan(0);
    expect(validateRawExtraction({ fields, tests: [{ value: null, page: 1, box_2d: null }] }).length).toBeGreaterThan(0);
    expect(validateRawExtraction("nope").length).toBeGreaterThan(0);
  });
});

describe("box conventions", () => {
  const nullFields = (key: string): Record<string, unknown> =>
    Object.fromEntries(FIELD_NAMES.map((n) => [n, { value: null, page: null, [key]: null }]));

  it("asks Qwen for its own key and order", () => {
    const schema = buildResponseSchema(QWEN_BOXES) as unknown as Shape;
    expect(schema.properties.tests.items.required).toEqual(["value", "page", "bbox_2d"]);
    expect(JSON.stringify(schema)).toContain("[xmin, ymin, xmax, ymax]");
    expect(JSON.stringify(schema)).not.toContain("ymin, xmin");
  });

  it("rewrites Qwen's boxes in layer 1's key and order", () => {
    const fields = nullFields("bbox_2d");
    fields.Paciente = { value: "RUIZ ORTEGA, MARIA", page: 2, bbox_2d: [605, 302, 704, 315] };
    const doc = toLayer1({ fields, tests: [{ value: "Urea", page: 1, bbox_2d: [96, 515, 129, 526] }] }, QWEN_BOXES);
    expect(validateRawExtraction(doc)).toEqual([]);
    const out = doc as { fields: Record<string, unknown>; tests: unknown[] };
    expect(out.fields.Paciente).toEqual({ value: "RUIZ ORTEGA, MARIA", page: 2, box_2d: [302, 605, 315, 704] });
    expect(out.fields.Telefono).toEqual({ value: null, page: null, box_2d: null });
    expect(out.tests).toEqual([{ value: "Urea", page: 1, box_2d: [515, 96, 526, 129] }]);
  });

  it("reads a field written as a bare null as absent", () => {
    const fields = nullFields("bbox_2d");
    fields.Telefono = null;
    const doc = toLayer1({ fields, tests: [] }, QWEN_BOXES) as { fields: Record<string, unknown> };
    expect(validateRawExtraction(doc)).toEqual([]);
    expect(doc.fields.Telefono).toEqual({ value: null, page: null, box_2d: null });
  });

  it("passes malformed replies through for the validator to reject", () => {
    const wrongKey = toLayer1({ fields: nullFields("box_2d"), tests: [] }, QWEN_BOXES);
    expect(validateRawExtraction(wrongKey).length).toBeGreaterThan(0);
    const shortBox = toLayer1({ fields: nullFields("bbox_2d"), tests: [{ value: "Urea", page: 1, bbox_2d: [1, 2] }] }, QWEN_BOXES);
    expect((shortBox as { tests: unknown[] }).tests).toEqual([{ value: "Urea", page: 1, box_2d: [1, 2] }]);
    expect(toLayer1("nope", QWEN_BOXES)).toBe("nope");
    expect(validateRawExtraction(toLayer1({ fields: {}, tests: "nope" }, QWEN_BOXES)).length).toBeGreaterThan(0);
  });

  it("leaves Gemini's replies untouched", () => {
    const doc = { fields: nullFields("box_2d"), tests: [] };
    expect(toLayer1(doc, GEMINI_BOXES)).toBe(doc);
  });
});
