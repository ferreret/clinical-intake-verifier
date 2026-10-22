# Roadmap

Where the project stands, what has been decided and what is only proposed. Read this before
starting a work session. Anything marked **proposed** is a design that has not been approved or
implemented; it changes only after an explicit decision.

Last updated: 2026-10-22.

## Where things stand

| Phase | Scope | State |
|---|---|---|
| F1 | Synthetic request generator with golden ground truth | done |
| F2 | Extractor: Gemini Flash, structured output and boxes | done, verified against the live API |
| F3 | Evaluation harness | done, first full run measured (below) |
| F4 | Mock LIS and fusion engine | not started |
| F5 | Verification UI | not started |
| F6 | Public demo on Vercel | not started |

Local open-weight vision models are a **proposed** side track between F3 and F4.

### First live extractor run

Five documents (`synth-000000` to `synth-000004`, seed 42), `gemini-3.8-flash`, prompt v1,
thinking level `low`. Checked with an ad-hoc script, not the harness: treat it as a smoke test.

| Measure | Result |
|---|---|
| Fields matching the golden | 64 of 65 |
| Requested tests | 47 of 47 found, none extra |
| Box overlap with the golden (IoU) | every box at least 0.56, median 0.78 |
| Cost per document | about 8 s, 2.4k input and 0.9k output tokens |

The one miss: `NombreMedico` in `synth-000000` came back without the honorific, as
"Pepita Conde Tirado" instead of "Dra. Pepita Conde Tirado". Repeated on Ubuntu on 2026-10-22
with `@google/genai` 2.30.0: identical figures, same miss. That miss is no longer one: since
prompt v2 the title is meant to be dropped (open decision 1 below).

What the live call settled:

- the model id `gemini-3.8-flash` is valid;
- `responseJsonSchema` accepts the layer-1 schema with nullable fields, with no warnings;
- `thinkingLevel: MINIMAL` is rejected with `400 INVALID_ARGUMENT`, so the default is now `low`.

### First full run

All 200 documents of seed 42, `gemini-3.8-flash`, prompt v2, thinking level `low`, scored by
the harness on 2026-10-22 (`intake-synth evaluate`; run `20261022-172951-gemini-3.8-flash-p2`).

| Measure | Result |
|---|---|
| Documents | 200 evaluated, 0 failed, 0 rejected |
| Fields | 2035 correct, 4 wrong, 0 missed; precision and recall 99.8% |
| Invented values | **0 of 561** golden nulls |
| Requested tests | P 99.9%, R 99.8%; exact list in 198 of 200 documents |
| Boxes located at IoU ≥ 0.5 | 3535 of 3564 (99.2%), median IoU 0.76 |
| Handwritten values | 104, all correct |
| Cost | 8.6 s per document; 454k input and 210k output tokens in total, about 1.1 USD |

The six documents with a mistake, and what they point to:

1. **Control characters where an accented letter should be** (`synth-000082`, `synth-000174`,
   both scanned). "Estévez" came back as `Est\tevez`, "años" as `a\tnos`, "Fibrinógeno" as
   `Fibrin\x03ogeno`: the accent replaced by a tab or U+0003 in front of the base letter. Five
   values in two documents; 324 golden values have non-ASCII letters and the rest were fine.
   Two field mismatches and two test mismatches. Whether the model or the response decoding
   produces it is not known yet: the prediction does not keep the raw response.
2. **Sex from an identity card** (`synth-000147`). The only evidence is the card's bare `M`,
   which on a Spanish identity card means male; the model returned `M` (female). The prompt's
   rule speaks of "a card whose other option is F", but a card prints only one letter. Two
   documents depend on this and the model got one right.
3. **Day and month swapped** (`synth-000027`, scanned): `07/08/2009` printed, `08/07/2009`
   returned. Isolated.
4. **One test dropped** (`synth-000108`, clean): Fibrinógeno missing from a list of seven.

Boxes: 29 below the threshold, none on a wrong page; the most frequent are tests (17) and
`Sexo` (5), whose targets are a single letter or a checkbox.

