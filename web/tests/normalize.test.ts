import { describe, expect, it } from "vitest";
import { garbledCount, garbledReason, normaliseExtraction, stripTitle, toBBox } from "@/lib/extractor/normalize";
import type { RawExtraction, RawItem } from "@/lib/extractor/response-schema";
import { FIELD_NAMES } from "@/lib/schema/fields";

const absent = (): RawItem => ({ value: null, page: null, box_2d: null });

function raw(overrides: Record<string, RawItem> = {}, tests: RawItem[] = []): RawExtraction {
  const fields = Object.fromEntries(FIELD_NAMES.map((n) => [n, absent()]));
  return { fields: { ...fields, ...overrides }, tests };
}

describe("toBBox", () => {
  it("converts [ymin, xmin, ymax, xmax] on 0-1000 to {x0, y0, x1, y1} on 0-1", () => {
    expect(toBBox([302, 605, 315, 704])).toEqual({ x0: 0.605, y0: 0.302, x1: 0.704, y1: 0.315 });
  });

  it("rounds to four decimals and clamps to the page", () => {
    expect(toBBox([-5, 1.4, 1200, 999.96])).toEqual({ x0: 0.0014, y0: 0, x1: 1, y1: 1 });
  });

  it("rejects degenerate or malformed boxes", () => {
    expect(toBBox([10, 10, 10, 50])).toBeNull();
    expect(toBBox([10, 60, 20, 50])).toBeNull();
    expect(toBBox([1, 2, 3])).toBeNull();
    expect(toBBox(["a", 2, 3, 4])).toBeNull();
    expect(toBBox(null)).toBeNull();
  });
});

describe("stripTitle", () => {
  it("drops leading titles, with or without the full stop, in any case", () => {
    expect(stripTitle("Dra. Pepita Conde Tirado")).toBe("Pepita Conde Tirado");
    expect(stripTitle("Dr Luis Gil Mora")).toBe("Luis Gil Mora");
    expect(stripTitle("DR.LUIS GIL MORA")).toBe("LUIS GIL MORA");
    expect(stripTitle("Doctora Ana Ruiz Peña")).toBe("Ana Ruiz Peña");
    expect(stripTitle("Prof. Dr. Juan Sanz Vidal")).toBe("Juan Sanz Vidal");
  });

  it("leaves names that only start like a title, and a bare title, untouched", () => {
    expect(stripTitle("Dragomir Petrov Ivanov")).toBe("Dragomir Petrov Ivanov");
    expect(stripTitle("Pepita Conde Tirado")).toBe("Pepita Conde Tirado");
    expect(stripTitle("Dra.")).toBe("Dra.");
  });
});

