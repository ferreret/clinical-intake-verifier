/**
 * The prediction: what the extractor returns for one document.
 *
 * Contract: `schema/prediction.schema.json` (see docs/extractor-contract.md). The types here
 * mirror that schema; `validatePrediction` checks a document against it with the same JSON
 * Schema the Python harness uses.
 */
import Ajv2020 from "ajv/dist/2020";
import predictionSchema from "../../../../schema/prediction.schema.json";

export const PREDICTION_VERSION = 1 as const;
export const INPUT_MODES = ["pdf-inline", "page-images"] as const;
export type InputMode = (typeof INPUT_MODES)[number];

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type BoxSource = "model" | "ocr";

export interface PredictedField {
  value: string;
  page: number | null;
  bbox: BBox | null;
  /** Where bbox came from; absent when bbox is null and in predictions made before OCR boxes. */
  box_source?: BoxSource;
}

export type WarningCode =
  | "bbox_invalid"
  | "page_out_of_range"
  | "pattern_mismatch"
  | "empty_value"
  | "duplicate_test"
  | "unexpected_key"
  | "title_removed"
  /** Superseded by garbled_text; still found in predictions made before it existed. */
  | "control_character"
  | "garbled_text"
  | "retried_garbled_text"
  /** The OCR for the boxes failed; the model's boxes were kept. */
  | "ocr_failed";

export interface PredictionWarning {
  code: WarningCode;
  /** Field name, "tests" for the test list, or null. */
  field: string | null;
  detail: string;
}

export type ExtractorErrorCode = "api_error" | "invalid_json" | "schema_mismatch";

export interface ExtractorError {
  code: ExtractorErrorCode;
  message: string;
}

export interface Usage {
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
}

export interface ExtractorInfo {
  model: string;
  model_version: string | null;
  prompt_version: string;
  input_mode: InputMode;
  temperature: number;
  thinking_level: string | null;
  attempts: number;
  latency_ms: number;
  usage: Usage;
  created_at: string;
  error: ExtractorError | null;
}

export interface PageInfo {
  number: number;
  width_pt: number;
  height_pt: number;
}

export interface Prediction {
  prediction_version: typeof PREDICTION_VERSION;
  id: string;
  file: string;
  sha256: string;
  extractor: ExtractorInfo;
  pages: PageInfo[];
  fields: Record<string, PredictedField | null>;
  tests: PredictedField[];
  warnings: PredictionWarning[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validateFn = ajv.compile(predictionSchema);

/** Human-readable validation errors against schema/prediction.schema.json; empty when valid. */
export function validatePrediction(doc: unknown): string[] {
  if (validateFn(doc)) return [];
  return (validateFn.errors ?? []).map(
    (e) => `${e.instancePath || "<root>"}: ${e.message ?? "invalid"}`,
  );
}

export function assertPrediction(doc: unknown): asserts doc is Prediction {
  const errors = validatePrediction(doc);
  if (errors.length > 0) {
    throw new Error(`prediction does not match schema/prediction.schema.json:\n${errors.join("\n")}`);
  }
}
