/**
 * The prediction a flawless extractor would return for a golden: the fusion engine measured
 * on its own, with no reading error in the way and no API call.
 */
import type { BBox, Prediction } from "@/lib/schema/prediction";

interface GoldenItem {
  value: string;
  page: number;
  bbox: BBox;
}

/** The parts of a golden (schema/golden.schema.json) a perfect prediction is made from. */
export interface GoldenLike {
  id: string;
  file: string;
  sha256: string;
  pages: { number: number; width_pt: number; height_pt: number }[];
  fields: Record<string, GoldenItem | null>;
  tests: GoldenItem[];
}

export function perfectPrediction(golden: GoldenLike): Prediction {
  const item = (v: GoldenItem) => ({ value: v.value, page: v.page, bbox: v.bbox });
  return {
    prediction_version: 1,
    id: golden.id,
    file: golden.file,
    sha256: golden.sha256,
    extractor: {
      model: "golden",
      model_version: null,
      prompt_version: "golden",
      input_mode: "pdf-inline",
      temperature: 0,
      thinking_level: null,
      attempts: 1,
      latency_ms: 0,
      usage: { input_tokens: null, output_tokens: null, thinking_tokens: null },
      created_at: new Date(0).toISOString(),
      error: null,
    },
    pages: golden.pages.map((p) => ({ number: p.number, width_pt: p.width_pt, height_pt: p.height_pt })),
    fields: Object.fromEntries(Object.entries(golden.fields).map(([k, v]) => [k, v ? item(v) : null])),
    tests: golden.tests.map(item),
    warnings: [],
  };
}
