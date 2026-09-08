# Golden sample format

Every synthetic document ships with a sidecar JSON of the same name: `synth-000042.pdf` and
`synth-000042.json`. The JSON is the ground truth ("golden") the evaluation harness compares
extractor output against. Its contract is [`schema/golden.schema.json`](../schema/golden.schema.json);
the list of fields and how each one is compared lives in
[`schema/fields.json`](../schema/fields.json). Both files are shared with the Next.js app.

## Shape

```json
{
  "golden_version": 1,
  "id": "synth-000042",
  "file": "synth-000042.pdf",
  "sha256": "…",
  "generator": {
    "version": "0.1.0",
    "seed": 42,
    "index": 42,
    "template": "lab-classic",
    "scan": { "dpi": 200, "rotation_deg": 0.8, "blur": 0.6, "noise": 0.02, "jpeg_quality": 62, "grayscale": true },
    "handwritten_fields": ["Telefono"]
  },
  "pages": [{ "number": 1, "width_pt": 595.28, "height_pt": 841.89 }],
  "fields": {
    "Paciente": {
      "value": "RUIZ ORTEGA, MARIA DEL CARMEN",
      "printed": "RUIZ ORTEGA, MARIA DEL CARMEN",
      "page": 1,
      "bbox": { "x0": 0.1234, "y0": 0.2011, "x1": 0.4521, "y1": 0.2150 },
      "style": "printed",
      "also_at": []
    },
    "FechaNacimiento": { "value": "12/03/1978", "printed": "12-mar-1978", "…": "…" },
    "Sexo": { "value": "M", "printed": "[X] Mujer", "…": "…" },
    "NumeroPeticion": { "value": "2609081234", "…": "…", "also_at": [{ "page": 1, "bbox": { "…": "…" } }] },
    "Telefono": null
  },
  "tests": [
    { "value": "Hemograma completo", "printed": "Hemograma completo", "page": 1, "bbox": { "…": "…" }, "style": "printed" }
  ],
  "context": { "issue_date": "2026-03-14", "center": "Centro Diagnóstico Alborada", "diagnosis": "Revisión anual" }
}
```

## Rules

**`value` is what the extractor must return.** It is already normalised per
`schema/fields.json`: `FechaNacimiento` as `dd/mm/yyyy`, `Sexo` as `H`/`M`/`U`, everything
else verbatim. `printed` is the exact string drawn on the page. The two differ only for those
two fields; for `Sexo` drawn as checkboxes, `printed` is `[X] <label>`.

**An absent field is `null` at the field level**, exactly the shape the extractor returns for
a field it cannot find. Golden and prediction are compared key by key with no adapters.

**Bounding boxes are normalised to the page, origin top-left**, as `{x0, y0, x1, y1}` floats in
`[0, 1]` rounded to four decimals. Multiply by the rendered size to draw them. The object form
avoids the `[ymin, xmin, ymax, xmax]` ordering pitfall of vision-model output; the extractor
converts at its boundary. `pages[].width_pt/height_pt` recover absolute coordinates. A box
covers the **value only**, never its label. For printed text it is the typographic box
(advance width × ascent/descent); for handwriting it is the ink box measured from the glyphs.

**`also_at` lists further occurrences of the same value** (the request number under the
barcode, for instance). The extractor returns the value once; evaluation accepts its box
against any location.

**`style`** is `printed` or `handwritten`, so metrics can be split by writing type.

**`tests[]` is a sibling of `fields`**, one entry per requested test, in reading order.
Profile headings that visually group tests are never entries. Pre-printed tests whose box is
not ticked are not entries. Test matching is set-based.

**Scanned documents.** When `generator.scan` is not `null` the PDF is image-only. Boxes were
transformed through the same rotation and shift applied to the raster, so they describe the
delivered file. Page size is unchanged.

**`context`** carries other printed content that is not a v1 field (issue date, centre,
diagnosis, record number, observations). Informational; never evaluated.

## Comparison modes (`schema/fields.json`)

| mode | meaning |
|---|---|
| `exact` | trimmed string equality |
| `casefold` | case-, accent- and whitespace-insensitive |
| `digits` | only the digit sequence is compared |
| `alnum_upper` | only alphanumerics, upper-cased |

The extractor is told to return text exactly as printed; comparison modes keep a difference
in casing or separators from counting as an extraction error.

## Reproducibility

Document `i` is generated from a seed derived from `(seed, i)`. Regenerating a single index
gives byte-identical PDF and JSON, and `sha256` binds each golden to its PDF. Changing
`--scan-ratio` changes only which documents pass through the scanner simulation, never their
content. Reproducibility is tied to the locked dependency versions in `synth/uv.lock`.

## Visual check

```bash
uv run intake-synth debug-boxes data/synth/seed-42/synth-000003.json
```

writes `synth-000003-p1.boxes.png` with fields in red, `also_at` in orange and tests in blue.
