/**
 * The instruction of the text pipeline (provider `local-text`): the model is given the lines an
 * OCR read, not the pages, and answers with the line each value is on instead of a box.
 *
 * The field list and its normalisation rules are prompt.ts's, so that both pipelines ask for
 * the same values; rules 1 to 6 are the same rules, worded for lines. Bump PROMPT_VERSION_TEXT
 * whenever the wording here changes. It is a version of its own, with a `t`, because the
 * harness only compares like with like.
 *
 * t2 (2026-11-06), from the 200-document runs of t1: a list bullet in front of a test is not
 * part of it (the OCR text shows it, and t1 kept "- CT" on 28 tests of 3 documents), and the
 * reply is written on one line, since Qwen indented it and output tokens are most of the time
 * on this machine (about 25 per second; Gemma, which writes it compact, used half as many).
 */
import { FIELDS, TESTS } from "@/lib/schema/fields";
import { describeField } from "./prompt";

export const PROMPT_VERSION_TEXT = "t2";

export function buildTextInstruction(): string {
  const fieldLines = FIELDS.map((f) => describeField(f, false)).join("\n");
  return `You extract structured data from a scanned clinical laboratory request (a "volante"), printed in Spanish or Catalan, so that an operator can verify it. Your output is not the source of truth: it will be checked against the laboratory's own records and a person decides. Be exact, and prefer null over a guess.

You do not see the pages. You are given the text an OCR read from them: one line of input per line of print, in reading order, written as [pN] Lk: text, where N is the page and k the number of the line on that page. The OCR may put text from two columns on one line, split or join words, misread a character, or leave stray characters from borders, lines and marks on the page; those stray characters are not part of any value. When the OCR detected a checkbox in front of a line, the line starts with [X] if it is ticked and [ ] if it is empty; checkboxes it did not detect may be missing from the text or show as stray characters.

The document may have several pages in any order: the request form itself (sometimes continued on a further page), the insurer's authorisation letter, photocopies of an insurance card or an identity document, an informed-consent form, a fax cover sheet, blank pages, or the same form scanned twice. All pages belong to one patient and one request.

Return only a JSON object that matches the response schema. No prose, no markdown. Write it on one line, with no indentation and no line breaks.

Fields (object "fields", one entry per name):
${fieldLines}

Requested tests (array "tests"): ${TESTS.description}

Rules:
1. Text exactly as printed: keep casing, accents, separators and spacing. Do not correct, expand, translate or reformat anything, except the fields with an explicit normalisation rule above. Catalan stays Catalan: a test printed as "Àcid úric" or "Pol·len d'olivera" is returned exactly so, middle dot and apostrophe included.
2. If a field is not clearly printed, return null for its value, page and line. Never infer a value from another field (do not compute Edad from FechaNacimiento, do not derive Sexo from the name) and never invent one.
3. Prefer the value printed on the request form. If it appears only on a companion sheet (an authorisation letter, a card), take it from there. Return each field once even when the same value appears on several pages. NumeroPeticion in particular is often printed twice, in the body and under a barcode: return it once, from the body.
4. page is the 1-based page N the returned value was read from, and line the number k of the line it is on, both as written in front of it ([pN] Lk). When a value runs over two lines, give the first.
5. tests: one entry per requested test, in order of first appearance, each with its own page and line. Never merge several tests because they share a box, a border, a table row, a line of the text or a profile heading, and never split one test into several. Profile or group headings are not tests. A list bullet or dash in front of a test ("- ", "• ") is not part of it. Pre-printed tests whose checkbox is not ticked are not requested. If the same tests are repeated on another sheet, list them once.
6. Ignore distractors: record numbers (NHC), fax numbers, issue dates, centre addresses and phone numbers, and the physician's details when the field asks for the patient's.`;
}

export const TEXT_USER_MESSAGE = "Extract the fields and the requested tests from this document. Its pages, as the OCR read them:";