### Proposed after the first full run

**Status: proposed and approved on 2026-10-22; being done in this order.** Each change is
measured with `--baseline` against the run above.

- **Boundary: done.** Values containing a control character get a `control_character` warning
  and are kept as they are. Before adding it, both affected documents were sent again twice
  each and every raw response came back clean ("Estévez", "Fibrinógeno"), with no control
  character and no escape for one: the characters are intermittent model output, not a
  decoding fault on our side, so they can be detected but not prevented.
- **Prompt v3: done.** The sex rule now depends on the sheet, not on an "other option" an
  identity card never prints: on the request form and its companion sheets `M` means female,
  on a photocopied identity card `M` means male and `F` female. Full run
  `20261022-193329-gemini-3.8-flash-p3` against the run with retry as baseline: `Sexo` 179 of
  179 correct (the card of `synth-000147` included), fields 99.9% (3 wrong), exact test lists
  198 of 200, no invented value, 10% fewer output tokens. The rule cannot be judged on more
  than that one document, but nothing that depends on it broke.

  The comparison shows 4 broken, 0 fixed, and none of the four is about sex: they are two
  forms of corrupted text the detector does not know yet, in two documents.

  | Printed | Returned | Form |
  |---|---|---|
  | Uría, Atlántida | `Ur%a`, `Atl%ntida` | `%` in place of the letter |
  | TTPA | `ТТРА` | Cyrillic letters that look Latin |

  The retry did its job on the forms it knows: three documents garbled on the first reply,
  all three clean on the second. The two systematic mistakes remain (`synth-000027`,
  `synth-000108`).

- **Approved on 2026-10-22 and implemented: widen the garbled-text detector.** It flags no
  golden value and catches both documents the v3 run let through. The proposal: two more
  checks, both checked
  first against every golden value, which contain no `%` and no non-Latin letter:
  - any character that is not a letter, digit, space or ordinary punctuation
    (`. , ' - / ( ) + &`) next to a letter, generalising the `!` check (`Ur%a`, `M!rmol`);
  - Cyrillic letters anywhere, and Greek letters in names (Greek stays allowed in test names,
    where `γ-GT` or `β-HCG` are legitimate).

  Measured like the retry, with a full run against the v3 run as baseline.

  **Measured** on run `20261022-194344-gemini-3.8-flash-p3`: fields 100.0% (2038 of 2039),
  exact test lists 196 of 200, no invented value. Four documents were garbled on the first
  reply and clean on the retry (060, 084, 138, 172). Against the v3 run: 5 fixed, 6 broken,
  which is the size of the run-to-run noise measured earlier, so the detector itself is not
  what moved. What the six broken results are:

  - **`&` in place of an accented letter** (`Ferr&ndiz`, `synth-000045`): `&` is allowed as
    ordinary punctuation for "Seguros & Salud", so it passes. A `&` with letters on both sides
    would be a narrower rule. Not done: every new run so far has shown a new form, and
    chasing them one by one has a limit.
  - **`lones` for Iones** (`synth-000004`, `synth-000184`): a capital I read as a lowercase l.
    In the sans-serif fonts of the templates the two are almost identical, so this is a
    reading error, not corrupted output, and no character check can see it.
  - **Perfil renal dropped** (`synth-000109`): the catalog has profile names that are printed
    both as group headings (not tests) and as requested items (tests). The prompt says
    headings are not tests; here the model took a requested profile for a heading. Iones is
    the same kind of name.

  The swapped date of `synth-000027` was right this time, for the first time in four runs.
  Fibrinógeno in `synth-000108` is still missed, as in every run.

  Output tokens rose to 253k from 188k in the v3 run with the same prompt; latency rose too
  (11.9 s per document). Nothing in the extractor changed that explains it, and retries
  account for about 5k; it looks like variance in the API. To watch on the next runs.

  **Where this leaves the extractor:** at about 99.9% of fields, no invented value in five
  full runs (2,805 golden nulls), and a run-to-run noise of a handful of results. Further
  gains on these documents are within that noise; the next phase is F4.
