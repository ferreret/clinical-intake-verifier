import { describe, expect, it } from "vitest";
import compareCases from "../../schema/compare-cases.json";
import { COMPARE_MODES, compareKey, valuesMatch } from "@/lib/schema/compare";
import { FIELDS, inForm, TESTS, type CompareMode } from "@/lib/schema/fields";
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

describe("values in their field's form", () => {
  const spec = (name: string) => FIELDS.find((f) => f.name === name)!;
  it("takes a date only if it exists, as dd/mm/yyyy", () => {
    expect(inForm(spec("FechaNacimiento"), "29/02/2024")).toBe(true);
    expect(inForm(spec("FechaNacimiento"), "29/02/2023")).toBe(false);
    expect(inForm(spec("FechaNacimiento"), "31/04/1990")).toBe(false);
    expect(inForm(spec("FechaNacimiento"), "1990-01-31")).toBe(false);
  });
  it("takes a sex only as H, M or U, and leaves an empty value to `required`", () => {
    expect(inForm(spec("Sexo"), "M")).toBe(true);
    expect(inForm(spec("Sexo"), "X")).toBe(false);
    expect(inForm(spec("Sexo"), "")).toBe(true);
    expect(inForm(spec("Paciente"), "anything")).toBe(true);
  });
});
