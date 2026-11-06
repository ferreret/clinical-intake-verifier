import http from "node:http";
import type { AddressInfo } from "node:net";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, extract } from "@/lib/extractor";
import { callLocal } from "@/lib/extractor/local";
import { closeOcr } from "@/lib/extractor/ocr";
import type { OcrDocument } from "@/lib/extractor/ocr-text";
import { sha256Hex } from "@/lib/extractor/pdf";
import { FIELD_NAMES } from "@/lib/schema/fields";
import { validatePrediction } from "@/lib/schema/prediction";

vi.mock("@/lib/extractor/local", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/extractor/local")>();
  return { ...mod, callLocal: vi.fn() };
});
const mockedCall = vi.mocked(callLocal);

/** One A4 page with "Sexo: M" and "Urea" printed, which Tesseract reads in the last test. */
async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("Sexo: M", { x: 60, y: 841.89 * (1 - 0.2), size: 14, font });
  page.drawText("Urea", { x: 60, y: 841.89 * (1 - 0.54), size: 14, font });
  return doc.save();
}

/** Words laid out left to right from (x, y), each 0.01 wide per character. */
function words(x: number, y: number, text: string) {
  return text.split(" ").map((word) => {
    const box = { x0: x, y0: y, x1: x + word.length * 0.01, y1: y + 0.01 };
    x = box.x1 + 0.01;
    return { text: word, box };
  });
}

/** An OCR file of `pdf`: the sex on a line shared with the telephone, far apart, and a test. */
function ocrOf(pdf: Uint8Array): OcrDocument {
  const sex = [...words(0.1, 0.2, "Sexo: M"), ...words(0.6, 0.2, "Teléfono: 919213939")];
  const urea = words(0.1, 0.53, "Urea");
  const box = (ws: { box: { x0: number; y0: number; x1: number; y1: number } }[]) => ({
    x0: ws[0].box.x0,
    y0: Math.min(...ws.map((w) => w.box.y0)),
    x1: ws[ws.length - 1].box.x1,
    y1: Math.max(...ws.map((w) => w.box.y1)),
  });
  return {
    ocr_version: 1,
    engine: "rapidocr",
    model: "test",
    dpi: 300,
    sha256: sha256Hex(pdf),
    elapsed_ms: 1500,
    checkboxes: true,
    pages: [
      {
        number: 1,
        width: 2481,
        height: 3508,
        lines: [
          { id: "p1l1", box: box(sex), text: "Sexo: M Teléfono: 919213939", words: sex, mark: null },
          { id: "p1l2", box: box(urea), text: "Urea", words: urea, mark: "checked" },
        ],
      },
    ],
  };
}

function reply(text: string) {
  return { text, modelVersion: "qwen/test", usage: { input_tokens: 2000, output_tokens: 300, thinking_tokens: 0 } };
}

/** A reply of the text prompt: each value with its page and line. */
function textJson(overrides: Record<string, unknown> = {}): string {
  const fields: Record<string, unknown> = Object.fromEntries(FIELD_NAMES.map((n) => [n, { value: null, page: null, line: null }]));
  fields.Sexo = { value: "M", page: 1, line: 1 };
  fields.Telefono = { value: "919213939", page: 1, line: 1 };
  return JSON.stringify({ fields: { ...fields, ...overrides }, tests: [{ value: "Urea", page: 1, line: 2 }] });
}

const opts = { provider: "local-text" as const, model: "qwen/test", retryDelayMs: 0, ocrServer: null };

beforeEach(() => {
  mockedCall.mockReset();
});

afterAll(closeOcr);

