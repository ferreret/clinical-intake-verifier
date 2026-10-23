# Golden sample format

Every synthetic document ships with a sidecar JSON of the same name: `synth-000042.pdf` and
`synth-000042.json`. The JSON is the ground truth ("golden") the evaluation harness compares
extractor output against. Its contract is [`schema/golden.schema.json`](../schema/golden.schema.json);
the list of fields and how each one is compared lives in
[`schema/fields.json`](../schema/fields.json). Both files are shared with the Next.js app.

## Documents are multipage

A real scan rarely contains just the request form. The generator produces a **sequence of
sheets**, in random order, the way they arrive from a scanner:

| role | what it is | fields it carries |
|---|---|---|
| `request` | the main form, one of three templates; long test lists continue on a further `request` page under a compact header | all primary values |
| `authorization` | the insurer's authorisation letter | insurer numbers, patient, physician, often the tests again |
| `id-copy` | photocopy of the insurance card and/or an identity card | card number, name, ID, birth date, sex printed as F/M |
| `consent` | informed-consent form filled in by hand | patient name and ID handwritten, physician |
| `fax-cover` | fax transmittal sheet | request number, plus many distractor numbers |
| `blank` | back side of a duplex scan | none |
| `duplicate` | the request form scanned twice | everything, again |

`pages[]` lists every page with its size and `role`. The request is not always page 1, a
field may have its primary location on any page, and companion sheets repeat values that
already exist. Every sheet belongs to the same patient and request: a companion sheet never
introduces a conflicting value, so the golden stays unambiguous.

## Shape

```json
{
  "golden_version": 3,
  "id": "synth-000042",
  "file": "synth-000042.pdf",
  "sha256": "…",
  "generator": {
    "version": "0.3.0",
    "seed": 42,
    "index": 42,
    "catalog_version": 2,
    "template": "lab-classic",
    "scan": {
      "dpi": 200, "blur": 0.6, "noise": 0.02, "jpeg_quality": 62, "grayscale": true,
      "pages": [{ "number": 1, "rotation_deg": 0.8, "offset_px": [3, -5] }, { "number": 2, "rotation_deg": -0.4, "offset_px": [0, 7] }]
    },
    "handwritten_fields": ["Telefono"]
  },
  "pages": [
    { "number": 1, "width_pt": 595.28, "height_pt": 841.89, "role": "fax-cover" },
    { "number": 2, "width_pt": 595.28, "height_pt": 841.89, "role": "request" }
  ],
  "fields": {
    "Paciente": {
      "value": "RUIZ ORTEGA, MARIA DEL CARMEN",
      "printed": "RUIZ ORTEGA, MARIA DEL CARMEN",
      "page": 2,
      "bbox": { "x0": 0.1234, "y0": 0.2011, "x1": 0.4521, "y1": 0.2150 },
      "style": "printed",
      "also_at": []
    },
    "FechaNacimiento": { "value": "12/03/1978", "printed": "12-mar-1978", "…": "…" },
    "Sexo": { "value": "M", "printed": "[X] Mujer", "…": "…" },
    "NumeroPeticion": {
      "value": "2609081234", "printed": "2609081234", "page": 2, "…": "…",
      "also_at": [
        { "page": 1, "bbox": { "…": "…" }, "printed": "2609081234" },
        { "page": 2, "bbox": { "…": "…" }, "printed": "2609081234" }
      ]
    },
    "Telefono": null
  },
  "tests": [
    { "value": "Hemograma completo", "printed": "Hemograma completo", "page": 2, "bbox": { "…": "…" }, "style": "printed", "also_at": [], "codes": ["HE9359"] },
    { "value": "Iones Na, K, Cl", "printed": "Iones Na, K, Cl", "page": 2, "bbox": { "…": "…" }, "style": "printed", "also_at": [], "codes": ["BQ5212", "BQ1837", "BQ6057"] }
  ],
  "lis": { "scenario": "form_typo", "patient_id": "P00072", "physician_id": "M0043", "insurer_id": "A03", "differs": "FechaNacimiento", "correct": "lis" },
  "context": { "issue_date": "2026-03-14", "center": "Centro Diagnóstico Alborada", "sheets": ["fax-cover", "request"] }
}
```

