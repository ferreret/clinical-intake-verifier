import { describe, expect, it } from "vitest";
import { buildResponseSchema, validateRawExtraction } from "@/lib/extractor/response-schema";
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
