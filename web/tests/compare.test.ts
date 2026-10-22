import { describe, expect, it } from "vitest";
import compareCases from "../../schema/compare-cases.json";
import { COMPARE_MODES, compareKey, valuesMatch } from "@/lib/schema/compare";
import { FIELDS, TESTS, type CompareMode } from "@/lib/schema/fields";
import fieldsJson from "../../schema/fields.json";

interface Case {
  mode: CompareMode;
  a: string;
  b: string;
  match: boolean;
  note?: string;
}

const CASES = compareCases.cases as Case[];

describe("shared compare cases", () => {
  it.each(CASES.map((c) => [`${c.mode}: ${JSON.stringify(c.a)} ~ ${JSON.stringify(c.b)}`, c] as const))(
    "%s",
    (_, c) => {
      expect(valuesMatch(c.a, c.b, c.mode), c.note).toBe(c.match);
      expect(valuesMatch(c.b, c.a, c.mode), "not symmetric").toBe(c.match);
    },
  );
});

describe("compare modes", () => {
  it("implements exactly the configured modes, each with matching and non-matching cases", () => {
    const configured = Object.keys(fieldsJson.compare_modes).sort();
    expect([...COMPARE_MODES].sort()).toEqual(configured);
    for (const used of [...FIELDS.map((f) => f.compare), TESTS.compare]) {
      expect(configured).toContain(used);
    }
    for (const mode of configured) {
      expect(CASES.some((c) => c.mode === mode && c.match)).toBe(true);
      expect(CASES.some((c) => c.mode === mode && !c.match)).toBe(true);
    }
  });

  it("rejects an unknown mode", () => {
    expect(() => compareKey("x", "fuzzy" as CompareMode)).toThrow(/unknown compare mode/);
  });
});
