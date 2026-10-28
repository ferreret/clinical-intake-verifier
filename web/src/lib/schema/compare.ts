/**
 * The compare modes of `schema/fields.json`.
 *
 * Mirrors `synth/src/intake_synth/evaluate/compare.py`; both run the cases in
 * `schema/compare-cases.json`, so a change here needs the same change there.
 */
import type { CompareMode } from "./fields";

// toLowerCase on both sides: Python's casefold has no JavaScript counterpart.
const casefold = (v: string): string =>
  v
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const digits = (v: string): string => v.replace(/[^0-9]/g, "");

const KEYS: Record<CompareMode, (value: string) => string> = {
  exact: (v) => v.trim(),
  casefold,
  digits,
  alnum_upper: (v) => v.toUpperCase().replace(/[^0-9A-Z]/g, ""),
  // Forms add the country prefix; the LIS keeps the national number.
  phone: (v) => {
    const d = digits(v);
    if (d.length === 13 && d.startsWith("0034")) return d.slice(4);
    if (d.length === 11 && d.startsWith("34")) return d.slice(2);
    return d;
  },
  // "SURNAMES, NAME" and "Name Surnames" are the same person, and so is "SURNAMES NAME":
  // one order turned round, which is a rotation of its words. The key is the rotation that
  // sorts first. The words are not sorted: "Ana López García" is not "Ana García López".
  person_name: (v) => {
    const words = casefold(v.replace(/,/g, " ")).split(" ").filter(Boolean);
    const rotations = words.map((_, i) => [...words.slice(i), ...words.slice(0, i)].join(" "));
    return rotations.reduce((min, r) => (r < min ? r : min), rotations[0] ?? "");
  },
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
