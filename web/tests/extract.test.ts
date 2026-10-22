import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, extract, idFromFileName, InvalidPdfError } from "@/lib/extractor";
import { callGemini, GeminiApiError } from "@/lib/extractor/gemini";
import { FIELD_NAMES } from "@/lib/schema/fields";
import { validatePrediction } from "@/lib/schema/prediction";

vi.mock("@/lib/extractor/gemini", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/extractor/gemini")>();
  return { ...mod, callGemini: vi.fn() };
});
const mockedCall = vi.mocked(callGemini);

async function samplePdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([595.28, 841.89]);
  return doc.save();
}

function reply(text: string) {
  return {
    text,
    modelVersion: "test-model-001",
    usage: { input_tokens: 100, output_tokens: 50, thinking_tokens: 0 },
  };
}

function goodJson(): string {
  const fields: Record<string, unknown> = Object.fromEntries(
    FIELD_NAMES.map((n) => [n, { value: null, page: null, box_2d: null }]),
  );
  fields.Paciente = { value: "RUIZ ORTEGA, MARIA", page: 3, box_2d: [302, 605, 315, 704] };
  fields.NumeroPeticion = { value: "2026/564697", page: 3, box_2d: [302, 605, 314, 704] };
  return JSON.stringify({ fields, tests: [{ value: "Urea", page: 3, box_2d: [515, 96, 526, 129] }] });
}

const opts = { apiKey: "test-key", model: "test-model", retryDelayMs: 0, thinkingLevel: "low" };

beforeEach(() => {
  mockedCall.mockReset();
});

describe("extract", () => {
  it("produces a prediction that matches schema/prediction.schema.json", async () => {
    mockedCall.mockResolvedValueOnce(reply(goodJson()));
    const p = await extract(await samplePdf(), { ...opts, file: "synth-000003.pdf" });

    expect(validatePrediction(p)).toEqual([]);
    expect(p.id).toBe("synth-000003");
    expect(p.file).toBe("synth-000003.pdf");
    expect(p.pages).toHaveLength(3);
    expect(p.pages[0]).toEqual({ number: 1, width_pt: 595.28, height_pt: 841.89 });
    expect(p.extractor).toMatchObject({
      model: "test-model",
      model_version: "test-model-001",
      prompt_version: expect.any(String),
      input_mode: "pdf-inline",
      temperature: 0,
      thinking_level: "low",
      attempts: 1,
      error: null,
    });
    expect(p.extractor.usage).toEqual({ input_tokens: 100, output_tokens: 50, thinking_tokens: 0 });
    expect(p.fields.Paciente).toEqual({
      value: "RUIZ ORTEGA, MARIA",
      page: 3,
      bbox: { x0: 0.605, y0: 0.302, x1: 0.704, y1: 0.315 },
    });
    expect(p.fields.Telefono).toBeNull();
    expect(p.tests).toEqual([{ value: "Urea", page: 3, bbox: { x0: 0.096, y0: 0.515, x1: 0.129, y1: 0.526 } }]);

    const request = mockedCall.mock.calls[0][0];
    expect(request.model).toBe("test-model");
    expect(request.pdf.length).toBeGreaterThan(0);
    expect(request.responseSchema).toHaveProperty("properties.fields");
    expect(request.systemInstruction).toContain("Paciente");
  });

  it("retries once when the model output is not JSON, then succeeds", async () => {
    mockedCall.mockResolvedValueOnce(reply("not json")).mockResolvedValueOnce(reply(goodJson()));
    const p = await extract(await samplePdf(), opts);
    expect(p.extractor.attempts).toBe(2);
    expect(p.extractor.error).toBeNull();
    expect(p.extractor.usage.input_tokens).toBe(200);
  });

  it("still returns a schema-valid prediction when both attempts fail", async () => {
    mockedCall.mockResolvedValue(reply(JSON.stringify({ fields: {}, tests: "nope" })));
    const p = await extract(await samplePdf(), opts);
    expect(validatePrediction(p)).toEqual([]);
    expect(p.extractor.attempts).toBe(2);
    expect(p.extractor.error?.code).toBe("schema_mismatch");
    expect(Object.keys(p.fields)).toEqual([...FIELD_NAMES]);
    expect(Object.values(p.fields).every((f) => f === null)).toBe(true);
    expect(p.tests).toEqual([]);
  });

  it("does not retry client errors from the API", async () => {
    mockedCall.mockRejectedValueOnce(new GeminiApiError("bad request", 400));
    const p = await extract(await samplePdf(), opts);
    expect(p.extractor.attempts).toBe(1);
    expect(p.extractor.error).toEqual({ code: "api_error", message: "bad request" });
  });

  it("retries quota and server errors", async () => {
    mockedCall.mockRejectedValueOnce(new GeminiApiError("quota", 429)).mockResolvedValueOnce(reply(goodJson()));
    const p = await extract(await samplePdf(), opts);
    expect(p.extractor.attempts).toBe(2);
    expect(p.extractor.error).toBeNull();
  });

  it("fails fast without an API key or with a non-PDF", async () => {
    await expect(extract(await samplePdf(), { ...opts, apiKey: "" })).rejects.toBeInstanceOf(ConfigError);
    await expect(extract(new Uint8Array([1, 2, 3, 4, 5]), opts)).rejects.toBeInstanceOf(InvalidPdfError);
    expect(mockedCall).not.toHaveBeenCalled();
  });
});

describe("idFromFileName", () => {
  it("slugs the file stem and falls back when nothing usable remains", () => {
    expect(idFromFileName("synth-000003.pdf", "x")).toBe("synth-000003");
    expect(idFromFileName("Volante Ñandú (1).PDF", "x")).toBe("volante-nandu-1");
    expect(idFromFileName("---.pdf", "abc")).toBe("abc");
  });
});