## Rules

**`value` is what the extractor must return.** It is already normalised per
`schema/fields.json`: `FechaNacimiento` as `dd/mm/yyyy`, `Sexo` as `H`/`M`/`U`,
`NombreMedico` as name and surnames without the title, everything else verbatim. `printed` is
the exact string drawn at the primary location. The two differ only for those three fields;
for `Sexo` drawn as checkboxes, `printed` is `[X] <label>`, and for a titled physician
`printed` keeps the title (`Dra. Pepita Conde Tirado`, value `Pepita Conde Tirado`). The box
always covers what was printed, title included.

**An absent field is `null` at the field level**, exactly the shape the extractor returns for
a field it cannot find. Golden and prediction are compared key by key with no adapters.

**Bounding boxes are normalised to the page, origin top-left**, as `{x0, y0, x1, y1}` floats in
`[0, 1]` rounded to four decimals. Multiply by the rendered size to draw them. The object form
avoids the `[ymin, xmin, ymax, xmax]` ordering pitfall of vision-model output; the extractor
converts at its boundary. `pages[].width_pt/height_pt` recover absolute coordinates. A box
covers the **value only**, never its label. For printed text it is the typographic box
(advance width × ascent/descent); for handwriting it is the ink box measured from the glyphs.

**The primary location is on the request form** whenever the value is printed there: the body
value, not the barcode label, not a companion sheet. When a value appears only on a companion
sheet (an authorisation number that is on the letter but not on the form), that occurrence
becomes the primary one.

**`also_at` lists every further occurrence of the same value**, on any page, each with its
own `printed` form: the request number under a barcode, the patient name on an insurance
card, a birth date printed as `16 11 1944` on an identity card, `F` for a woman on that same
card. The extractor returns the value once; evaluation accepts its box against any location.

**`style`** is `printed` or `handwritten` for the primary location.
`generator.handwritten_fields` lists the fields whose primary is handwritten.

**`tests[]` is a sibling of `fields`**, one entry per distinct requested test, in order of
first appearance, with `also_at` for repeats on authorisation letters or duplicate sheets.
Profile headings that visually group tests are never entries. Pre-printed tests whose box is
not ticked are not entries. Test matching is set-based.

**`codes`** are the lab catalog codes the line means: one for a single test, several for a
profile requested as one line ("Iones Na, K, Cl"). They are the ground truth for test mapping
(F4); the extractor does not return them, and evaluating the extractor ignores them. A
component printed under an expanded profile heading has its own single code.

**Scanned documents.** When `generator.scan` is not `null` the PDF is image-only. Optics
(blur, grain, JPEG, colour) are shared by the whole document; skew and shift are per page,
listed in `scan.pages`. Boxes were transformed through their page's geometry, so they describe
the delivered file. Page sizes are unchanged.

**`context`** carries other printed content that is not a v1 field (issue date, centre,
diagnosis, record number, observations, the sheet sequence). Informational; never evaluated.

## Comparison modes (`schema/fields.json`)

| mode | meaning |
|---|---|
| `exact` | trimmed string equality |
| `casefold` | case-, accent- and whitespace-insensitive |
| `digits` | only the digit sequence is compared |
| `alnum_upper` | only alphanumerics, upper-cased |

The extractor is told to return text exactly as printed; comparison modes keep a difference
in casing or separators from counting as an extraction error.

## Lab catalog and insurer wording

`catalog.json`, written next to `manifest.json`, is the lab's test catalog the codes refer
to: about 730 tests in 13 sections, each with an invented code (section prefix and four
digits), a canonical name, its analyte, synonyms, specimen (and whether it is the analyte's
usual one, which forms often leave unwritten) and variant, plus the lab's
profiles as named lists of codes. It is built by combination (an analyte in several
specimens, an organism with several antibody classes, a culture per sample site), which
produces the near-duplicates that make mapping hard. It is fixed for a catalog version and
does not depend on the seed. Names are generic medical terminology; codes resemble no real
system.