- **Repeat the full run: done.** Same prompt, same model, run `20261022-175122-gemini-3.8-flash-p2`
  against the first one as its baseline. Fields 99.6% (8 wrong), tests F1 99.8%, still no
  invented value. Between the two identical runs **21 results flipped**: 7 fixed, 13 broken,
  1 changed while still wrong. This is the noise any later change has to beat.

  **19 of the 21 are one problem: accented letters corrupted in the output.** It hits whole
  documents, about 2 to 3% of them per run, and different ones each time (082 and 174 in the
  first run, 019, 038, 078 and 162 in the second). The corruption takes several forms, and
  only some are control characters:

  | Printed | Returned |
  |---|---|
  | Estévez, Fibrinógeno | `Est\tevez`, `Fibrin\x03ogeno` |
  | Haydée, años | `Hayd\x00\x00\x00\x00`, `a\x00os` |
  | Mármol, Ácido úrico | `M!rmol`, `!cido !rico` |
  | Pía Martínez | `P0a Mart\x00nez` |
  | Ferrándiz, Héctor | `Ferr&#225;ndiz`, `H&#233;ctor` (HTML entities) |

  The `control_character` warning caught 5 values in two documents; the `!`, digit and
  HTML-entity forms pass it unflagged. The remaining two flips are the identity-card sex letter
  of `synth-000147`, right this time (a coin flip, as expected from the ambiguous rule), and
  the date of `synth-000027`, wrong both times but differently (`08/07/2009`, then
  `08/08/2009`). Without the corruption the model is very stable between runs.

- **Approved on 2026-10-22 and implemented: treat corrupted accents as a model output
  error.** Done as described below, with the `garbled_text` and `retried_garbled_text`
  warnings. The detector flags no value in any of the 200 goldens (5,610 values) and catches
  all six corrupted documents of the two full runs.

  **Measured** on a third full run (`20261022-180853-gemini-3.8-flash-p2`, same prompt v2):

  | | Run 1 | Run 2 | With retry |
  |---|---|---|---|
  | Fields wrong | 4 | 8 | **1** |
  | Field precision and recall | 99.8% | 99.6% | **100.0%** (2038 of 2039) |
  | Exact test lists | 198 | 196 | **199** of 200 |
  | Boxes located | 99.2% | 98.8% | 99.3% |
  | Invented values | 0 | 0 | 0 |
  | Input tokens | 454k | 454k | 459k (+1%) |

  Three documents came back garbled on the first reply (034, 082, 121, with 2 to 4 values
  each) and clean on the retry; none was left garbled. Against run 2 as baseline: 13 fixed,
  0 broken; against run 1: 7 fixed, 0 broken. The retry cost five thousand input tokens.

  What is left wrong is the same in all three runs, so it is systematic, not noise: the
  swapped date of `synth-000027` (scanned) and Fibrinógeno missing from `synth-000108`
  (clean). The identity-card sex of `synth-000147` was right in runs 2 and 3, wrong in run 1.

  The proposal as made: detect them at
  the boundary (control characters, HTML numeric entities, and a `!` or a digit between two
  letters in fields compared with `casefold`), and retry the document once, as the extractor
  already does for invalid JSON. The corruption is intermittent, so a retry should clear most
  of it; whatever survives keeps a warning for the operator. Measured with `--baseline`
  against both v2 full runs. It affects 2 to 3% of documents, against one document for the
  prompt v3 rule below, so it should go first.

## Next steps, in order

### 1. Set up the development environment on Linux

Development continues on an Ubuntu workstation with an AMD GPU, set up clean from a clone.
Nothing is copied from the previous machine: synthetic data is regenerated and runs are repeated.

1. Install git, Claude Code, [uv](https://docs.astral.sh/uv/) (it fetches Python 3.12 from
   `synth/.python-version`) and Node 22 through nvm (the project pins `@types/node@^22`).
