import { describe, expect, it, vi } from "vitest";
import { groundBoxes, groundingPrompt, parseGrounding } from "@/lib/extractor/grounding";
import type { NormalisedExtraction } from "@/lib/extractor/normalize";

const usage = { input_tokens: 10, output_tokens: 5, thinking_tokens: 0 };
const box = (x0: number, y0: number) => ({ x0, y0, x1: x0 + 0.1, y1: y0 + 0.01 });

function extraction(): NormalisedExtraction {
  return {
    fields: {
      Paciente: { value: "Rosario Torrecilla Tovar", page: 1, bbox: box(0.5, 0.5) },
      Telefono: null,
      Edad: { value: "19 a.", page: 2, bbox: box(0.5, 0.5) },
    },
    tests: [
      { value: "UREA", page: 1, bbox: box(0.5, 0.5) },
      { value: "UREA", page: 1, bbox: box(0.5, 0.5) },
      { value: "K", page: 1, bbox: null },
    ],
    warnings: [],
  };
}

describe("grounding pass", () => {
  it("asks in the wording of the manual check, values quoted as JSON", () => {
    expect(groundingPrompt(["UREA SÉRICA", 'say "hi"'])).toBe(
      'Locate these texts in the image and output their bounding boxes in JSON as [{"label": ..., ' +
        '"bbox_2d": [x1, y1, x2, y2]}]: "UREA SÉRICA", "say \\"hi\\"".',
    );
  });

  it("reads a fenced reply and skips malformed entries", () => {
    const text =
      '```json\n[{"bbox_2d": [87, 68, 250, 81], "label": "Rosario"}, {"label": "x", "bbox_2d": [1, 2]},' +
      ' {"label": "UREA", "bbox_2d": [63, 324, 163, 335]}, {"label": "UREA", "bbox_2d": [63, 400, 163, 411]}]\n```';
    const boxes = parseGrounding(text);
    expect([...boxes.keys()]).toEqual(["Rosario", "UREA"]);
    expect(boxes.get("UREA")).toEqual([
      [63, 324, 163, 335],
      [63, 400, 163, 411],
    ]);
    expect(parseGrounding("not json").size).toBe(0);
    expect(parseGrounding('{"label": "x"}').size).toBe(0);
  });

  it("replaces located boxes page by page and keeps the rest", async () => {
    const ex = extraction();
    const call = vi.fn(async (_page: Uint8Array, prompt: string) => {
      if (prompt.includes("Rosario")) {
        return {
          text: JSON.stringify([
            { label: "Rosario Torrecilla Tovar", bbox_2d: [87, 68, 250, 81] },
            { label: "UREA", bbox_2d: [63, 324, 163, 335] },
            { label: "UREA", bbox_2d: [63, 400, 163, 411] },
          ]),
          usage,
        };
      }
      throw new Error("server down");
    });
    const pages = [new Uint8Array([1]), new Uint8Array([2])];
    const r = await groundBoxes(ex, pages, call);

    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0][0]).toBe(pages[0]);
    expect(call.mock.calls[0][1]).toContain('"Rosario Torrecilla Tovar", "UREA", "K"');
    expect(r).toEqual({ replaced: 3, asked: 5, usage: [usage] });
    expect(ex.fields.Paciente?.bbox).toEqual({ x0: 0.087, y0: 0.068, x1: 0.25, y1: 0.081 });
    expect(ex.tests[0].bbox).toEqual({ x0: 0.063, y0: 0.324, x1: 0.163, y1: 0.335 });
    expect(ex.tests[1].bbox).toEqual({ x0: 0.063, y0: 0.4, x1: 0.163, y1: 0.411 });
    expect(ex.tests[2].bbox).toBeNull(); // not located
    expect(ex.fields.Edad?.bbox).toEqual(box(0.5, 0.5)); // its page's call failed
  });
});
