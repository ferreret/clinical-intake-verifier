/**
 * The compare modes of `schema/fields.json`.
 *
 * Mirrors `synth/src/intake_synth/evaluate/compare.py`; both run the cases in
 * `schema/compare-cases.json`, so a change here needs the same change there.
 */
import type { CompareMode } from "./fields";

const KEYS: Record<CompareMode, (value: string) => string> = {
  exact: (v) => v.trim(),
  // toLowerCase on both sides: Python's casefold has no JavaScript counterpart.
  casefold: (v) =>
    v
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim(),
  digits: (v) => v.replace(/[^0-9]/g, ""),
  alnum_upper: (v) => v.toUpperCase().replace(/[^0-9A-Z]/g, ""),
};

export const COMPARE_MODES: readonly CompareMode[] = Object.freeze(
  Object.keys(KEYS) as CompareMode[],
);

/** The form of `value` that two values are compared on under `mode`. */
export function compareKey(value: string, mode: CompareMode): string {
  const key = KEYS[mode];
  if (!key) throw new Error(`unknown compare mode "${mode}"`);
  return key(value);
}

/**
 * Whether two non-null values match under `mode`. A value that normalises to nothing (no
 * digits under `digits`, say) only matches one that is identical after trimming: otherwise
 * "sí" and "no" would be equal as digit sequences.
 */
export function valuesMatch(a: string, b: string, mode: CompareMode): boolean {
  const ka = compareKey(a, mode);
  const kb = compareKey(b, mode);
  if (ka === "" || kb === "") return a.trim() === b.trim();
  return ka === kb;
}
