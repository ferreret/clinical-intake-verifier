/**
 * The boundary between what the model returned and what the system consumes.
 *
 * Converts boxes, checks pages and patterns, deduplicates tests, and records a warning for
 * everything it had to touch. It never repairs a value: a date that does not match its pattern
 * stays as the model wrote it, flagged, for the fusion engine and the operator to decide. The one
 * rewrite it makes is the `no-title` rule of fields.json, which is mechanical and also flagged.
 */
import { compareKey } from "@/lib/schema/compare";
import { FIELDS, isFieldName, TESTS } from "@/lib/schema/fields";
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

/** Titles in front of a name, possibly several ("Prof. Dr."), with or without the full stop. */
const LEADING_TITLES = /^(?:(?:doctora|doctor|dra|dr|profesora|profesor|profa|prof)(?:\.\s*|\s+))+/i;

/** The `no-title` rule: drops leading titles; a value that is nothing but a title is kept. */
export function stripTitle(value: string): string {
  const stripped = value.replace(LEADING_TITLES, "").trim();
  return stripped === "" ? value : stripped;
}

/** What a value is, for the garbled-text checks: a free-text name, a test name, or anything else. */
export type TextKind = "name" | "test" | "other";

/** Ordinary punctuation next to a letter: "Seguros & Salud", "D'Angelo", "Ruiz-Peña", "(HbA1c)". */
const SYMBOL = String.raw`[^\p{L}\p{N}\s.,'’\-/()+&]`;

/**
 * A lowercase letter standing alone between words, or after a word at the end, other than the
 * one-letter words of Spanish and Catalan (a, e, i, o, u, y). Seen when an accented letter
 * became a space and a wrong letter: "sèrum" as "s crum", "aglutinació" as "aglutinaci c"
 * (2026-10-26). A letter next to a number is left alone: hours ("orina de 24 h") and allergen
 * components ("Pru p 3", "Bet v 1") are written that way.
 */
const STRAY_LETTER = /(?<=\p{L} )[b-df-hj-np-tv-xz](?=$| \p{L})/u;

/**
 * The forms in which the model has been seen to corrupt accented letters, intermittently and
 * across a whole document: a control character ("Est\tevez"), an HTML entity ("Ferr&#225;ndiz"),
 * a symbol in place of a letter ("M!rmol", "Ur%a"), a Cyrillic look-alike ("ТТРА" for TTPA), a
 * space and a wrong letter ("s crum") and, in names, a digit between letters ("P0a"). No golden
 * value contains any of them.
 *
 * Each check has the narrowest scope that catches what was seen. Symbols are checked in text
 * only, not in identifiers. Digits and Greek letters are checked in names only, because test
 * names legitimately have them ("HbA1c", "Vitamina B12", "γ-GT").
 */
const GARBLED: readonly { pattern: RegExp; reason: string; kinds: readonly TextKind[] }[] = [
  { pattern: /\p{Cc}/u, reason: "control character", kinds: ["name", "test", "other"] },
  {
    pattern: /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/iu,
    reason: "HTML entity",
    kinds: ["name", "test", "other"],
  },
  { pattern: /\p{Script=Cyrillic}/u, reason: "Cyrillic letter", kinds: ["name", "test", "other"] },
  {
    pattern: new RegExp(`(?<=\\p{L})${SYMBOL}|${SYMBOL}(?=\\p{L})`, "u"),
    reason: "symbol next to a letter",
    kinds: ["name", "test"],
  },
  {
    pattern: STRAY_LETTER,
    reason: "stray letter",
    kinds: ["name", "test"],
  },
  { pattern: /\p{Script=Greek}/u, reason: "Greek letter", kinds: ["name"] },
  { pattern: /\p{L}\d+\p{L}/u, reason: "digit between letters", kinds: ["name"] },
];

/** The Catalan middle dot between two l's ("pol·len", "Cèl·lules"), which is spelling, not a symbol. */
const CATALAN_L_DOT = /(?<=l)·(?=l)/giu;

/** Why `value` looks like corrupted text, or null. */
export function garbledReason(value: string, kind: TextKind): string | null {
  const text = value.replace(CATALAN_L_DOT, "");
  const hit = GARBLED.find((g) => g.kinds.includes(kind) && g.pattern.test(text));
  return hit ? hit.reason : null;
}

/** How many values of an extraction were flagged as corrupted text. */
export function garbledCount(extraction: NormalisedExtraction): number {
  return extraction.warnings.filter((w) => w.code === "garbled_text").length;
}

function normaliseItem(
  item: RawItem | null | undefined,
  field: string,
  pattern: string | null,
  normalize: string | null,
  kind: TextKind,
  pageCount: number,
  warnings: PredictionWarning[],
): PredictedField | null {
  if (item == null || item.value == null) return null;
  let value = String(item.value).trim();
  if (value === "") {
    warnings.push({ code: "empty_value", field, detail: "empty string treated as null" });
    return null;
  }
  const garbled = garbledReason(value, kind);
  if (garbled) {
    // Flagged, never repaired: guessing which letter was meant would be the model quietly
    // winning. The extractor retries the document instead (see index.ts).
    warnings.push({ code: "garbled_text", field, detail: `${garbled}: ${JSON.stringify(value)}` });
  }
  if (normalize === "no-title") {
    const stripped = stripTitle(value);
    if (stripped !== value) {
      warnings.push({ code: "title_removed", field, detail: value });
      value = stripped;
    }
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
    fields[spec.name] = normaliseItem(
      raw.fields?.[spec.name],
      spec.name,
      spec.pattern,
      spec.normalize,
      spec.compare === "casefold" ? "name" : "other", // casefold: patient, physician, insurer
      pageCount,
      warnings,
    );
  }

  const tests: PredictedField[] = [];
  const seen = new Set<string>();
  for (const item of raw.tests ?? []) {
    const test = normaliseItem(item, "tests", null, null, "test", pageCount, warnings);
    if (test === null) continue;
    const key = compareKey(test.value, TESTS.compare);
    if (seen.has(key)) {
      warnings.push({ code: "duplicate_test", field: "tests", detail: test.value });
      continue;
    }
    seen.add(key);
    tests.push(test);
  }

  return { fields, tests, warnings };
}
