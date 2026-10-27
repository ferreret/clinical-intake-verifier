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
    --baseline DIR    another run over the same goldens: metric changes and flipped fields
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

The exit status is 1 when any prediction, of the run or of the baseline, was rejected (see
below), 0 otherwise. A run in which
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
document, with expected and predicted values and box status. `report.md` holds the same as tables, and ends with the full list of mismatches:
document, field, outcome, expected value, predicted value.

Both record what is needed to tell whether two reports are comparable: run id and directory,
models, prompt versions and input modes found in the predictions, golden directory, seeds and
generator versions, `fields.json` version, IoU threshold and harness version. Two runs are
only comparable when they were scored against goldens from the same generator version and the
same `fields.json`.

## Comparing with a baseline

```bash
uv run intake-synth evaluate ../data/runs/<new-run> --baseline ../data/runs/<old-run>
```

adds to both reports, and to the summary, how the new run differs from the old one:

```
  baseline  : 20261022-135208-gemini-3.8-flash-p1, 5 documents in common (0 only here, 0 only there)
  delta     : fields precision +6.5 pp  recall +6.5 pp  invented +0   tests F1 +0.0 pp   boxes located -1.1 pp
  flipped   : 3 fixed, 0 broken, 0 changed while still wrong
```

**The baseline is scored again, not read from its old report.** Both runs are scored by the same
harness, against the same golden directory, with the same IoU threshold. An old report may have
been made against goldens that have changed since (the physician's title was dropped from the
goldens after the first runs, for instance), and comparing against it would credit the new
run with a change in the answer key.

**Only documents evaluated in both runs are compared.** A document missing from either run, or
failed in either, is left out of the comparison and counted as "only here" or "only there". The
report of the run itself still covers all of its documents.

What the comparison gives:

- **Metric changes**: for every field and for all fields together, the five counts and the three
  rates before and after, with the change in percentage points; the same for test-list metrics,
  box localisation and median IoU.
- **Flips**, document by document:
  - *fixed*: a field that was wrong, missed or invented and is now correct or a correct null; a
    test that was missed and is now found; an extra test that is gone;
  - *broken*: the reverse;
  - *changed while still wrong*: a field wrong in both runs, but with a different outcome or a
    different predicted value.

The list of broken fields is the point. A prompt change rarely only helps: the total can go up
while a few documents that were right go wrong, and those are invisible in a single number.

Comparing two runs made the same way (same model, same prompt) is legitimate too: it measures
how much the model varies from one run to the next, which is the noise any other difference
has to beat.

## Fusion

The fusion engine (`web/src/lib/fusion`, F4) sets each document against the mock LIS: it
links the document to a patient, a physician and an insurer, and gives every field a traffic
light, a reason, a proposed value and its provenance. Every colour is a signal to the
technician, never an acceptance.

```bash
npm --prefix web run seed-lis -- ../data/synth/seed-42
npm --prefix web run fuse -- --golden ../data/synth/seed-42
cd synth && uv run intake-synth evaluate-fusion ../data/fusion/<fusion-id>
```

Without `--run`, `fuse` turns every golden into the prediction a perfect extractor would
make, which measures the engine alone, at no cost and on any commit. With
`--run ../data/runs/<run-id>` it fuses a real run, reading errors included.

**Links.** A patient is linked only when the identity document agrees and so does the name
or the birth date; a weaker match is a candidate the technician confirms, and several are
ambiguous. Each link is scored against the golden's `lis` block: `linked`, `candidate_right`,
`ambiguous_with_right`, `correct_none` (no record, rightly), `false_candidate`,
`candidate_wrong`, `missed`, and **`wrong_link`**, the worst outcome.