Forms do not print the lab's names. Each insurer has its own **dialect**, derived from the
seed: a style (abbreviations or full names, how the specimen is written or left out,
capitals, truncated words such as "Colest.") and, within it, its own choice of name per
test. Each insurer also names its profiles in its own way and may compose them differently
from the lab, so the same profile name can mean different codes for two insurers.
Documents without an insurer use a generic dialect close to the lab's names.

**Catalan insurers.** Three of the seven fictional insurers print in Catalan, and their
documents are entirely in Catalan: labels, paragraphs, sex (Home/Dona, or H/D in boxes),
month names, ages ("anys") and test names ("Àcid úric", "Urinocultiu", "Pol·len
d'olivera"). The photocopied identity card stays in Spanish, as a state document. The lab
catalog stays in Spanish, so a Catalan line has to be mapped across languages. The golden
values follow the document: test values are the Catalan text as printed, `Sexo` is still
`H`/`M`/`U`. `context.language` records `es` or `ca`. Within one
dialect every printed name is unique, so a line's codes are never ambiguous. Most lines
come from about 80 common tests; 15% come from the rest of the catalog.

## Mock LIS and scenarios

`lis.json`, next to `manifest.json`, holds the lab's own records: about 400 patients (15 pairs
of them share a full name), 60 physicians and the insurers it has an agreement with, all
generated from the seed and independent of which documents are made. One insurer is left
out of it, so its documents carry an insurer the lab does not know. Identifiers are stored
unformatted (`12345678Z`, nine-digit phone and registration numbers) and birth dates as
`dd/mm/yyyy`.

Each document draws its patient and physician from these records and is given a
**scenario**, recorded in its golden `lis` block:

| scenario | share | what the document prints | `differs` | `correct` |
|---|---|---|---|---|
| `match` | 45% | the LIS record, in the form's own formatting | null | null |
| `drift` | 15% | a phone that changed since the record was made | `Telefono` | `document` |
| `form_typo` | 10% | one digit of the ID, or the birth day or year, written wrong | the field | `lis` |
| `new_patient` | 20% | a patient the lab has never seen; `patient_id` is null | null | null |
| `homonym` | 10% | a patient who has a namesake in the LIS, with another birth date and ID | null | null |

`physician_id` is null for the 15% of physicians the LIS does not know; `insurer_id` is null
when the document has no insurer or an unregistered one. A value a scenario is about is
always printed. A form typo in the ID or birth date is never repeated on a photocopied
identity card (no card is drawn then), so sheets never contradict each other. Golden values
are what the document prints, typos included; the LIS record is the other side of the
comparison. Forms print phones as they like, `+34` included, while the LIS keeps nine digits.

## Reproducibility

Document `i` is generated from a seed derived from `(seed, i)`. Regenerating a single index
gives byte-identical PDF and JSON, and `sha256` binds each golden to its PDF. Changing
`--scan-ratio` changes only which documents pass through the scanner simulation, never their
content or page sequence. Reproducibility is tied to the locked dependency versions in
`synth/uv.lock`.

Byte-identical output holds per platform, not across platforms. The same seed generated on
Windows and on Ubuntu gives the same documents (same count, pages and absent fields), but
different PDF bytes, for clean documents as well as scanned ones, so every `sha256` differs
too. The likely cause is image compression (Pillow and zlib builds), not proven. The goldens
stay valid on every platform, because values and boxes come from the generator's layout, not
from the encoded pixels; but a run's predictions can only be scored against goldens generated
on the same platform, since the evaluation checks `sha256` first.

## Visual check

```bash
uv run intake-synth debug-boxes data/synth/seed-42/synth-000003.json
```

writes one `synth-000003-p<N>.boxes.png` per page with primary fields in red, `also_at`
locations in orange and tests in blue.