2. `uv --directory synth sync` and `npm --prefix web ci`.
3. Copy `web/.env.example` to `web/.env.local` and put a Gemini key in it.
4. Run the Python tests, the web tests, the type check and lint.
5. Regenerate the dataset, check its fingerprint (below) and repeat the five-document run.

**Status on 2026-10-22.** Steps 1, 2 and 4 are done on Ubuntu: Python 3.12.15 through uv, Node
22.23.4 and npm 10.9.9 through nvm 0.40.8. 28 Python tests, Ruff, 27 web tests, the type check,
lint and `next build` pass. Step 3 and the five-document run are done too (results above).
The dataset is regenerated, but its fingerprint differs (below).

nvm is loaded at the end of `~/.bashrc`, which returns early in non-interactive shells, so
`node` and `npm` are not on the PATH of scripted commands until `source ~/.nvm/nvm.sh`. The same
applies to the preview server in `.claude/launch.json`, which runs `npm` directly.

**`npm audit`.** `next` and `eslint-config-next` moved from 16.3.4 to 16.3.8 on 2026-10-22,
which fixes the seven Next.js advisories, among them a critical one in `next/og`. None of them
reached features this app uses, but the demo will be public. Five high advisories remain, all
one issue: `braces` 3.0.3, a denial of service through deeply nested glob patterns, pulled in
by `@next/eslint-plugin-next` through `fast-glob` 3.3.1. No fixed `braces` has been published,
and 16.4.2 pins the same `fast-glob`; the fix npm suggests is a downgrade to
`eslint-config-next` 14. Accepted: it only runs when linting, never in the deployed app.
Re-check when Next.js updates that dependency. 16.4.x is a minor upgrade, left for later.

The preview in `.claude/launch.json` fails here with `npm` not found, because of the nvm PATH
issue above. Not fixed yet.

**Resolved: rolldown native binding.** The old lockfile listed rolldown's platform bindings as
optional dependencies but had no entry for any of them, a known npm bug, so vitest failed to
start on a clean Linux install. Regenerating the lockfile from a clean tree (`06bba85`) fixed it:
`npm ci` now installs the right binding on every platform, with no workaround.

**Cross-platform reproducibility check.** The README promises "same seed, same bytes". That
holds on the machine that produced the dataset (re-verified on 2026-10-22 by regenerating five
documents, clean and scanned). Across operating systems it does **not** hold (see below).
Regenerate, then fingerprint:

```bash
uv --directory synth run intake-synth generate --n 200 --seed 42
```

```bash
python3 - <<'PY'
import hashlib, json
m = json.load(open("data/synth/seed-42/manifest.json", encoding="utf-8"))
docs = sorted(m["documents"], key=lambda d: d["id"])
def fp(ds):
    lines = "".join(f"{d['id']} {d['sha256']}\n" for d in ds)
    return hashlib.sha256(lines.encode()).hexdigest()[:16]
print("all    ", fp(docs))
print("clean  ", fp([d for d in docs if not d["scanned"]]))
print("scanned", fp([d for d in docs if d["scanned"]]))
PY
```

Results with `generate --n 200 --seed 42`:

| Subset | Documents | Windows (original dataset) | Ubuntu (2026-10-22) |
|---|---|---|---|
| all | 200 | `a482364f2f14e150` | `84a918ce8b427746` |
| clean | 96 | `13cf85c55b90bede` | `f815510e11df692d` |
| scanned | 104 | `9c645b902cebb1fc` | `2488db358c89e71a` |

All three subsets differ. Document counts, page counts and absent fields match, so the generated
content is the same; only the bytes differ. Because clean documents differ too, the cause is not
only the scanner simulation (blur, grain, JPEG encoding) but something in PDF output.

Ruled out: file paths embedded in the PDFs, creation dates and the document `/ID` (the generator
already writes PDFs with `invariant=1`), and line endings.

Main suspect, not proven: image compression. Pillow and zlib may encode the same pixels to
different bytes depending on the platform or the library build. Confirming it needs a PDF from
the Windows machine to compare object by object; no Windows machine is in use any more.

