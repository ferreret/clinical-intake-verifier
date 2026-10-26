/**
 * The instruction given to the model, generated from `schema/fields.json`.
 *
 * Bump PROMPT_VERSION whenever the wording here or the layer-1 schema changes: predictions
 * record it, and the harness only compares runs made with the same version.
 */
import { FIELDS, TESTS, type FieldSpec } from "@/lib/schema/fields";
import { GEMINI_BOXES, type BoxConvention } from "./response-schema";

export const PROMPT_VERSION = "5";

/** How each `normalize` rule in fields.json is explained to the model. */
const NORMALISATION_TEXT: Record<string, string> = {
  "dd/mm/yyyy":
    "Normalise to dd/mm/yyyy whatever the printed format and language (12-mar-1978, " +
    "12-març-1978, 12.3.78 and 1978-03-12 all become 12/03/1978).",
  "H|M|U":
    "Normalise to H (male), M (female) or U (unknown or other). Printed forms vary, in Spanish " +
    "or Catalan: Hombre, Home, Varón, Masculino, Masculí, V and H mean male; Mujer, Dona, " +
    "Femenino, Femení, F and D mean female. A bare M depends " +
    "on the sheet it is printed on: on the request form and its companion sheets it means " +
    "female (male is written H or V there); on a photocopied identity card, which prints a " +
    "single letter, M means male (masculino) and F female. U only when the document marks the " +
    "sex as unknown or other; when no sex is printed or marked anywhere, the value is null.",
  "no-title":
    "Drop any title or honorific in front of the name (Dr., Dra., Doctor, Doctora, Prof.) and " +
    "return only the name and surnames, otherwise exactly as printed. The box still covers the " +
    "whole printed name, title included.",
};

function describeField(f: FieldSpec): string {
  const rule = f.normalize ? NORMALISATION_TEXT[f.normalize] : undefined;
  if (f.normalize && !rule) {
    throw new Error(`no prompt text for normalisation rule "${f.normalize}" of ${f.name}`);
  }
  return `- ${f.name}: ${f.description}${rule ? ` ${rule}` : ""}`;
}

/** The instruction, with boxes asked for in `boxes`' convention; Gemini's by default. */
export function buildSystemInstruction(boxes: BoxConvention = GEMINI_BOXES): string {
  const fieldLines = FIELDS.map(describeField).join("\n");
  return `You extract structured data from a scanned clinical laboratory request (a "volante"), printed in Spanish or Catalan, so that an operator can verify it. Your output is not the source of truth: it will be checked against the laboratory's own records and a person decides. Be exact, and prefer null over a guess.

The document may have several pages in any order: the request form itself (sometimes continued on a further page), the insurer's authorisation letter, photocopies of an insurance card or an identity document, an informed-consent form, a fax cover sheet, blank pages, or the same form scanned twice. All pages belong to one patient and one request.

Return only a JSON object that matches the response schema. No prose, no markdown.

Fields (object "fields", one entry per name):
${fieldLines}

Requested tests (array "tests"): ${TESTS.description}

Rules:
1. Text exactly as printed: keep casing, accents, separators and spacing. Do not correct, expand, translate or reformat anything, except the fields with an explicit normalisation rule above. Catalan stays Catalan: a test printed as "Àcid úric" or "Pol·len d'olivera" is returned exactly so, middle dot and apostrophe included.
2. If a field is not clearly printed, return null for its value, page and ${boxes.key}. Never infer a value from another field (do not compute Edad from FechaNacimiento, do not derive Sexo from the name) and never invent one.
3. Prefer the value printed on the request form. If it appears only on a companion sheet (an authorisation letter, a card), take it from there. Return each field once even when the same value appears on several pages. NumeroPeticion in particular is often printed twice, in the body and under a barcode: return it once, from the body.
4. page is the 1-based page the returned value was read from. ${boxes.key} is ${boxes.order} on a 0-1000 scale relative to that page, tight around the value only, never including its label.
5. tests: one entry per requested test, in order of first appearance, each with its own page and ${boxes.key}. Never merge several tests because they share a box, a border, a table row or a profile heading, and never split one test into several. Profile or group headings are not tests. Pre-printed tests whose checkbox is not ticked are not requested. If the same tests are repeated on another sheet, list them once.
6. Ignore distractors: record numbers (NHC), fax numbers, issue dates, centre addresses and phone numbers, and the physician's details when the field asks for the patient's.`;
}

export const USER_MESSAGE = "Extract the fields and the requested tests from this document.";
