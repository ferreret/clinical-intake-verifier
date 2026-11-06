import { describe, expect, it } from "vitest";
import type { OcrPage } from "@/lib/extractor/locate";
import {
  findLine,
  fromWordLines,
  renderOcrText,
  validateOcrDocument,
  wordPages,
  type OcrTextPage,
} from "@/lib/extractor/ocr-text";
import { linesToLayer1, validateRawExtraction } from "@/lib/extractor/response-schema";
import { FIELD_NAMES } from "@/lib/schema/fields";
import type { PredictionWarning } from "@/lib/schema/prediction";

const SHA = "a".repeat(64);

/** Words laid out left to right from (x, y), each 0.01 wide per character. */
function words(x: number, y: number, text: string) {
  return text.split(" ").map((word) => {
    const box = { x0: x, y0: y, x1: x + word.length * 0.01, y1: y + 0.01 };
    x = box.x1 + 0.01;
    return { text: word, box };
  });
}

function sampleDoc() {
  const pages: OcrPage[] = [
    [words(0.1, 0.1, "Paciente: RUIZ ORTEGA, MARIA"), words(0.1, 0.2, "Sexo: M")],
    [],
    [words(0.1, 0.3, "Glucosa"), words(0.1, 0.32, "Hemograma")],
  ];
  return fromWordLines(pages, {
    engine: "tesseract",
    model: "test",
    dpi: 300,
    sha256: SHA,
    sizes: [[2481, 3508], [2481, 3508], [2481, 3508]],
    elapsed_ms: 1200,
  });
}

describe("an OCR document", () => {
  it("is built from lines of words, each line boxed by its words and numbered on its page", () => {
    const doc = sampleDoc();
    expect(validateOcrDocument(doc)).toEqual([]);
    expect(doc.pages.map((p) => p.lines.map((l) => l.id))).toEqual([["p1l1", "p1l2"], [], ["p3l1", "p3l2"]]);
    expect(doc.pages[0].lines[0]).toMatchObject({
      text: "Paciente: RUIZ ORTEGA, MARIA",
      box: { x0: 0.1, y0: 0.1, x1: 0.38, y1: 0.11 },
      mark: null,
    });
    expect(doc.pages[0]).toMatchObject({ number: 1, width: 2481, height: 3508 });
    expect(doc.checkboxes).toBe(false);
  });

  it("is checked against its schema", () => {
    const doc = sampleDoc();
    expect(validateOcrDocument({ ...doc, ocr_version: 2 })).not.toEqual([]);
    const bad = structuredClone(doc);
    bad.pages[0].lines[0].mark = "ticked" as never;
    expect(validateOcrDocument(bad)[0]).toMatch(/mark/);
  });

  it("gives locate.ts its words, and a line reported without words as one word", () => {
    const doc = sampleDoc();
    doc.pages[2].lines[1].words = [];
    const pages = wordPages(doc.pages);
    expect(pages[0][0].map((w) => w.text)).toEqual(["Paciente:", "RUIZ", "ORTEGA,", "MARIA"]);
    expect(pages[2][1]).toEqual([{ text: "Hemograma", box: doc.pages[2].lines[1].box }]);
  });
});

describe("the text the model reads", () => {
  it("numbers every line with its page, and says when a page has none", () => {
    expect(renderOcrText(sampleDoc().pages)).toBe(
      [
        "[p1] L1: Paciente: RUIZ ORTEGA, MARIA",
        "[p1] L2: Sexo: M",
        "[p2] (no text)",
        "[p3] L1: Glucosa",
        "[p3] L2: Hemograma",
      ].join("\n"),
    );
  });

  it("writes a ticked box as [X] and an empty one as [ ]", () => {
    const pages = sampleDoc().pages;
    pages[2].lines[0].mark = "checked";
    pages[2].lines[1].mark = "unchecked";
    const text = renderOcrText(pages).split("\n");
    expect(text[3]).toBe("[p3] L1: [X] Glucosa");
    expect(text[4]).toBe("[p3] L2: [ ] Hemograma");
  });

  it("finds a line by its page and number", () => {
    const pages = sampleDoc().pages;
    expect(findLine(pages, 3, 2)?.text).toBe("Hemograma");
    expect(findLine(pages, 3, 3)).toBeNull();
    expect(findLine(pages, 2, 1)).toBeNull();
    expect(findLine(pages, 9, 1)).toBeNull();
  });
});

