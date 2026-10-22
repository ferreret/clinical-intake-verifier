# Evaluation

How an extractor run is scored against the golden sample. The harness is the `evaluate`
command of the Python package (`synth/src/intake_synth/evaluate/`). It reads the field list and
the compare modes from `schema/fields.json` and hard-codes no field names.

The point of it: a prompt change, a model change or a new provider is judged by numbers over
the same documents, not by looking at a few of them.

## Running it

```bash
cd synth
uv run intake-synth evaluate ../data/runs/<run-id>
```

```
intake-synth evaluate RUN_DIR
    --golden DIR      default: the source recorded in RUN_DIR/run.json
    --iou 0.5         IoU at which a box counts as located
    --only ID,ID      evaluate a subset of the run
    --out DIR         default: RUN_DIR/eval/
```

It writes `report.json` and `report.md` and prints a summary:

```
eval 20261022-140331-gemini-3.8-flash-p2 vs data/synth/seed-42
  documents : 5 evaluated, 0 failed, 0 rejected, 195 of the source not in this run
  fields    : precision 100.0%  recall 100.0%  invented 0/19   46 correct, 0 wrong, 0 missed
  tests     : P 100.0%  R 100.0%  F1 100.0%  exact list 5/5
  boxes     : located 92/93 at IoU>=0.5, median 0.74
  warnings  : 0
  cost      : 8.8 s/doc, 2479 in / 1044 out tokens per doc
  worst     : none
```

The exit status is 1 when any prediction was rejected (see below), 0 otherwise. A run in which
the model made mistakes still exits 0: the harness measures, it does not pass or fail a model.

## What gets scored

Every `<id>.pred.json` in the run directory is paired with `<id>.json` in the golden directory.
A pair is **rejected**, listed with its reason and not scored, when:

- the prediction's `id` does not match its file name, or there is no golden with that id;
- `golden_version` or `prediction_version` is not one the harness supports;
- either document does not match its JSON Schema;
- the field keys of either document differ from `schema/fields.json`;
- the two `sha256` differ: the prediction was made from a different PDF.

Golden documents with no prediction in the run are counted as "not in this run" and otherwise
ignored, so a run over 5 documents is scored over those 5.

A prediction whose `extractor.error` is set is a **failed extraction**. It is left out of every
quality metric below and counted by error code (`api_error`, `invalid_json`,
`schema_mismatch`). A quota outage must not look like a worse model. One end-to-end line
counts failed documents as missed (below), so they are not invisible either.

## Fields

Each field of each document gets exactly one outcome, comparing the predicted value with the
golden `value` under the field's compare mode:

| Golden | Prediction | Outcome |
|---|---|---|
| has a value | matches | correct |
| has a value | does not match | wrong |
| has a value | null | missed |
| null | null | correct null |
| null | has a value | **invented** |

Golden nulls are real answers. A field absent from the document, required or not, is null in
the golden, and returning null there is correct.

Per field, and over all fields together, the report gives the five counts and three rates:

| Rate | Definition | Reads as |
|---|---|---|
| precision | correct / (correct + wrong + invented) | how far an operator can trust a value the model gave |
| recall | correct / (correct + wrong + missed) | how many of the values on the page the model got |
| invention rate | invented / (correct null + invented) | how often the model fills a field that is not there |

An invented value already counts against precision. It is reported on its own as well because
it is the failure that matters most to this project: a value with no source, which the fusion
engine can only catch if the system of record disagrees. A rate whose denominator is zero is
shown as `—`.

**Worst** lists up to three fields with the fewest documents scored right (correct or correct
null), as `field right/evaluated`.

## Compare modes

Defined in `schema/fields.json`, implemented twice (Python for the harness, TypeScript for the
app and later the fusion engine) and pinned by the shared cases in
[`schema/compare-cases.json`](../schema/compare-cases.json), which pytest and vitest both run.

| Mode | Two values match when | Used for |
|---|---|---|
| `exact` | they are equal after trimming | date of birth, sex |
| `casefold` | they are equal after Unicode decomposition (NFD), removing every mark, lower-casing and collapsing whitespace | names, insurer, tests |
| `digits` | their ASCII digits are the same sequence | age, phone, registration number, card number |
| `alnum_upper` | their ASCII letters and digits are the same sequence, upper-cased | identity document, request, authorisation and insurer request numbers |

Consequences worth knowing: under `casefold`, "Peña" matches "Pena" (the tilde is a mark);
under `digits`, "+34 612 345 678" does not match "612 345 678". A value that normalises to
nothing ("—" under `digits`) only matches one identical after trimming, so that "sí" and "no"
are not equal as digit sequences.

Normalisation rules (`normalize` in `fields.json`: date format, sex code, no title on the
physician's name) are part of what the model must return, and the golden `value` already
follows them. Compare modes only absorb formatting differences; they do not apply those rules.

## Tests

The requested tests are matched as a set under the `tests` compare mode (`casefold`). A golden
test with a matching prediction is matched, one without is missed, and a predicted test that
matches no golden test is extra. Over all documents:

- precision = matched / (matched + extra), recall = matched / (matched + missed), F1 their
  harmonic mean (micro averages: every test counts the same, whatever document it is in);
- **exact lists**: documents with no missed and no extra test, the case where the operator
  corrects nothing in the list.

## Boxes

Only values that are correct are checked for their box: a box around a wrong value is not
evidence of anything. Fields and matched tests are reported separately and together. Each one
gets one status:

| Status | Meaning |
|---|---|
| located | IoU at or above the threshold (`--iou`, default 0.5) |
| below threshold | on a right page, IoU below the threshold |
| wrong page | the predicted page has no occurrence of the value |
| no box | the prediction has no page or no box |

IoU (intersection over union of the two rectangles, on page-normalised coordinates) is taken
against the golden's primary location and every `also_at` location on the predicted page; the
best one counts. A value printed on two sheets is located if either box is found. The located
rate is located / (located + below threshold + wrong page). Median and minimum IoU are over the
boxes that landed on a right page.

The golden box covers what was printed, title included for the physician; the model is asked
to box the same.

## Warnings, slices and cost

**Warnings** from the boundary (`docs/extractor-contract.md`) are tallied by code and by field,
over every prediction including failed ones, separately from errors. A rising `title_removed`
count, for instance, means the model ignores the no-title rule more often.

**Slices** repeat the field and test metrics over subsets of the documents, from the golden:

- `scan`: scanned or clean;
- `template`: the template of the main request sheet;
- `pages`: single page or several;
- `style`: printed or handwritten, per field (fields only, from the golden `style`; golden
  nulls have no style and are not in this slice).

**Cost** averages latency and input and output tokens per document over all predictions.

## Outputs

`report.json` holds everything, including the outcome of every field and every test in every
document, with expected and predicted values and box status. It is what a baseline comparison
will read. `report.md` holds the same as tables, and ends with the full list of mismatches:
document, field, outcome, expected value, predicted value.

Both record what is needed to tell whether two reports are comparable: run id and directory,
models, prompt versions and input modes found in the predictions, golden directory, seeds and
generator versions, `fields.json` version, IoU threshold and harness version. Two runs are
only comparable when they were scored against goldens from the same generator version and the
same `fields.json`.

## Not yet

- `--baseline DIR`: deltas against another run over the same source and the list of fields
  that flipped. Block B of F3.
- Running the evaluation in CI on every commit, which needs a Gemini key in CI. Deferred to F6.