Whatever the cause, the goldens stay valid, because boxes come from geometry and not from pixels.
Still to do: the README and `docs/golden-format.md` should say that byte-identical output holds
per platform, not across platforms.

### 2. F3: evaluation harness (approved)

**Status: proposed and approved on 2026-10-22, with every open decision settled (below).
Block A is implemented: shared compare modes (`schema/compare-cases.json`), the `evaluate`
command with both reports, and [docs/evaluation.md](evaluation.md), which is now the reference
for the metric definitions. Block B's `--baseline` is implemented too, re-scoring the
baseline rather than reading its old report (see `docs/evaluation.md`). What remains is the
first full 200-document run with Gemini.** The
design below is kept as approved; where it and `docs/evaluation.md` differ in detail, the
latter describes what was built.

A new `evaluate` subcommand of the Python package, in `synth/src/intake_synth/evaluate/`. It
reads the compare modes from `schema/fields.json` and hard-codes no field names.

**Field scoring.** Each predicted value is compared with the golden `value` using the field's
compare mode. Every field of every document gets exactly one outcome:

| Golden | Prediction | Outcome |
|---|---|---|
| has a value | matches | correct |
| has a value | does not match | wrong |
| has a value | null | missed |
| null | null | correct null |
| null | has a value | **invented** |

Golden nulls on required fields are real: in seed 42, `Sexo` is absent from 21 documents and
`DocumentoIdentidad` from 14. Returning null there is the right answer.

Per field, the report gives the five counts and three rates:

- **precision**: correct / (correct + wrong + invented). How far the operator can trust a value
  the model gave.
- **recall**: correct / (correct + wrong + missed).
- **invention rate**: invented / golden nulls. It already counts against precision, but it is
  reported on its own because it is the metric that matters most to this project's stance.

**Tests.** Set match with `casefold`, as `fields.json` specifies. Micro precision, recall and F1
over all tests, plus the number of documents whose test list is exactly right: the case where
the operator corrects nothing.

**Boxes.** Measured only on correct values that come with a box. IoU against the primary
location and every `also_at` location; the best one counts. A box is *located* at IoU 0.5 or
more (`--iou`). Counted separately: correct values without a box, and boxes on a page where the
value does not appear.

**Extraction failures.** Documents with `extractor.error` are left out of the quality metrics
and counted by error code. One end-to-end line counts them as missed. A quota outage must not
look like a worse model.

**Warnings.** Tallied by code and by field, separately from errors.

**Slices.** Scanned or clean, handwritten or printed (per field, from the golden `style`),
template, single or multi-page.

**Pre-checks.** A prediction's `sha256` must equal its golden's, and both format versions must
be supported. Otherwise the document is rejected with a clear error instead of being scored.

**CLI.**

```
intake-synth evaluate RUN_DIR
    --golden DIR      default: the source recorded in run.json
    --baseline DIR    another run over the same source: deltas and flipped fields
    --iou 0.5         localisation threshold
    --only ID,ID      evaluate a subset
    --out DIR         default: RUN_DIR/eval/
```

Console summary, with approximate figures from the first live run:

```
eval 20261022-110628-gemini-3.8-flash-p1 vs data/synth/seed-42
  documents : 5 evaluated, 0 failed, 195 of the source not in this run
  fields    : precision 97.8%  recall 97.8%  invented 0/19   45 correct, 1 wrong, 0 missed
  tests     : P 100%  R 100%  F1 100%  exact list 5/5
  boxes     : located 92/92 at IoU>=0.5, median 0.78
  warnings  : 0
  cost      : 8.3 s/doc, 2423 in / 923 out tokens per doc
  worst     : NombreMedico 4/5
```

**Outputs.** `report.json` holds everything, including the outcome of every field in every
document; it is what `--baseline` reads. `report.md` holds the tables and ends with the full
list of mismatches: document, field, expected value, predicted value. Both record the harness
version, seed, generator version, `fields.json` version and IoU threshold.

**Decisions**, all settled on 2026-10-22:

