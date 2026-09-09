# Extractor contract

The extractor turns one PDF into one **prediction**: a JSON document whose field keys are the
same as the golden sample's, so the evaluation harness compares the two key by key with no
adapters. The contract is [`schema/prediction.schema.json`](../schema/prediction.schema.json).
Field names, types, patterns and comparison modes come from
[`schema/fields.json`](../schema/fields.json), the single source of truth shared with the Python
package; the prompt and the model-facing schema are generated from it at runtime and never
list a field by hand.

## Two layers

What the model is asked to return and what the rest of the system consumes are deliberately
different shapes. The first is tuned to what a vision model does well; the second is what the
harness, the fusion engine and the UI depend on. A thin boundary converts one into the other,
and that boundary is where the project's stance lives: the model output is validated and
annotated, never silently repaired.

### Layer 1: what Gemini is asked for

Flat, in the model's native conventions. `box_2d` is `[ymin, xmin, ymax, xmax]` on a 0–1000
scale relative to the page the value was read from, which is how Gemini is trained to report
boxes. Pages are numbered from 1 in document order.

```json
{
  "fields": {
    "Paciente":  { "value": "RUIZ ORTEGA, MARIA DEL CARMEN", "page": 3, "box_2d": [302, 605, 315, 704] },
    "Telefono":  { "value": null, "page": null, "box_2d": null }
  },
  "tests": [
    { "value": "Urea", "page": 3, "box_2d": [515, 96, 526, 129] }
  ]
}
```

The instruction given with it carries the extraction rules inherited from the pilot: JSON
only; `null` when a field is not clearly present, never a guess; text exactly as printed except
the fields with a `normalize` rule in `fields.json` (date of birth as `dd/mm/yyyy`, sex as
`H`/`M`/`U`); one entry per requested test, never merged by visual grouping; a request number
printed more than once returned once. The prompt is versioned (`prompt_version`) and every
prediction records the version that produced it.

### Layer 2: the prediction

What the API returns, what batch runs persist, what the harness reads and what the fusion
engine takes as the "AI said" source. It mirrors the golden: same `fields` keys, same `bbox`
object, same `tests` sibling.

```json
{
  "prediction_version": 1,
  "id": "synth-000003",
  "file": "synth-000003.pdf",
  "sha256": "…",
  "extractor": {
    "model": "gemini-3.8-flash",
    "model_version": "gemini-3.8-flash-001",
    "prompt_version": "1",
    "input_mode": "pdf-inline",
    "temperature": 0,
    "thinking_level": "minimal",
    "attempts": 1,
    "latency_ms": 4312,
    "usage": { "input_tokens": 1180, "output_tokens": 640, "thinking_tokens": 0 },
    "created_at": "2026-09-09T10:22:11.000Z",
    "error": null
  },
  "pages": [
    { "number": 1, "width_pt": 595.28, "height_pt": 841.89 },
    { "number": 2, "width_pt": 595.28, "height_pt": 841.89 },
    { "number": 3, "width_pt": 595.28, "height_pt": 841.89 }
  ],
  "fields": {
    "Paciente": {
      "value": "RUIZ ORTEGA, MARIA DEL CARMEN",
      "page": 3,
      "bbox": { "x0": 0.605, "y0": 0.302, "x1": 0.704, "y1": 0.315 }
    },
    "Telefono": null
  },
  "tests": [
    { "value": "Urea", "page": 3, "bbox": { "x0": 0.096, "y0": 0.515, "x1": 0.129, "y1": 0.526 } }
  ],
  "warnings": [
    { "code": "pattern_mismatch", "field": "FechaNacimiento", "detail": "1978-03-12" }
  ]
}
```

Compared with a golden field, a predicted field has `value`, `page` and `bbox` and nothing
else: `printed`, `style` and `also_at` are things the extractor cannot know and that are never
evaluated. `bbox` is nullable here although it is mandatory in the golden, because a value read
without a usable box is still a value. An absent field is `null` at the field level, exactly as
in the golden.

`pages` comes from the PDF itself, not from the model.

## The boundary