describe("normaliseExtraction", () => {
  it("returns every configured field in configuration order and nothing else", () => {
    const out = normaliseExtraction(raw(), 1);
    expect(Object.keys(out.fields)).toEqual([...FIELD_NAMES]);
    expect(Object.values(out.fields).every((v) => v === null)).toBe(true);
    expect(out.tests).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("converts a complete field and trims its value", () => {
    const out = normaliseExtraction(
      raw({ Paciente: { value: " RUIZ ORTEGA, MARIA ", page: 2, box_2d: [302, 605, 315, 704] } }),
      3,
    );
    expect(out.fields.Paciente).toEqual({
      value: "RUIZ ORTEGA, MARIA",
      page: 2,
      bbox: { x0: 0.605, y0: 0.302, x1: 0.704, y1: 0.315 },
    });
    expect(out.warnings).toEqual([]);
  });

  it("keeps a value that fails its pattern and flags it instead of repairing it", () => {
    const out = normaliseExtraction(
      raw({
        FechaNacimiento: { value: "1978-03-12", page: 1, box_2d: [1, 1, 2, 2] },
        Sexo: { value: "F", page: 1, box_2d: [1, 1, 2, 2] },
      }),
      1,
    );
    expect(out.fields.FechaNacimiento?.value).toBe("1978-03-12");
    expect(out.fields.Sexo?.value).toBe("F");
    expect(out.warnings).toEqual([
      { code: "pattern_mismatch", field: "FechaNacimiento", detail: "1978-03-12" },
      { code: "pattern_mismatch", field: "Sexo", detail: "F" },
    ]);
  });

  it("accepts values that match their pattern without warnings", () => {
    const out = normaliseExtraction(
      raw({
        FechaNacimiento: { value: "12/03/1978", page: 1, box_2d: [1, 1, 2, 2] },
        Sexo: { value: "M", page: 1, box_2d: [1, 1, 2, 2] },
      }),
      1,
    );
    expect(out.warnings).toEqual([]);
  });

  it("removes a title the model kept on the physician's name and flags it", () => {
    const out = normaliseExtraction(
      raw({ NombreMedico: { value: "Dra. Pepita Conde Tirado", page: 1, box_2d: [1, 1, 2, 2] } }),
      1,
    );
    expect(out.fields.NombreMedico?.value).toBe("Pepita Conde Tirado");
    expect(out.warnings).toEqual([
      { code: "title_removed", field: "NombreMedico", detail: "Dra. Pepita Conde Tirado" },
    ]);
  });

  it("applies the title rule only to fields that declare it", () => {
    const out = normaliseExtraction(
      raw({
        NombreMedico: { value: "Pepita Conde Tirado", page: 1, box_2d: [1, 1, 2, 2] },
        Paciente: { value: "Dr. Smith", page: 1, box_2d: [1, 1, 2, 2] },
      }),
      1,
    );
    expect(out.fields.NombreMedico?.value).toBe("Pepita Conde Tirado");
    expect(out.fields.Paciente?.value).toBe("Dr. Smith");
    expect(out.warnings).toEqual([]);
  });

  it("flags garbled text in a value without repairing it", () => {
    const out = normaliseExtraction(
      raw(
        { Paciente: { value: "Jose Luis Est\tevez Samper", page: 1, box_2d: [1, 1, 2, 2] } },
        [{ value: "Fibrin\u0003ogeno", page: 1, box_2d: [3, 1, 4, 2] }],
      ),
      1,
    );
    expect(out.fields.Paciente?.value).toBe("Jose Luis Est\tevez Samper");
    expect(out.tests.map((t) => t.value)).toEqual(["Fibrin\u0003ogeno"]);
    expect(out.warnings).toEqual([
      { code: "garbled_text", field: "Paciente", detail: 'control character: "Jose Luis Est\\tevez Samper"' },
      { code: "garbled_text", field: "tests", detail: 'control character: "Fibrin\\u0003ogeno"' },
    ]);
    expect(garbledCount(out)).toBe(2);
  });

  it("does not flag accented letters", () => {
    const out = normaliseExtraction(
      raw({ Paciente: { value: "Jose Luis Estévez Samper", page: 1, box_2d: [1, 1, 2, 2] } }),
      1,
    );
    expect(out.warnings).toEqual([]);
  });
});

describe("garbledReason", () => {
  it("recognises every form of corruption seen in the full runs", () => {
    expect(garbledReason("Est\tevez", true)).toBe("control character");
    expect(garbledReason("Hayd\u0000\u0000\u0000\u0000", true)).toBe("control character");
    expect(garbledReason("Ferr&#225;ndiz", true)).toBe("HTML entity");
    expect(garbledReason("Triglic&eacute;ridos", false)).toBe("HTML entity");
    expect(garbledReason("Odalys M!rmol Vives", true)).toBe("'!' next to a letter");
    expect(garbledReason("!cido !rico", false)).toBe("'!' next to a letter");
    expect(garbledReason("P0a Martinez Carmona", true)).toBe("digit between letters");
  });

  it("allows digits between letters outside names, where tests have them", () => {
    expect(garbledReason("Hemoglobina glicosilada (HbA1c)", false)).toBeNull();
    expect(garbledReason("Vitamina B12", false)).toBeNull();
    expect(garbledReason("HbA1c", true)).toBe("digit between letters");
  });

  it("leaves ordinary text alone", () => {
    for (const v of ["Ibáñez Ruiz, Begoña", "Ácido úrico", "Seguros & Salud", "45 años", "12345678-Z"]) {
      expect(garbledReason(v, true), v).toBeNull();
    }
  });

  it("treats an empty value as absent", () => {
    const out = normaliseExtraction(raw({ Telefono: { value: "   ", page: 1, box_2d: [1, 1, 2, 2] } }), 1);
    expect(out.fields.Telefono).toBeNull();
    expect(out.warnings).toEqual([{ code: "empty_value", field: "Telefono", detail: "empty string treated as null" }]);
  });

  it("drops page and box when the page is out of range, keeping the value", () => {
    const out = normaliseExtraction(raw({ Edad: { value: "45 años", page: 9, box_2d: [1, 1, 2, 2] } }), 3);
    expect(out.fields.Edad).toEqual({ value: "45 años", page: null, bbox: null });
    expect(out.warnings).toEqual([{ code: "page_out_of_range", field: "Edad", detail: "page 9 of 3" }]);
  });

  it("keeps the value when the box is unusable", () => {
    const out = normaliseExtraction(raw({ Edad: { value: "45", page: 1, box_2d: [10, 10, 10, 10] } }), 1);
    expect(out.fields.Edad).toEqual({ value: "45", page: 1, bbox: null });
    expect(out.warnings).toEqual([{ code: "bbox_invalid", field: "Edad", detail: "[10,10,10,10]" }]);
  });

  it("drops keys that are not configured fields", () => {
    const out = normaliseExtraction(raw({ Foo: { value: "bar", page: 1, box_2d: null } }), 1);
    expect("Foo" in out.fields).toBe(false);
    expect(out.warnings).toEqual([{ code: "unexpected_key", field: "Foo", detail: "not a configured field; dropped" }]);
  });

  it("deduplicates tests case-, accent- and whitespace-insensitively, keeping first order", () => {
    const out = normaliseExtraction(
      raw({}, [
        { value: "Hemograma completo", page: 1, box_2d: [1, 1, 2, 2] },
        { value: "Urea", page: 1, box_2d: [3, 1, 4, 2] },
        { value: "HEMOGRAMA  COMPLETO", page: 2, box_2d: [1, 1, 2, 2] },
        { value: "Hemógrama completo", page: 2, box_2d: [1, 1, 2, 2] },
        { value: "", page: 2, box_2d: null },
      ]),
      2,
    );
    expect(out.tests.map((t) => t.value)).toEqual(["Hemograma completo", "Urea"]);
    expect(out.warnings).toEqual([
      { code: "duplicate_test", field: "tests", detail: "HEMOGRAMA  COMPLETO" },
      { code: "duplicate_test", field: "tests", detail: "Hemógrama completo" },
      { code: "empty_value", field: "tests", detail: "empty string treated as null" },
    ]);
  });
});
