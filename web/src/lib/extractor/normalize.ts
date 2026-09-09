/**
 * The boundary between what the model returned and what the system consumes.
 *
 * Converts boxes, checks pages and patterns, deduplicates tests, and records a warning for
 * everything it had to touch. It never repairs a value: a date that does not match its pattern
 * stays as the model wrote it, flagged, for the fusion engine and the operator to decide.
 */
import { FIELDS, isFieldName } from "@/lib/schema/fields";
import type { BBox, PredictedField, PredictionWarning } from "@/lib/schema/prediction";
import type { RawExtraction, RawItem } from "./response-schema";

export interface NormalisedExtraction {
  fields: Record<string, PredictedField | null>;
  tests: PredictedField[];
  warnings: PredictionWarning[];
}

/** Gemini box `[ymin, xmin, ymax, xmax]` on 0-1000 to the golden's `{x0, y0, x1, y1}` on 0-1. */
export function toBBox(box: unknown): BBox | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  if (!box.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [ymin, xmin, ymax, xmax] = (box as number[]).map((n) => Math.min(1000, Math.max(0, n)));
  if (xmax <= xmin || ymax <= ymin) return null;
  const scale = (n: number) => Math.round(n * 10) / 10000;
  return { x0: scale(xmin), y0: scale(ymin), x1: scale(xmax), y1: scale(ymax) };
}

/** Case-, accent- and whitespace-insensitive key, the `casefold` compare mode of fields.json. */
export function foldKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseItem(
  item: RawItem | null | undefined,
  field: string,
  pattern: string | null,
  pageCount: number,
  warnings: PredictionWarning[],
): PredictedField | null {
  if (item == null || item.value == null) return null;
  const value = String(item.value).trim();
  if (value === "") {
    warnings.push({ code: "empty_value", field, detail: "empty string treated as null" });
    return null;
  }

  let page: number | null = null;
  if (item.page != null) {
    if (Number.isInteger(item.page) && item.page >= 1 && item.page <= pageCount) {
      page = item.page;
    } else {
      warnings.push({
        code: "page_out_of_range",
        field,
        detail: `page ${item.page} of ${pageCount}`,
      });
    }
  }

  let bbox: BBox | null = null;
  if (page !== null && item.box_2d != null) {
    bbox = toBBox(item.box_2d);
    if (bbox === null) {
      warnings.push({ code: "bbox_invalid", field, detail: JSON.stringify(item.box_2d) });
    }
  }

  if (pattern !== null && !new RegExp(pattern).test(value)) {
    warnings.push({ code: "pattern_mismatch", field, detail: value });
  }
  return { value, page, bbox };
}

export function normaliseExtraction(raw: RawExtraction, pageCount: number): NormalisedExtraction {
  const warnings: PredictionWarning[] = [];

  for (const key of Object.keys(raw.fields ?? {})) {
    if (!isFieldName(key)) {
      warnings.push({ code: "unexpected_key", field: key, detail: "not a configured field; dropped" });
    }
  }

  const fields: Record<string, PredictedField | null> = {};
  for (const spec of FIELDS) {
    fields[spec.name] = normaliseItem(raw.fields?.[spec.name], spec.name, spec.pattern, pageCount, warnings);
  }

  const tests: PredictedField[] = [];
  const seen = new Set<string>();
  for (const item of raw.tests ?? []) {
    const test = normaliseItem(item, "tests", null, pageCount, warnings);
    if (test === null) continue;
    const key = foldKey(test.value);
    if (seen.has(key)) {
      warnings.push({ code: "duplicate_test", field: "tests", detail: test.value });
      continue;
    }
    seen.add(key);
    tests.push(test);
  }

  return { fields, tests, warnings };
}
