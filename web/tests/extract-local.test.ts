import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extract } from "@/lib/extractor";
import { callLocal, LocalModelError, stripFence } from "@/lib/extractor/local";
import { renderPages } from "@/lib/extractor/render";
import { FIELD_NAMES } from "@/lib/schema/fields";
import { validatePrediction } from "@/lib/schema/prediction";

vi.mock("@/lib/extractor/local", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/extractor/local")>();
  return { ...mod, callLocal: vi.fn() };
});
const mockedCall = vi.mocked(callLocal);

async function samplePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([595.28, 841.89]);
  return doc.save();
}

function reply(text: string) {
  return { text, modelVersion: "qwen/test", usage: { input_tokens: 3000, output_tokens: 900, thinking_tokens: 0 } };
}

/** A reply in Qwen's convention: `bbox_2d` as [xmin, ymin, xmax, ymax]. */
function qwenJson(): string {
  const fields: Record<string, unknown> = Object.fromEntries(
    FIELD_NAMES.map((n) => [n, { value: null, page: null, bbox_2d: null }]),
  );
  fields.Paciente = { value: "RUIZ ORTEGA, MARIA", page: 2, bbox_2d: [605, 302, 704, 315] };
  return JSON.stringify({ fields, tests: [{ value: "Urea", page: 2, bbox_2d: [96, 515, 129, 526] }] });
}

/** PNG width and height, from the IHDR chunk. */
function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

const opts = { provider: "local" as const, model: "qwen/test", apiKey: "", retryDelayMs: 0 };

beforeEach(() => {
  mockedCall.mockReset();
});

describe("extract with the local provider", () => {
  it("sends one image per page and converts Qwen's boxes", async () => {
    mockedCall.mockResolvedValueOnce(reply(qwenJson()));
    const p = await extract(await samplePdf(), { ...opts, file: "synth-000003.pdf" });

    expect(validatePrediction(p)).toEqual([]);
    expect(p.extractor).toMatchObject({
      model: "qwen/test",
      model_version: "qwen/test",
      input_mode: "page-images",
      thinking_level: null,
      attempts: 1,
      error: null,
    });
    expect(p.fields.Paciente).toEqual({
      value: "RUIZ ORTEGA, MARIA",
      page: 2,
      bbox: { x0: 0.605, y0: 0.302, x1: 0.704, y1: 0.315 },
    });
    expect(p.tests).toEqual([{ value: "Urea", page: 2, bbox: { x0: 0.096, y0: 0.515, x1: 0.129, y1: 0.526 } }]);

    const request = mockedCall.mock.calls[0][0];
    expect(request.pages).toHaveLength(2);
    expect(request.systemInstruction).toContain("bbox_2d is [xmin, ymin, xmax, ymax]");
    expect(request.systemInstruction).toContain("The JSON object has this JSON Schema:");
  });

  it("needs no API key", async () => {
    mockedCall.mockResolvedValueOnce(reply(qwenJson()));
    const p = await extract(await samplePdf(1), opts);
    expect(p.extractor.error).toBeNull();
  });

  it("retries a reply in the wrong box convention, and reports it if it persists", async () => {
    const geminiStyle = qwenJson().replaceAll("bbox_2d", "box_2d");
    mockedCall.mockResolvedValue(reply(geminiStyle));
    const p = await extract(await samplePdf(1), opts);
    expect(p.extractor.attempts).toBe(2);
    expect(p.extractor.error?.code).toBe("schema_mismatch");
  });

  it("records a server that is down as an API error after its retry", async () => {
    mockedCall.mockRejectedValue(new LocalModelError("local model at http://127.0.0.1:1234/v1: ECONNREFUSED"));
    const p = await extract(await samplePdf(1), opts);
    expect(p.extractor.attempts).toBe(2);
    expect(p.extractor.error?.code).toBe("api_error");
  });
});

describe("local model helpers", () => {
  it("strips a markdown fence around the JSON", () => {
    expect(stripFence('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(stripFence('```\n{"a": 1}```')).toBe('{"a": 1}');
    expect(stripFence('{"a": 1}')).toBe('{"a": 1}');
  });

  it("renders every page to a PNG at 150 dpi", async () => {
    const images = await renderPages(await samplePdf(2));
    expect(images).toHaveLength(2);
    expect([...images[0].slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(pngSize(images[0])).toEqual([1241, 1754]);
  });
});
