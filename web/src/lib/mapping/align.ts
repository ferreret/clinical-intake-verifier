/**
 * Lines as an extractor read them, set against the golden's, for mapping a real run end to end
 * (`map-simulate --fusion`). Each read line gets the codes of the golden line it stands for:
 *
 * - exact: the same text, compared like the harness compares tests (casefold);
 * - misread: no exact match, but close enough to a golden line of the same document not yet
 *   taken (the similarity the OCR boxes use, at least 0.6: one letter wrong in a three-letter
 *   test, "G-GT" for "Γ-GT", scores 0.67);
 * - invented: neither. Its right codes are none: the technician removes the line.
 *
 * Golden lines left over were not read at all: the technician has to add them.
 */
import { matchKey, similarity } from "@/lib/extractor/locate";
import { compareKey } from "@/lib/schema/compare";

export type Reading = "exact" | "misread" | "invented";

export interface GoldenLine {
  value: string;
  codes: string[];
}

export interface ReadLine {
  text: string;
  /** The golden line it stands for; null when invented. */
  golden: string | null;
  truth: string[];
  reading: Reading;
}

const MIN_SIMILARITY = 0.6;

export function alignLines(read: string[], golden: GoldenLine[]): { lines: ReadLine[]; unread: GoldenLine[] } {
  const free = new Set(golden.keys());
  const match: (number | null)[] = read.map(() => null);
  read.forEach((text, i) => {
    const key = compareKey(text, "casefold");
    const j = [...free].find((g) => compareKey(golden[g].value, "casefold") === key);
    if (j !== undefined) {
      match[i] = j;
      free.delete(j);
    }
  });

  // The closest pairs first, so that one misread cannot take another's golden line.
  const pairs: { i: number; j: number; score: number }[] = [];
  read.forEach((text, i) => {
    if (match[i] !== null) return;
    for (const j of free) {
      const score = similarity(matchKey(text), matchKey(golden[j].value));
      if (score >= MIN_SIMILARITY) pairs.push({ i, j, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const misread = new Set<number>();
  for (const { i, j } of pairs) {
    if (match[i] !== null || !free.has(j)) continue;
    match[i] = j;
    free.delete(j);
    misread.add(i);
  }

  const lines = read.map((text, i): ReadLine => {
    const j = match[i];
    if (j === null) return { text, golden: null, truth: [], reading: "invented" };
    return { text, golden: golden[j].value, truth: golden[j].codes, reading: misread.has(i) ? "misread" : "exact" };
  });
  return { lines, unread: [...free].sort((a, b) => a - b).map((j) => golden[j]) };
}