describe("extract with the text pipeline", () => {
  it("sends the OCR's numbered lines, no image, and asks for lines", async () => {
    mockedCall.mockResolvedValueOnce(reply(textJson()));
    const pdf = await samplePdf();
    const p = await extract(pdf, { ...opts, file: "synth-000003.pdf", ocr: ocrOf(pdf) });

    expect(validatePrediction(p)).toEqual([]);
    expect(p.extractor).toMatchObject({
      model: "qwen/test",
      prompt_version: "t2",
      input_mode: "ocr-text",
      thinking_level: null,
      attempts: 1,
      error: null,
    });
    const request = mockedCall.mock.calls[0][0];
    expect(request.pages).toEqual([]);
    expect(request.userMessage).toContain("[p1] L1: Sexo: M Teléfono: 919213939\n[p1] L2: [X] Urea");
    expect(request.systemInstruction).toContain('"line"');
    expect(request.systemInstruction).not.toMatch(/b?box_2d/);
  });

  it("takes each box from its line, tightened to the value, short ones included", async () => {
    mockedCall.mockResolvedValueOnce(reply(textJson()));
    const pdf = await samplePdf();
    const p = await extract(pdf, { ...opts, ocr: ocrOf(pdf) });

    expect(p.fields.Sexo).toEqual({ value: "M", page: 1, bbox: { x0: 0.16, y0: 0.2, x1: 0.17, y1: 0.21 }, box_source: "ocr" });
    expect(p.fields.Telefono).toMatchObject({ page: 1, bbox: { x0: 0.7 }, box_source: "ocr" });
    expect(p.tests).toEqual([{ value: "Urea", page: 1, bbox: { x0: 0.1, y0: 0.53, x1: 0.14, y1: 0.54 }, box_source: "ocr" }]);
  });

  it("counts the time the OCR file records in the latency", async () => {
    mockedCall.mockResolvedValueOnce(reply(textJson()));
    const pdf = await samplePdf();
    const p = await extract(pdf, { ...opts, ocr: ocrOf(pdf) });
    expect(p.extractor.latency_ms).toBeGreaterThanOrEqual(1500);
  });

  it("keeps a value on a line that does not exist, without a box and with a warning", async () => {
    mockedCall.mockResolvedValueOnce(reply(textJson({ NumeroPeticion: { value: "2605150980", page: 1, line: 9 } })));
    const pdf = await samplePdf();
    const p = await extract(pdf, { ...opts, ocr: ocrOf(pdf) });

    expect(p.fields.NumeroPeticion).toEqual({ value: "2605150980", page: 1, bbox: null });
    expect(p.warnings).toContainEqual({ code: "bbox_invalid", field: "NumeroPeticion", detail: "line 9 of page 1" });
    expect(validatePrediction(p)).toEqual([]);
  });

  it("refuses the OCR of another PDF", async () => {
    const pdf = await samplePdf();
    const other = { ...ocrOf(pdf), sha256: "b".repeat(64) };
    await expect(extract(pdf, { ...opts, ocr: other })).rejects.toThrow(ConfigError);
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it("asks the OCR server for the OCR, with its engine, checkboxes and token", async () => {
    mockedCall.mockResolvedValueOnce(reply(textJson()));
    const pdf = await samplePdf();
    const seen: { url?: string; auth?: string; bytes?: number } = {};
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        Object.assign(seen, { url: req.url, auth: req.headers.authorization, bytes: Buffer.concat(chunks).length });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(ocrOf(pdf)));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const p = await extract(pdf, { ...opts, ocrServer: { url, engine: "rapidocr", checkboxes: true, token: "t0k" } });
      expect(seen).toEqual({ url: "/ocr?engine=rapidocr&checkboxes=1", auth: "Bearer t0k", bytes: pdf.length });
      expect(mockedCall.mock.calls[0][0].userMessage).toContain("[p1] L2: [X] Urea");
      expect(p.fields.Sexo).toMatchObject({ value: "M", box_source: "ocr" });
      // The server's time is in the latency as it happened, not added from the file again.
      expect(p.extractor.latency_ms).toBeLessThan(1500);
      expect(validatePrediction(p)).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("records an OCR server that cannot be reached as an API error, and calls no model", async () => {
    const p = await extract(await samplePdf(), {
      ...opts,
      ocrServer: { url: "http://127.0.0.1:9", engine: "rapidocr", checkboxes: false },
    });
    expect(p.extractor.error).toMatchObject({ code: "api_error", message: expect.stringContaining("OCR server at http://127.0.0.1:9") });
    expect(mockedCall).not.toHaveBeenCalled();
    expect(p.tests).toEqual([]);
    expect(validatePrediction(p)).toEqual([]);
  });

  it("reads the pages with Tesseract when no OCR is given", async () => {
    mockedCall.mockResolvedValueOnce(reply(textJson({ Telefono: { value: null, page: null, line: null } })));
    const p = await extract(await samplePdf(), opts);

    const text = mockedCall.mock.calls[0][0].userMessage;
    expect(text).toMatch(/\[p1\] L1: Sexo: M\n\[p1\] L2: Urea/);
    expect(p.fields.Sexo).toMatchObject({ value: "M", page: 1, box_source: "ocr" });
    expect(p.tests[0]).toMatchObject({ value: "Urea", page: 1, box_source: "ocr" });
    expect(p.tests[0].bbox?.y1).toBeCloseTo(0.54, 2);
    expect(validatePrediction(p)).toEqual([]);
  });
});