**Fields.** A field's right value is what the document prints, except where the scenario
says the form has a typo (then the LIS's); where the document prints nothing, it is the LIS's
value of the right record. Values are compared with the field's LIS compare mode
(`fields.json`), so "612345678" is right for "+34 612 345 678".

| Measure | What it counts | Target |
|---|---|---|
| wrong links | documents linked to another record | 0 |
| wrong green | green fields whose value is not the right one, or empty | 0 |
| wrong values, by state | fields whose proposed value is not the right one, and the colour they got: where reading errors end | none green |
| missing, by state | fields with no proposed value where one was due, conflicts left out (they propose none on purpose) | none green |
| disagreements caught red | fields where document and LIS differ by scenario, marked red | all |
| conflicts with no disagreement | red conflicts the scenario did not plant | as few as possible |

The report also tallies states by scenario and by field. `evaluate-fusion` exits with status 1
when there is any wrong link or wrong green value.

## Test mapping

Each requested line is mapped to lab codes (`web/src/lib/mapping`, F4). Layers, most
trusted first: what this insurer's approved requests say the line means (green after
`GREEN_APPROVALS` = 2 active approvals with no contradiction, orange before); what other
insurers' approved requests say (orange); a catalog search by character trigrams (orange
when the best candidate scores at least 0.55 and leads the next by 0.05, red otherwise).
Only approved requests write to the memory. An approval is **active** when the technician
confirmed an orange proposal or chose the codes of a red line, **passive** when the line was
already green; passive approvals never count towards green, so a mapping cannot confirm
itself through its own colour.

```bash
npm --prefix web run map-simulate -- --dataset ../data/synth/seed-42-n1000 [--error-rate 0.02]
cd synth && uv run intake-synth evaluate-mapping ../data/mapping/<mapping-id>
```

`map-simulate` replays the dataset's requests in index order, reading each line from the
golden (a perfect extraction). The simulated technician approves green lines without
acting, confirms a right orange proposal and corrects a wrong one, and chooses the codes of a
red line; with `--error-rate`, that share of the confirmations of wrong proposals and of the
choices goes wrong. The memory lives in memory for the run; the product keeps it in the
database (`mapping_memory`).

| Measure | What it counts |
|---|---|
| learning curve | per insurer and language, by the position `k` of the request among that insurer's: lines green, orange and red, and **work**, the lines the technician had to correct or choose |
| wrong green | green lines whose codes are not the right ones; must stay at 0 |
| precision by source | right proposals over proposals, for memory, other insurers' memory and search |
| recall@20 | lines whose right codes are among the search's 20 candidates: the ceiling for anything that chooses among them |

`evaluate-mapping` exits with status 1 when any line came out green and wrong.

### The model layer

```bash
npm --prefix web run map-simulate -- --dataset ../data/synth/seed-42-n1000 --model gemini --policy red
npm --prefix web run map-simulate -- --dataset ../data/synth/seed-42-n1000 --model local --policy red
```

With `--model`, a language model chooses among each line's catalog candidates, once per
document, for the lines the policy hands it: `red` (the default) only the lines the memory
and the search left red; `all` every line the memory did not settle, its answer replacing
the search's. Its answers are orange; an empty answer leaves a red line red (and makes a
line red under `all`). Replies are cached in `data/model-cache`, keyed by provider, model,
prompt version and request, so a rerun costs nothing. `evaluate-mapping` adds the model's
calls (per 100 documents), lines sent, answered and right, tokens and latency per uncached
call, and `precision_by_source` gains `model`. `local` needs LM Studio's server with the
model loaded (`lms server start`; `lms load qwen/qwen3.6-35b-a3b`). Outside the simulation
the provider is `MAPPING_MODEL_PROVIDER`, local by default; the public demo sets it to
`gemini`.

### Comparing searches

```bash
npm --prefix web run search-compare -- --dataset ../data/synth/seed-42-n1000
cd synth && uv run intake-synth evaluate-search ../data/search/<search-id>
npm --prefix web run map-simulate -- --dataset ../data/synth/seed-42-n1000 --search hybrid --min-score 0.72 --min-lead 0.04
```

`search-compare` ranks the catalog for every distinct (insurer, line) pair of a dataset with
three methods: `lexical` (trigrams), `embedding` (a local multilingual sentence-embedding
model, `Xenova/multilingual-e5-small`, run with transformers.js) and `hybrid` (the mean of
both scores). `evaluate-search` reports, per method, language and for profiles, how often
the right codes come first, among the first 5 and among the 20 candidates, and the mean
reciprocal rank. Then it compares methods at **matched precision**: each method proposes its
first candidate above a minimum score and lead; the thresholds are swept, and a method is
better only if it proposes more lines at the same share of right proposals. Thresholds are
chosen on the first half of the lines and measured on the second ("held out"), because
thresholds chosen on the lines they are measured on flatter every method. `map-simulate
--search` then replays the documents with the chosen method and thresholds.

## Not yet

- Running the evaluation in CI on every commit, which needs a Gemini key in CI. Deferred to F6.
