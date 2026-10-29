import { describe, expect, it } from "vitest";
import { locateOnPage, matchKey, printedKeys, relocateBoxes, similarity, type OcrPage } from "@/lib/extractor/locate";
import type { BBox, PredictedField } from "@/lib/schema/prediction";

/** A line of words laid out left to right from (x, y), each word 0.01 wide per character. */
function line(x: number, y: number, text: string) {
  const words = [];
  for (const word of text.split(" ")) {
    const w = word.length * 0.01;
    words.push({ text: word, box: { x0: x, y0: y, x1: x + w, y1: y + 0.01 } });
    x += w + 0.01;
  }
  return words;
}

const near = (x: number, y: number): BBox => ({ x0: x, y0: y, x1: x + 0.05, y1: y + 0.01 });

describe("match keys", () => {
  it("keeps letters and digits only, without accents or case", () => {
    expect(matchKey("Fe en sèrum")).toBe("feenserum");
    expect(matchKey("[X] Masculí")).toBe("xmasculi");
    expect(matchKey("658-073-652")).toBe("658073652");
  });

  it("scores by edit distance", () => {
    expect(similarity("homocisteina", "homocisteina")).toBe(1);
    expect(similarity("homocisteina", "homocisteia")).toBeCloseTo(11 / 12);
    expect(similarity("", "")).toBe(0);
  });

  it("looks for normalised fields as forms print them", () => {
    const date = printedKeys("FechaNacimiento", "01/05/1971");
    expect(date).toEqual(expect.arrayContaining(["01051971", "19710501", "151971", "010571", "01maig1971", "1mayo1971"]));
    expect(printedKeys("Sexo", "H")).toEqual(expect.arrayContaining(["h", "hombre", "home", "masculi", "v"]));
    // As the prompt says: F is female.
    expect(printedKeys("Sexo", "M")).toEqual(expect.arrayContaining(["m", "mujer", "f", "dona"]));
    expect(printedKeys("Paciente", "Pía Manjón")).toEqual(["piamanjon"]);
    expect(printedKeys("tests", "Γ-GT")).toEqual(["γgt"]);
  });
});

describe("locating a value on a page", () => {
  it("finds a value the OCR misread, as a run of words on its line", () => {
    const page: OcrPage = [line(0.1, 0.1, "Nombre: Manjón Tapia, Pía"), line(0.1, 0.3, "HOMOCISTEÍA 12096")];
    const found = locateOnPage("tests", "HOMOCISTEÍNA", page, near(0.1, 0.32));
    expect(found?.box).toEqual({ x0: 0.1, y0: 0.3, x1: 0.21, y1: 0.31 });
    const name = locateOnPage("Paciente", "Manjón Tapia, Pía", page, null);
    expect(name?.box.x0).toBeCloseTo(0.18);
  });

  it("takes the occurrence nearest the model's box", () => {
    const page: OcrPage = [line(0.7, 0.05, "2601214004"), line(0.1, 0.5, "Petición 2601214004")];
    expect(locateOnPage("NumeroPeticion", "2601214004", page, near(0.2, 0.48))?.box.y0).toBe(0.5);
    expect(locateOnPage("NumeroPeticion", "2601214004", page, near(0.7, 0.06))?.box.y0).toBe(0.05);
  });

  it("matches a short value only exactly and near the model's box", () => {
    const page: OcrPage = [line(0.1, 0.2, "TSH"), line(0.1, 0.8, "TSH")];
    expect(locateOnPage("tests", "TSH", page, near(0.1, 0.75))?.box.y0).toBe(0.8);
    expect(locateOnPage("tests", "TSH", page, near(0.5, 0.5))).toBeNull();
    expect(locateOnPage("tests", "TSH", page, null)).toBeNull();
    expect(locateOnPage("tests", "TSI", [line(0.1, 0.2, "TSH")], near(0.1, 0.2))).toBeNull();
  });

  it("keeps a doctor's title and a tick inside the box", () => {
    const page: OcrPage = [line(0.1, 0.1, "Médico: Dra. Dolores Herrero"), line(0.1, 0.2, "Sexo: [X] Home [ ] Dona")];
    expect(locateOnPage("NombreMedico", "Dolores Herrero", page, near(0.2, 0.1))?.box.x0).toBeCloseTo(0.18);
    expect(locateOnPage("Sexo", "H", page, near(0.16, 0.2))?.box).toMatchObject({ x0: 0.16, x1: 0.24 });
  });

  it("finds a date printed in another order or with the month's name", () => {
    expect(locateOnPage("FechaNacimiento", "09/05/1985", [line(0.1, 0.1, "F. nac.: 1985-05-09")], null)?.box.x0).toBeCloseTo(0.19);
    expect(locateOnPage("FechaNacimiento", "01/05/1971", [line(0.1, 0.1, "Naix.: 01-maig-1971")], null)).not.toBeNull();
  });

  it("rejects text that is not close enough", () => {
    expect(locateOnPage("tests", "FERRITINA SÉRICA", [line(0.1, 0.1, "TRANSFERRINA")], null)).toBeNull();
  });
});

describe("relocating the boxes of an extraction", () => {
  const field = (value: string, page: number | null, bbox: BBox | null): PredictedField =>
    bbox === null ? { value, page, bbox } : { value, page, bbox, box_source: "model" };

  it("replaces the boxes found, moves a value to the page it is on, and keeps the rest", () => {
    const pages: OcrPage[] = [[line(0.1, 0.1, "Hoja de transmisión")], [line(0.1, 0.2, "Manjón Tapia, Pía"), line(0.1, 0.4, "UREA")]];
    const extraction = {
      fields: {
        Paciente: field("Manjón Tapia, Pía", 1, near(0.5, 0.5)),
        Telefono: field("658073652", 2, near(0.5, 0.5)),
        Edad: null,
      },
      tests: [field("UREA", 2, near(0.12, 0.42)), field("Urea sérica", null, null)],
    };
    expect(relocateBoxes(extraction, pages)).toEqual({ located: 2, asked: 4 });
    expect(extraction.fields.Paciente).toMatchObject({ page: 2, box_source: "ocr", bbox: { y0: 0.2 } });
    expect(extraction.fields.Telefono).toEqual(field("658073652", 2, near(0.5, 0.5)));
    expect(extraction.tests[0]).toMatchObject({ page: 2, box_source: "ocr", bbox: { y0: 0.4 } });
    expect(extraction.tests[1]).toEqual({ value: "Urea sérica", page: null, bbox: null });
  });
});
