import { describe, expect, it } from "vitest";
import { alignLines } from "@/lib/mapping/align";

const golden = [
  { value: "Activitat de protrombina", codes: ["HE0101"] },
  { value: "Fe en sèrum", codes: ["BQ0201"] },
  { value: "TSH", codes: ["HO0301"] },
  { value: "LH", codes: ["HO0302"] },
];

describe("aligning read lines with the golden's", () => {
  it("pairs exact and misread lines, and lists what was invented or not read", () => {
    const { lines, unread } = alignLines(["FE EN SÈRUM", "Activitad de protrombina", "Urea"], golden);
    expect(lines).toEqual([
      { text: "FE EN SÈRUM", golden: "Fe en sèrum", truth: ["BQ0201"], reading: "exact" },
      { text: "Activitad de protrombina", golden: "Activitat de protrombina", truth: ["HE0101"], reading: "misread" },
      { text: "Urea", golden: null, truth: [], reading: "invented" },
    ]);
    expect(unread.map((t) => t.value)).toEqual(["TSH", "LH"]);
  });

  it("takes one wrong letter in a short test as a misread", () => {
    const { lines } = alignLines(["G-GT"], [{ value: "Γ-GT", codes: ["BQ0401"] }]);
    expect(lines[0]).toMatchObject({ golden: "Γ-GT", reading: "misread" });
  });

  it("takes each golden line once: a line read twice is invented the second time", () => {
    const { lines } = alignLines(["TSH", "TSH"], golden);
    expect(lines.map((l) => l.reading)).toEqual(["exact", "invented"]);
  });

  it("lets the closest misread have the golden line", () => {
    const { lines } = alignLines(["Activitat de protromb", "Activitat de protrombin"], golden.slice(0, 1));
    expect(lines.map((l) => l.reading)).toEqual(["invented", "misread"]);
  });
});