1. ~~A dropped honorific counts as wrong.~~ **Settled on 2026-10-22 the other way, as a product
   decision:** what matters is the physician's name and surnames, not the title. `NombreMedico`
   now has the `no-title` normalisation rule (fields.json v2): the golden value drops the title,
   the prompt (v2) asks for it to be dropped, and the boundary removes any title left, with a
   `title_removed` warning. The metric stays strict on the name itself.
2. **Failures stay out of the quality metrics.** Approved as recommended;
   `docs/extractor-contract.md` is amended accordingly.
3. **A shared `schema/compare-cases.json`**, run by both pytest and vitest, so that the Python
   and TypeScript implementations of the compare modes cannot drift apart. The fusion engine
   in F4 reuses it. Approved as recommended.
4. **Two blocks.** Approved as recommended. (a) Scoring, reports and `docs/evaluation.md` with
   the metric definitions. (b) Baseline comparison and a full 200-document run. Running the
   evaluation in CI on every commit needs a Gemini key in CI and is deferred to F6.

### 3. Local open-weight vision models (proposed)

**Status: proposed on 2026-10-22, not approved, not implemented.**

Goal: run the extractor with an open-weight vision model on the local AMD GPU and compare it
with Gemini on the same 200 documents, using the harness. Two reasons beyond curiosity: with a
local model the document never leaves the machine, which matters for health data; and comparing
providers on the same golden is exactly the "measure, don't argue" point of this project.

**Runtime.** Ollama: OpenAI-compatible API and output constrained to a JSON Schema. On Linux
with an AMD GPU it needs the ROCm 7 driver, installed with AMD's `amdgpu-install`. Cards outside
the ROCm support list run through Ollama's Vulkan path or with `HSA_OVERRIDE_GFX_VERSION`; the
llama.cpp server with Vulkan is the fallback. vLLM is not planned: its support for consumer
Radeon cards is still immature.

**First, by hand.** Before any code, send one page image with the layer-1 schema to the local
model and check that schema-constrained output works with an image in the prompt. No source
found so far confirms it.

**Model.** The Qwen-VL family: general vision-language models that read, normalise and return
text boxes in one call, which is what the extractor asks of Gemini. Size depends on GPU memory.
As a rough guide, 8 to 12 GB fits a quantised model of 7 to 8 billion parameters and 24 GB or
more fits about 30 billion; an APU with unified memory changes the picture. Dedicated OCR models
(PaddleOCR-VL, MinerU, GLM-OCR, dots.ocr) lead document-OCR benchmarks but return text and
layout, not fields; a two-stage pipeline built on one of them is a later experiment.

**Code changes.**

- A provider choice, Gemini or local, from an environment variable. `prediction.extractor`
  records which model produced each prediction, as it does now.
- Input mode `page-images`: pages rendered to images, already reserved in
  `docs/extractor-contract.md`. Running Gemini in that mode too separates the effect of the model
  from the effect of the input.
- One box adapter per model family at the boundary, because families report coordinates
  differently. The harness verifies the conversion.
- The same prompt and the same `fields.json`; only the transport changes.

**Constraints.** The public demo on Vercel stays on Gemini; local models are for development and
evaluation. Adding a provider changes the stack described in `CLAUDE.md`, which is updated only
once this is approved.

**Workstation, as found on 2026-10-22.** The GPU is a Radeon 890M, an APU with 2 GB of dedicated
VRAM and about 30 GiB of GTT (system memory the GPU can map). ROCm and Ollama are not installed.
What is installed is LM Studio, which runs llama.cpp with Vulkan, with Qwen3.6-35B-A3B loaded: a
mixture-of-experts model with about 3 billion active parameters and vision support. Its server
on `127.0.0.1:1234` speaks the OpenAI API and returns JSON constrained to a schema; whether that
still holds with an image in the prompt is the manual check above. This changes the runtime
assumed above (Ollama on ROCm) and should be settled when the track is approved.

### 4. F4 to F6

Unchanged. See `CLAUDE.md`.
