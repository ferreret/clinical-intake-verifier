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
`H`/`M`/`U`, the physician's name and surnames without any title); one entry per requested test, never merged by visual grouping; a request number
printed more than once returned once. The prompt is versioned (`prompt_version`) and every
prediction records the version that produced it.

#### Another model's conventions

A model family trained on another box convention is asked in its own, and its reply is
rewritten in layer 1's before validation; nothing downstream knows which model answered. The
local vision model (Qwen, see "Input mode and model") is asked for `bbox_2d` as
`[xmin, ymin, xmax, ymax]` on the same 0–1000 scale: asked for Gemini's convention, it kept the
order but invented the vertical positions. The instruction is the same text with only the box
key and order changed, so it keeps the same `prompt_version`. The rewrite does three things
and nothing else:

- `bbox_2d` becomes `box_2d`, with the four numbers in Gemini's order;
- an item with a box under any other key loses it, so that the reply fails validation and is
  retried: the order of such a box cannot be known;
- a field written as a bare `null`, which is how this model says "not present" when its
  output is not constrained, becomes the item of three nulls that means the same.

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
    "thinking_level": "low",
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
| Title left in front of a name whose field has the `no-title` rule (`Dr.`, `Dra.`, `Doctor`, `Doctora`, `Prof.`, with or without the full stop) | Removed, warning `title_removed` with the value as returned. The only rewrite the boundary makes: the rule is mechanical, and the warning shows how often the model ignores it. The box is kept as returned. |
| Garbled text: in any value, a control character, an HTML entity or a Cyrillic letter; in names and tests, a symbol other than ordinary punctuation (`. , ' - / ( ) + &`) next to a letter; in the free-text fields compared with `casefold` (patient, physician, insurer), also a Greek letter or a digit between letters | **Kept as is**, warning `garbled_text` with the reason and the value JSON-encoded. These are the forms in which the model intermittently corrupts accented letters (`Est\tevez`, `Ferr&#225;ndiz`, `ТТРА` for TTPA, `M!rmol`, `Ur%a`, `P0a`); guessing the letter would be a repair. Digits and Greek letters are not checked in tests, whose names have them (`HbA1c`, `γ-GT`). The Catalan middle dot between two l's (`pol·len`, `cèl·lules`) is spelling, not a symbol; anywhere else it counts as one. The earlier `control_character` code, used for the first form alone, remains valid in older predictions. |
| Empty or whitespace-only value | Treated as `null`, warning `empty_value`. |
| Test repeated (case-, accent- and whitespace-insensitive) | First occurrence kept, warning `duplicate_test`. |
| Key that is not a configured field | Dropped, warning `unexpected_key`. |
| Response that is not JSON, or JSON that does not match the layer-1 schema | One retry. If the retry fails too, a prediction is still produced: every field `null`, `tests` empty, `extractor.error` set. |
| Response with garbled text | One retry, since the corruption is intermittent. The reply with fewer garbled values is kept, and a retry that fails never discards a usable first reply. A warning `retried_garbled_text` (field `null`) records how many garbled values each reply had; whatever is still garbled keeps its `garbled_text` warning. |

Warnings are part of the contract. Their codes are an enum in the schema so that consumers
can count them; the harness reports them separately from extraction errors.

## Failures

A prediction always exists for every document that was attempted, so a batch run is complete
even when some calls failed. `extractor.error` is `null` on success; otherwise it carries one
of:

| code | meaning |
|---|---|
| `api_error` | the request to the model failed: Gemini (network, quota, server error, timeout) or the local server (not running, model not loaded, timeout) |
| `invalid_json` | the model returned something that does not parse as JSON |
| `schema_mismatch` | the JSON does not match the layer-1 schema |

A failed prediction is left out of the quality metrics (precision, recall, invention rate,
boxes) and counted by error code instead, so that a quota outage does not look like a worse
model. One end-to-end line of the evaluation report counts its fields as missed.

## Input mode and model

Two providers, chosen by `EXTRACTOR_PROVIDER` (`gemini` by default), by `--provider` in batch
runs, or by a `provider` form field in the API. Every prediction records `model` and
`input_mode`, so that the harness compares them rather than anyone arguing about them.

**Gemini, `pdf-inline`.** The whole PDF is sent inline as `application/pdf` with a page number
asked per value. There is no server-side rendering; Gemini rasterises the pages and runs OCR
on scanned ones. The model id comes from `GEMINI_MODEL` (default: the current Flash).
Generation is deterministic within the limits of the API: `temperature: 0`, JSON mode with the
layer-1 schema as `responseJsonSchema`, low thinking (the current Flash rejects `minimal` with a
400).

**Local, `page-images`.** A vision model behind an OpenAI-compatible chat API, LM Studio's
server with Qwen by default (`LOCAL_LLM_URL`, `LOCAL_LLM_MODEL`). Each page is rendered to a
PNG at 150 dpi with pdf.js and sent as one image, in page order. `temperature: 0` and reasoning
switched off; `thinking_level` is recorded as `null`. The output is **not** constrained by a
schema while decoding: in the manual check of 2026-10-26 that left the values intact but made
the boxes far worse. The layer-1 schema, in the model's own box convention, is appended to the
instruction instead, and the reply goes through the same validation and retry as Gemini's.
Nothing leaves the machine. A multi-page document needs a context of about 32k tokens on the
server. Batch runs default to one document at a time with this provider.

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