| Model output | What the boundary does |
|---|---|
| `box_2d` | Converted to `{x0, y0, x1, y1}` normalised to `[0, 1]`, origin top-left, four decimals, clamped to the page. |
| Degenerate box (zero or negative extent after clamping) | `bbox: null`, value kept, warning `bbox_invalid`. |
| `page` outside `1..pages.length` | `page: null` and `bbox: null`, value kept, warning `page_out_of_range`. |
| Value that fails the field's `pattern` in `fields.json` | **Kept as is**, warning `pattern_mismatch`. Correcting it silently, or discarding it, would be the model quietly winning. The fusion engine and the operator decide. |
| Empty or whitespace-only value | Treated as `null`, warning `empty_value`. |
| Test repeated (case-, accent- and whitespace-insensitive) | First occurrence kept, warning `duplicate_test`. |
| Key that is not a configured field | Dropped, warning `unexpected_key`. |
| Response that is not JSON, or JSON that does not match the layer-1 schema | One retry. If the retry fails too, a prediction is still produced: every field `null`, `tests` empty, `extractor.error` set. |

Warnings are part of the contract. Their codes are an enum in the schema so that consumers
can count them; the harness reports them separately from extraction errors.

## Failures

A prediction always exists for every document that was attempted, so a batch run is complete
even when some calls failed. `extractor.error` is `null` on success; otherwise it carries one
of:

| code | meaning |
|---|---|
| `api_error` | the request to Gemini failed (network, quota, server error, timeout) |
| `invalid_json` | the model returned something that does not parse as JSON |
| `schema_mismatch` | the JSON does not match the layer-1 schema |

A failed prediction scores as all-missing in evaluation and is counted as a failure, not as an
extraction error.

## Input mode and model

Version 1 sends the whole PDF inline as `application/pdf` and asks for a page number per
value. There is no server-side rendering; Gemini rasterises the pages and runs OCR on scanned
ones. Every prediction records `input_mode` so that a later mode (pages rendered to images,
one part per page) can be added and **measured** by the harness rather than argued about.

The model id comes from `GEMINI_MODEL` (default: the current Flash). Generation is
deterministic within the limits of the API: `temperature: 0`, JSON mode with the layer-1 schema
as `responseJsonSchema`, minimal thinking.

## Batch runs

```
data/runs/<run-id>/
  run.json                  what was run, on what, with what, and the totals
  synth-000000.pred.json    one prediction per PDF, named after the document id
  synth-000001.pred.json
  …
```

`run-id` defaults to `<timestamp>-<model>-p<prompt_version>`. The runner reads **only the
PDFs** of the input directory: golden files are never opened by anything on the extraction
side. Documents already predicted in the same run directory with the same model and prompt
version and no error are skipped, so repeating a run after a prompt change costs only the
documents that changed. `data/` is git-ignored; a run is an experiment, not a source.

`run.json`:

```json
{
  "run_id": "20260909-102211-gemini-3.8-flash-p1",
  "source": "data/synth/seed-42",
  "model": "gemini-3.8-flash",
  "prompt_version": "1",
  "input_mode": "pdf-inline",
  "temperature": 0,
  "started_at": "2026-09-09T10:22:11.000Z",
  "finished_at": "2026-09-09T10:31:02.000Z",
  "documents": [
    { "id": "synth-000000", "prediction": "synth-000000.pred.json", "ok": true, "latency_ms": 4312, "input_tokens": 1180, "output_tokens": 640, "warnings": 1 }
  ],
  "totals": { "documents": 200, "failed": 0, "input_tokens": 236000, "output_tokens": 128000, "latency_ms": 862400 }
}
```

## Versioning

`prediction_version` changes when the prediction shape changes. `prompt_version` changes when
the instruction text or the layer-1 schema changes, so that two runs are only compared when
they were produced the same way. `golden_version` and `prediction_version` are independent;
the harness checks both.

## Visual check

```bash
cd synth
uv run intake-synth debug-boxes ../data/synth/seed-42/synth-000003.json --prediction ../data/runs/<run-id>/synth-000003.pred.json
```

paints golden boxes (red, orange, blue) and predicted boxes (green for fields, purple for
tests) on the same page images.