describe("a text reply in layer 1", () => {
  const pages: OcrTextPage[] = sampleDoc().pages;

  function reply(overrides: Record<string, unknown> = {}, tests: unknown[] = []) {
    const fields: Record<string, unknown> = Object.fromEntries(FIELD_NAMES.map((n) => [n, { value: null, page: null, line: null }]));
    return { fields: { ...fields, ...overrides }, tests };
  }

  it("takes each line's box as the value's box, in Gemini's order on 0-1000", () => {
    const warnings: PredictionWarning[] = [];
    const doc = linesToLayer1(
      reply({ Paciente: { value: "RUIZ ORTEGA, MARIA", page: 1, line: 1 } }, [{ value: "Glucosa", page: 3, line: 1 }]),
      pages,
      warnings,
    ) as { fields: Record<string, unknown>; tests: unknown[] };
    expect(validateRawExtraction(doc)).toEqual([]);
    expect(doc.fields.Paciente).toEqual({ value: "RUIZ ORTEGA, MARIA", page: 1, box_2d: [100, 100, 110, 380] });
    expect(doc.fields.Sexo).toEqual({ value: null, page: null, box_2d: null });
    expect(doc.tests).toEqual([{ value: "Glucosa", page: 3, box_2d: [300, 100, 310, 170] }]);
    expect(warnings).toEqual([]);
  });

  it("reads each value written as [value, page, line], as prompt t3 asks", () => {
    const warnings: PredictionWarning[] = [];
    const doc = linesToLayer1(
      reply({ Paciente: ["RUIZ ORTEGA, MARIA", 1, 1], Sexo: null, Edad: ["41", 1, 7] }, [["Glucosa", 3, 1], ["Urea", 3]]),
      pages,
      warnings,
    ) as { fields: Record<string, unknown>; tests: unknown[] };
    expect(doc.fields.Paciente).toEqual({ value: "RUIZ ORTEGA, MARIA", page: 1, box_2d: [100, 100, 110, 380] });
    expect(doc.fields.Sexo).toEqual({ value: null, page: null, box_2d: null });
    expect(doc.fields.Edad).toEqual({ value: "41", page: 1, box_2d: null });
    expect(doc.tests[0]).toEqual({ value: "Glucosa", page: 3, box_2d: [300, 100, 310, 170] });
    // An array of another length is not read: the validator rejects it.
    expect(doc.tests[1]).toEqual(["Urea", 3]);
    expect(validateRawExtraction(doc)).not.toEqual([]);
    expect(warnings).toEqual([{ code: "bbox_invalid", field: "Edad", detail: "line 7 of page 1" }]);
  });

  it("covers the line when its box is not on the 1/1000 grid", () => {
    const odd = structuredClone(pages);
    odd[0].lines[0].box = { x0: 0.1234, y0: 0.1005, x1: 0.3456, y1: 0.1109 };
    const doc = linesToLayer1(reply({ Paciente: { value: "X", page: 1, line: 1 } }), odd) as { fields: Record<string, unknown> };
    expect(doc.fields.Paciente).toMatchObject({ box_2d: [100, 123, 111, 346] });
  });

  it("reads a line written as text", () => {
    const doc = linesToLayer1(reply({ Sexo: { value: "M", page: 1, line: "L2" } }), pages) as { fields: Record<string, unknown> };
    expect(doc.fields.Sexo).toMatchObject({ box_2d: [200, 100, 210, 170] });
  });

  it("keeps a value whose line is not on its page, without a box and with a warning", () => {
    const warnings: PredictionWarning[] = [];
    const doc = linesToLayer1(
      reply({ Sexo: { value: "M", page: 1, line: 7 }, Edad: { value: "41", page: null, line: 2 } }, [{ value: "Urea", page: 3 }]),
      pages,
      warnings,
    ) as { fields: Record<string, unknown>; tests: unknown[] };
    expect(validateRawExtraction(doc)).toEqual([]);
    expect(doc.fields.Sexo).toEqual({ value: "M", page: 1, box_2d: null });
    expect(doc.fields.Edad).toEqual({ value: "41", page: null, box_2d: null });
    expect(doc.tests).toEqual([{ value: "Urea", page: 3, box_2d: null }]);
    expect(warnings).toEqual([
      { code: "bbox_invalid", field: "Edad", detail: "line 2 of page null" },
      { code: "bbox_invalid", field: "Sexo", detail: "line 7 of page 1" },
      { code: "bbox_invalid", field: "tests", detail: "line null of page 3" },
    ]);
  });

  it("drops a box the model wrote instead of a line, and reads the shorthands of a local model", () => {
    const doc = linesToLayer1(
      reply({ Paciente: { value: "RUIZ", page: 1, line: 1, box_2d: [1, 2, 3, 4] }, Sexo: null, Edad: "41" }),
      pages,
    ) as { fields: Record<string, unknown> };
    expect(doc.fields.Paciente).toEqual({ value: "RUIZ", page: 1, box_2d: [100, 100, 110, 380] });
    expect(doc.fields.Sexo).toEqual({ value: null, page: null, box_2d: null });
    expect(doc.fields.Edad).toEqual({ value: "41", page: null, box_2d: null });
  });

  it("passes anything malformed through for the validator to reject", () => {
    expect(linesToLayer1("nope", pages)).toBe("nope");
    const doc = linesToLayer1({ fields: [], tests: "x" }, pages);
    expect(validateRawExtraction(doc)).not.toEqual([]);
  });
});
