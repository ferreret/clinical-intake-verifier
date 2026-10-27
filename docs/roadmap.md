# Roadmap

Where the project stands, what has been decided and what is only proposed. Read this before
starting a work session. Anything marked **proposed** is a design that has not been approved or
implemented; it changes only after an explicit decision.

Last updated: 2026-10-27.

## Where things stand

| Phase | Scope | State |
|---|---|---|
| F1 | Synthetic request generator with golden ground truth | done |
| F2 | Extractor: Gemini Flash, structured output and boxes | done, verified against the live API |
| F3 | Evaluation harness | done, first full run measured (below) |
| F4 | Mock LIS, fusion engine and test mapping | done: blocks 1 to 6, measured end to end on real readings (below) |
| F5 | Batches and verification UI | blocks 1 to 3 of 4 done: batches, queue, their screens and the verification screen (section 5) |
| F6 | Public demo on a self-hosted Dokploy | not started |

Local open-weight vision models were approved on 2026-10-26 as the top priority, ahead of
F4 block 6 (section 3).

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
Re-check when Next.js updates that dependency.

On 2026-10-23 three new Next.js advisories covered 16.0.0 to 16.4.0, one critical: remote code
execution in the image optimisation API with SVG files and in `use cache` functions, and a
denial of service through Server Actions. The app uses none of the three (no `next/image`, no
Server Actions, no `use cache`), but the demo will be public, so `next` and
`eslint-config-next` moved to 16.4.2 the same day; tests, lint, the type check, `next build`
and the dev server all pass. `npm audit --omit=dev` now reports nothing. What remains is
development-only: the five `braces` advisories above, and four moderate ones in the `esbuild`
that `drizzle-kit` (block 2) pulls in, about esbuild's own development server, which this
project never starts.

The preview in `.claude/launch.json` failed here with `npm` not found, because of the nvm PATH
issue above. Fixed on 2026-10-23: it runs through `bash`, which loads `~/.nvm/nvm.sh` when it
exists and otherwise uses whatever `npm` is on the PATH.

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

These are the generator 0.2.0 dataset. F4 block 1 (generator 0.3.0, 2026-10-23) replaced it;
with Catalan forms and the mock LIS (block 2) added the same day, on Ubuntu it fingerprints as
all `bbc8203179af22be`, clean `58badd6ab258fb56`, scanned `03826bd1eda00445`.

All three subsets differ. Document counts, page counts and absent fields match, so the generated
content is the same; only the bytes differ. Because clean documents differ too, the cause is not
only the scanner simulation (blur, grain, JPEG encoding) but something in PDF output.

Ruled out: file paths embedded in the PDFs, creation dates and the document `/ID` (the generator
already writes PDFs with `invariant=1`), and line endings.

Main suspect, not proven: image compression. Pillow and zlib may encode the same pixels to
different bytes depending on the platform or the library build. Confirming it needs a PDF from
the Windows machine to compare object by object; no Windows machine is in use any more.

Whatever the cause, the goldens stay valid, because boxes come from geometry and not from pixels.
The README and `docs/golden-format.md` now say that byte-identical output holds per platform,
not across platforms (2026-10-23).

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

### 3. Local open-weight vision models (approved)

**Status: proposed on 2026-10-22; approved by the product owner on 2026-10-26 as the top
priority. Steps 1 to 4 done, and the four proposals that followed (below).** Before this
track the local model had only chosen lab codes (F4 block 5); it had never read a document. The public demo will replay recorded replies of both
providers for a fixed set of synthetic documents, so it needs a local extraction to replay
(design in section 5).

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

**Constraints.** Local models run only on the development machine; the public demo shows
their recorded replies (section 5). Adding a provider changes the stack described in `CLAUDE.md`, which is updated only
once this is approved.

**Workstation, as found on 2026-10-22.** The GPU is a Radeon 890M, an APU with 2 GB of dedicated
VRAM and about 30 GiB of GTT (system memory the GPU can map). ROCm and Ollama are not installed.
What is installed is LM Studio, which runs llama.cpp with Vulkan, with Qwen3.6-35B-A3B loaded: a
mixture-of-experts model with about 3 billion active parameters and vision support. Its server
on `127.0.0.1:1234` speaks the OpenAI API and returns JSON constrained to a schema; whether that
still holds with an image in the prompt is the manual check above. This changes the runtime
assumed above (Ollama on ROCm) and should be settled when the track is approved.

**Plan, as approved.** The runtime is LM Studio, already installed and already serving the
mapping layer; Ollama and ROCm are not needed unless it falls short. One step at a time:

1. The manual check above: one page image, the layer-1 schema, one call. It settles whether
   schema-constrained output works with an image, how Qwen reports boxes, and the time per
   page on this APU.
2. Provider choice and `page-images` input in the extractor, with Qwen's box adapter.
3. A smoke run on five documents, then the 200 documents scored by the harness.
4. The same 200 documents with Gemini (F4 block 6), so that both are measured on the
   regenerated dataset; the 2026-10-22 run used the earlier one.

**Step 1 done on 2026-10-26: the manual check.** Qwen3.6-35B-A3B in LM Studio, pages rendered
at 150 dpi as PNG, the extractor's own system instruction and layer-1 schema, temperature 0,
`reasoning_effort: "none"`. Two documents of seed 42: `synth-000000` (one clean page) and
`synth-000003` (four scanned pages, fax cover and consent first, two handwritten fields).

| | synth-000000 | synth-000003 |
|---|---|---|
| Fields right | 13 of 13 | 13 of 13, both handwritten ones included |
| Tests right, exact text | 6 of 6 | 22 of 24 |
| Page of each value | all right | all right |
| Boxes at IoU ≥ 0.5 | about half | almost none, though near the value |
| Time | 57-66 s | 151 s |
| Tokens in / out | 3.3k / 1.1k | 12.7k / 2.0k |

The two test misses: "Γ-GT" read as "G-GT" and "HOMOCISTEÍNA" as "HOMO CISTEÍNA".

What it settled:

- **Reading is good, boxes are the weak point.** Values and pages were as good as Gemini's on
  these two documents. Boxes on the scanned document land about 2% of the page off the value,
  on the right line, which fails IoU 0.5 on short text; whether that matters for the UI is a
  question the harness can answer once IoU is reported next to a looser measure.
- **Qwen's box convention is `bbox_2d` as `[x1, y1, x2, y2]` on 0-1000.** Asked for Gemini's
  `box_2d` as `[ymin, xmin, ymax, xmax]`, it complied with the order but the vertical
  positions were invented (no box overlapped its value). Asked in its own convention, a bare
  grounding prompt placed every value correctly. So the request uses Qwen's convention and
  the box adapter converts it.
- **Schema-constrained decoding hurts the boxes.** With `response_format: json_schema` the
  values were identical but the boxes far worse (median IoU about 0.15 against 0.55 on
  `synth-000000`). Without it, with the schema in the prompt, the reply was still valid JSON
  matching the schema. Proposed for step 2: no constrained decoding for this provider; the
  reply is parsed and validated as now, and a non-conforming reply is retried.
- **Time:** about a minute per page on this APU, almost all of it prompt processing, so 200
  documents take some hours, against 9 s per document for Gemini. A four-page document needs
  a context of 32k tokens; LM Studio was loaded with `--context-length 32768`.
- LM Studio also has Gemma 4 26B-A4B with vision; a candidate for a later comparison.

**Step 2 done on 2026-10-26: the local provider in the extractor.** `EXTRACTOR_PROVIDER`
(`gemini` by default until measured), `--provider` in `npm run extract`, and a `provider` field
in `POST /api/extract`. Pages are rendered with pdf.js and a native canvas, both from npm, so
no system tool is needed (`web/src/lib/extractor/render.ts`); the call is in `local.ts`; the box
convention in `response-schema.ts` (`QWEN_BOXES`, `toLayer1`). Gemini's instruction and schema
are byte-identical to before, and Qwen's to the ones of the manual check. Described in
`docs/extractor-contract.md`.

Two things the first end-to-end run showed, both handled at the boundary: without constrained
decoding Qwen writes an absent field as a bare `null` (read as absent), and a reply with boxes
under Gemini's key must be rejected rather than read, since their order is unknown.

Smoke run on the same two documents, scored by the harness (`data/runs/smoke-local-step2`):
fields 23 of 23 right with 0 of 3 nulls invented; tests 29 of 30 right (exact list in 1 of 2;
"Γ-GT" read as "G-GT"); boxes 12 of 52 at IoU ≥ 0.5, median 0.17 (0.56 on the clean page,
poor on the scanned one); 108 s per document, 9.0k tokens in and 1.7k out. The same request
through the API route took 55 s.

**Step 3 done on 2026-10-26: the 200 documents with local Qwen.** Seed 42 as regenerated
(golden version 3), prompt v4, `page-images` at 150 dpi, run
`20261026-qwen3.6-35b-a3b-p4`, scored by the harness:

| Measure | Result |
|---|---|
| Documents | 198 evaluated, **2 failed** (`schema_mismatch`), 0 rejected |
| Fields | 2,025 correct, 9 wrong, 0 missed; precision 97.2%, recall 99.6% |
| Invented values | **50 of 540** golden nulls (9.3%) |
| Requested tests | P 99.5%, R 99.5%; exact list in 189 of 198 documents |
| Boxes located at IoU ≥ 0.5 | 934 of 3,601 (25.9%), median IoU 0.21; 6 on a wrong page |
| Handwritten values | 96 of 100 correct |
| Cost | 84 s per document, about 4.7 hours in all; 1.88M tokens in and 0.24M out; no money, nothing sent out |

Not yet comparable with Gemini: its last full run (2026-10-22) was on the dataset before the
regeneration, which is what step 4 is for. For orientation only, that run had precision 99.8%,
no invented value of 561 and 99.2% of boxes located.

What the mistakes are, from the mismatch list:

1. **The centre taken for the insurer** (30 of the 50 inventions). On forms with no insurer,
   `NombreMutua` came back as the hospital or laboratory that issued the form, every time a
   centre name; 29 of them on the `hospital-compact` template.
2. **"U" for a sex that is not printed** (11 inventions), plus 4 cases of H or M with no sex on
   the form. The prompt says U means "unknown or other", which the model reads as "not
   stated"; the rule is null when absent. Also 3 sexes wrong (two M read as H, one H as U).
3. **An authorisation-like number as the insurer's request number** (5 inventions,
   `NumeroSolicitudMutua`, such as `AUT61827874`).
4. **Γ read as G** in "Γ-GT" (5 documents, once as "I-GT"), the commonest test miss; the rest
   are single-letter slips ("PORFINAS", "antiacuporina") and one profile heading listed as a
   test.
5. **Digit and letter slips** in 7 values: card and phone numbers with one digit changed or
   dropped, "Isodoro" for "Isidoro", "INIELA" for "INIESTA".
6. **The two failures:** `Sexo` written as something other than an item in both attempts (the
   raw reply is not kept, so the exact form is unknown).

**Boxes, with a looser measure.** IoU 0.5 is strict for short text, so the centres were also
checked ad hoc against the golden boxes (3,555 pairs on the right page): the centre falls
inside the value's box in 42.7%, on the same line in 63.9%, and is 1.7% of the page away at the
median (6.5% at the 90th percentile). Roughly one box in three is off the line; for the UI
that means highlighting would often point at the wrong place.

**Reading of the result.** Values are close to usable: 99.6% recall, and the wrong ones are
the kind the fusion engine catches against the LIS. The inventions are the weak point, and they
are concentrated: two prompt rules (an insurer is never the issuing centre; an unprinted sex
is null, U only when the form says so) would address 41 of the 50, but changing the prompt
means a new prompt version and a new run for both models. Boxes are far behind Gemini's.

**Step 4 done on 2026-10-26: Gemini on the same 200 documents, and the comparison.** Run
`20261026-gemini-3.8-flash-p4` (prompt v4, `pdf-inline`, thinking `low`), and the Qwen run
scored against it with `--baseline` (`eval-vs-gemini` in the Qwen run):

| Measure | Gemini 3.8 Flash | Local Qwen3.6-35B-A3B |
|---|---|---|
| Documents failed | 0 of 200 | 2 of 200 |
| Field precision / recall | 99.9% / 99.9% | 97.2% / 99.6% |
| Wrong values | 2 | 9 |
| **Invented values** | **0 of 550** | **50 of 540** |
| Requested tests, F1 | 99.6% | 99.5% |
| Exact test list | 195 of 200 | 189 of 198 |
| Handwritten values | 99 of 100 | 96 of 100 |
| Boxes located at IoU ≥ 0.5 | **98.7%**, median IoU 0.76 | **25.9%**, median IoU 0.21 |
| Time per document | 9.4 s | 84 s |
| Cost of the 200 | about 1.2 USD | none; nothing leaves the machine |

On the 198 documents both read, Qwen fixed 15 of Gemini's mistakes and broke 74 of its right
answers. Most of the 15 are one document: in `synth-000032` Gemini corrupted every accented
Catalan letter ("sèrum" as "s crum", "Mútua" as "M atua"), which Qwen read correctly. That is
a **new form of Gemini's garbled text that the boundary does not catch**: a space and a wrong
letter in place of the accented one. The six replies retried for the forms it does catch
recovered.

**Verdict.** Gemini stays the default for extraction: it is better on every quality measure,
and on boxes by far, which the verification UI depends on. Local Qwen reads values nearly as
well (recall 99.6% against 99.9%), but invents where a field is absent and places boxes too
loosely to highlight them reliably; at about nine times the time. Its case is privacy: a
demo on real documents from this machine sends nothing out.

Proposed after the comparison; all four approved by the product owner on 2026-10-26 and done
the same night (next part):

1. **Prompt v5 with two rules**: the insurer is never the centre that issues the form, and a
   sex that is not printed is null, U only when the form says unknown or other. Aimed at 41 of
   Qwen's 50 inventions; both models rerun on v5 (about 1.2 USD and 5 hours).
2. **Catch the new garbled form at the boundary**, flagged and retried like the others, with
   a test built from `synth-000032`. No model call needed to build it.
3. **Keep the raw reply in the prediction** (or beside it), since the two Qwen failures could
   not be diagnosed without it.
4. **Boxes for the local model** are the open problem. Options to measure: a second, short
   grounding call per value, which placed every value correctly in the manual check;
   rendering at a higher resolution; or Gemma 4, the other vision model in LM Studio.

**The four proposals, done on 2026-10-26 and 27.** One commit each:

- **Raw replies kept** (`484f468`): every reply of every attempt is written beside its
  prediction as `<id>.raw.json`, before parsing. It diagnosed the next point within minutes.
- **The new garbled form caught** (`ab4930e`): a lone consonant between two words ("s crum")
  is flagged as garbled text and the reply retried, like the forms already caught.
- **Prompt v5** (`4f83215`) with the two rules. Qwen's inventions fell from 50 to 1, but it
  now missed the insurer on 9 forms where the insurer's name is the letterhead of its own form,
  reading it as the issuing centre; and 4 documents failed because Qwen wrote `Sexo` as a bare
  `"M"` instead of an item (seen in the raw replies, deterministic).
- **Prompt v6** (`5b69030`): the insurer is often the letterhead of its own form, never the
  centre where the patient is seen; and a bare string is read at the boundary as a value with
  no page or box, so the field is kept and its box reported as missing.
- **Two box experiments for the local model** (`b46b045`), opt-in flags of `npm run extract`
  recorded in `run.json`: `--dpi` for the render resolution, and `--grounding`, a second call
  per page that asks only to locate the values already read, in the wording of the manual
  check. It only replaces boxes; values are never touched.

**Prompt versions on the 200 documents.**

| Measure | Gemini v4 | Gemini v5 | Gemini v6 | Qwen v4 | Qwen v5 | Qwen v6 |
|---|---|---|---|---|---|---|
| Documents failed | 0 | 0 | 0 | 2 | 4 | **0** |
| Fields correct / wrong / missed | 2,048 / 2 / 0 | 2,050 / 0 / 0 | 2,045 / 5 / 0 | 2,025 / 9 / 0 | 1,995 / 8 / 10 | 2,042 / 7 / 1 |
| Precision / recall | 99.9 / 99.9 | 100 / 100 | 99.8 / 99.8 | 97.2 / 99.6 | 99.6 / 99.1 | **99.5 / 99.6** |
| Invented values | 0 | 0 | 0 | 50 | 1 | **3** |
| Tests F1 | 99.6 | 99.7 | 99.7 | 99.5 | 99.5 | 99.4 |
| Boxes at IoU ≥ 0.5 | 98.7% | 98.7% | 99.4% | 25.9% | 26.3% | 26.0% |
| Time per document | 9.4 s | 8.5 s | 8.7 s | 84 s | 86 s | 84 s |

Runs `20261026-<model>-p<version>` in `data/runs`, each scored with `--baseline` against the
one before.

- **Qwen v6 against v4:** 50 values fixed, 4 broken, 47 fewer inventions, no failures. The
  insurer is now right on all 149 forms that print one. What remains: 2 authorisation-like
  numbers given as the insurer's request number (`synth-000034`, `-000068`), a sex on 3
  documents, "Γ-GT" read as "G-GT" (5 documents), and single digit or letter slips.
- **Gemini v6 against v5:** 7 fixed and 12 broken, with no rule aimed at the broken ones: a
  digit dropped in two values, one garbled `%` that the boundary flagged. Differences of this
  size between two runs are noise, not an effect of the prompt.
- **Qwen v6 against Gemini v6**, on the same 200: values almost level (3 inventions against
  0; 2,042 correct against 2,045; tests 99.4% against 99.7%); boxes still far apart (26%
  against 99%).

**Box experiments, on the first 20 documents** (`20261027-qwen3.6-35b-a3b-p6-grounding` and
`-dpi200`, against the same 20 of the Qwen v6 run):

| Measure | Qwen v6 | + 200 dpi | + grounding | Gemini v6 |
|---|---|---|---|---|
| Boxes at IoU ≥ 0.5 | 23.3% (87 of 373) | 27.0% | **51.7%** (193) | 99.5% |
| Median IoU | 0.19 | 0.26 | **0.52** | 0.78 |
| Fields / tests at IoU ≥ 0.5 | 30% / 15% | 35% / 17% | 62% / 39% | — |
| Centre inside the value's box | 38.5% | 43.2% | **64.8%** | 100% |
| Centre on the value's line | 42.8% | 49.3% | 68.5% | 100% |
| Median centre distance | 1.9% of the page | 1.5% | **0.8%** | 0.1% |
| Time per document | 83 s | 122 s | 175 s | 8.7 s |
| Values | — | same | same | — |

The centre measures are computed ad hoc, as in step 3. The one value that changed in both
experiments (the sex of `synth-000006`, M read as H) cannot come from grounding, which never
touches values: the local model at temperature 0 is not fully repeatable from run to run.

**Reading.** Grounding more than doubles the boxes that land on their value, at about twice
the time; it does more for fields than for tests, which are long lists of short texts. A
higher resolution alone adds little. Neither brings the local model near Gemini's boxes: with
grounding, one value in three would still be highlighted in the wrong place.

**Verdict.** Gemini stays the default. Local Qwen on prompt v6 now reads values about as well
as Gemini, so its case for privacy holds on values; for the boxes the UI depends on, it is not
yet good enough.

Proposed after the experiments; the product owner's answers of 2026-10-27 are in the next part:

1. **Grounding on by default for the local provider**, and the 200 documents rerun with it
   (about 10 hours on this machine) to confirm the 20-document result.
2. **The verification UI tolerates a loose box**: for the local model, highlight the line or a
   margin around the box instead of the exact rectangle, and say the box is approximate. A
   design question for F5, not the extractor.
3. **Gemma 4 26B-A4B** on the same 20 documents, the comparison proposed earlier and not run.
4. **"Γ-GT" read as "G-GT"** is left to the test mapping (F4), which matches candidates by
   trigrams and should land on the same code; to be checked there rather than in the prompt.

**Decisions of 2026-10-27.** Instead of grounding (1), the product owner proposed locating the
values with a plain OCR of the page, matching texts by similarity and distance; to be looked at
first, and the UI question (2) after it. Gemma 4 (3) approved, not started. "Γ-GT" left to the
test mapping (4): approved.

**OCR boxes, measured on 2026-10-27.** A prototype, outside the repository, that rewrites only
the boxes of an existing run, so the 200 Qwen v6 predictions were reused without calling the
model again:

1. Each page rendered at 300 dpi and read by Tesseract (tesseract.js 7, WebAssembly from npm,
   Spanish and Catalan data from npm too: no system tool, nothing downloaded at run time).
2. For each value the model read: every run of consecutive words on an OCR line, compared with
   the value on letters and digits only (accents, case, spaces and punctuation ignored), by
   edit distance. Score = similarity − 2 × distance from the model's own box centre. The best
   run with similarity ≥ 0.7 gives the box.
3. Values of three characters or fewer ("TSH", "37", "M") must match exactly and lie within 15%
   of the page of the model's box, since they occur everywhere.
4. The normalised fields are also looked for as printed: a date as `1985-05-09` or
   `01-maig-1971`, sex as "Mujer", "Home", "Dona", "[X] Masculí", the doctor with "Dr." or "Dra.".
5. The model's page first; when nothing matches there, the other pages without the distance
   term. No match anywhere: the model's box stays.

Tuned on the first 20 documents (23% → 85% on the first try, 92% after points 3 to 5), then run
once on all 200:

| Measure | Qwen v6 | **Qwen v6 + OCR boxes** | Gemini v6 |
|---|---|---|---|
| Boxes at IoU ≥ 0.5, 200 documents | 26.0% | **92.4%** (3,356 of 3,632) | 99.4% |
| The 180 not used for tuning | 26.4% | **92.5%** | — |
| Median IoU | 0.20 | **0.77** | 0.76 |
| Fields / tests at IoU ≥ 0.5 | — | 93.9% / 90.5% | — |
| Scanned / clean / handwritten (fields) | 36% / 29% / 26% | 92.5% / 95.5% / 91.6% | 99.4% / 99.9% / 99.0% |
| Centre inside the value's box | 41.7% | **91.6%** | 99.6% |
| Values | — | unchanged (0 flipped) | — |
| Added time | — | about 1.3 s per document on 8 CPU workers | — |

What is still missed: short tests on scanned pages that the OCR did not read at all, a few
dates in a format not listed, a value printed twice with the near one taken, and pages the
model got wrong where the OCR also missed the value. The synthetic handwriting is a script
font; real handwriting will be harder for Tesseract, and there the model's box stays.

**Reading.** Better than grounding (52%) at about a hundredth of its time, and it needs no
model call: the model reads, the OCR places. It also fits the project's stance: the box is
evidence from a second source, not the model's word.

**OCR boxes in the extractor: approved on 2026-10-27 and done.** As proposed, with two
changes found while building it:

- `ocr.ts` (pages to words with tesseract.js 7.0.0, a pool of worker threads shared by every
  call) and `locate.ts` (the matching), described in `docs/extractor-contract.md`, "Boxes from
  the OCR". On by default for the local provider; `--ocr-boxes` and `--no-ocr-boxes` in
  `npm run extract`; `npm run relocate` rewrites the boxes of an existing run without calling
  the model.
- **Spanish data only**, not Spanish and Catalan: matching ignores accents, and Catalan added
  nothing measurable (3,356 against 3,351 boxes of 3,632). One npm package less, and no copy
  of the language files, which tesseract.js 7 would need for two packages.
- `schema/fields.json` version 4: `printed` lists the month names of a date and the words of
  each sex. The doctor's titles needed no list: the `no-title` rule the boundary already
  applies is reused.
- `box_source` (`model` or `ocr`) on every predicted box, optional in the schema so that older
  predictions stay valid; the prediction version is unchanged. A warning `ocr_failed` keeps
  the model's boxes if the OCR fails.
- Grounding stays an experiment flag.

Measured on the 200 documents, values untouched (0 flipped):

| Run | Boxes at IoU ≥ 0.5 | Median IoU | Time added |
|---|---|---|---|
| Qwen v6 | 26.0% | 0.20 | — |
| **Qwen v6 + OCR boxes** (`20261026-qwen3.6-35b-a3b-p6-ocr`) | **92.5%** (3,360 of 3,632) | 0.77 | 1.0 s per document on 8 CPU workers |
| Gemini v6 | 99.4% | 0.76 | — |
| Gemini v6 + OCR boxes (`20261026-gemini-3.8-flash-p6-ocr`) | 97.6% (3,549 of 3,637) | 0.77 | 1.0 s per document |

The OCR makes Gemini's boxes slightly worse (−1.8 points): its own are already better than
what the OCR finds, so OCR boxes stay off by default for Gemini.

**`box_source` is a confidence signal.** In the Qwen run, a box from the OCR is right in
97.2% of cases (3,316 of 3,410) and a box left to the model in 15.6% (33 of 211). For F5
(proposal 2 above): the UI can draw an OCR box as exact and a model box as approximate, and
the operator knows which is which.

Checked end to end: `next build`, and `POST /api/extract` with the local provider on the built
server (14 boxes from the OCR, 2 from the model, no warning).

**Gemma 4 26B-A4B, measured on 2026-10-27** (proposal 3, approved). The QAT build in LM
Studio, same prompt v6, 150 dpi, OCR boxes on, the first 20 documents of `seed-42`.

The manual check came first. Gemma writes Gemini's `box_2d`, `[ymin, xmin, ymax, xmax]` on
0–1000, even when asked for Qwen's `bbox_2d`. Its horizontal positions are right; its vertical
ones read about 10% too high. So a local model named Gemma is now asked in Gemini's convention
(`localBoxes` in `response-schema.ts`). Like Qwen, it writes an absent field as a bare `null`,
so those shorthands are now read for any local model, whatever its convention.

| Run (same 20 documents) | Qwen 3.6 35B-A3B + OCR | Gemma 4 26B-A4B + OCR (`20261027-gemma-4-26b-a4b-p6`) |
|---|---|---|
| Documents read | 20 of 20 | 19 of 20 (1 invalid JSON, both attempts) |
| Fields precision / recall | 99.5% / 99.5% | 97.9% / 97.4% |
| Invented | 0 of 54 | 0 of 51 |
| Tests P / R / F1 | 99.4% / 99.4% / 99.4% | 98.6% / 93.9% / 96.2% |
| Exact test list | 19 of 20 | 15 of 19 |
| Boxes at IoU ≥ 0.5 | 91.2% (341 of 374) | 87.2% (287 of 329) |
| Time per document | 83 s | 80 s |

Gemma's errors:

- **Tests left out at the end of the list.** 8 tests on 3 documents, among them the last 4 of
  a four-page document and both tests of a second column.
- **Two test lines merged into one.**
- **Two birth dates written as `yyyy-mm-dd`.** The `pattern_mismatch` warning caught both.
- **One digit dropped from a request number.**
- **One typo:** "Activitad".
- **One sex wrong and one telephone missed.**
- **One reply had missing `{` before items**, in both attempts.

On the failed document it also kept the "- " list bullets in front of the tests.

**Verdict:** Gemma is no faster on this machine and is less accurate on every count, so Qwen
stays the local model. The 200-document run is not worth doing. The change of convention
stays, so Gemma can still be selected with `LOCAL_LLM_MODEL`.

### 4. F4: mock LIS, fusion engine and test mapping (approved)

**Status: proposed and approved on 2026-10-23, with every decision settled (at the end).
Blocks 1 to 6 are done (below).**

F4 as described in `CLAUDE.md` covers the demographic fields: a synthetic LIS and the traffic
light. This proposal adds a third part, at the product owner's request on 2026-10-23, and it
is the one that carries most of the product's value: **mapping each requested test to the
lab's own test codes.**

The problem it solves: a lab works with many insurers, each with its own request form and its
own wording. One insurer writes "HbA1c", another "Hb glicada", a third "Hemoglobina
glicosilada"; all three are one code in the lab's catalog. A requested profile ("Perfil
hepático") is entered in the lab as several separate codes, and its contents may differ
between insurers. Today an operator does this mapping from memory. The extractor already reads
the text at about 99.9%; knowing which codes that text means is the missing step.

The design keeps the project's stance. Extraction still returns the exact printed text;
mapping is a separate step after it, so a reading error and a mapping error can be measured
apart. A mapping is green only when people have confirmed it before; anything the model
proposes is at most orange.

**Nothing is accepted without a technician's approval.** A product requirement stated by the
product owner on 2026-10-23, for health and European regulatory reasons: no test, and no
field, is taken as valid without the technician who processes the request verifying it. The
system shows what was read, what it proposes from that, and why; a technician approves. Green
therefore never means "accepted": it means "proposed, with strong evidence", and it is still
pending until approved. Every state in this proposal is a signal to the technician, never a
decision. The approval is an explicit action, recorded with who approved, when, and exactly
which values and codes were approved, so the record shows that a person took each decision.

#### A. Generator v2: catalog, insurer dialects and LIS population

**Lab catalog.** Synthetic and invented, around 2,000 codes, so that the size matches a real
lab catalog (thousands of tests) without copying any. Built by combination: analyte × specimen
(serum, plasma, whole blood, spot urine, 24 h urine, CSF, stool) × variant (basal or after a
load, free or total, qualitative or quantitative). This produces exactly the near-duplicates
that make mapping hard: "Glucosa" in serum against glucose in urine or after a load. Each
entry has a code in an invented format, a canonical name, a specimen and synonyms. The lab
also has its own profiles, each a named set of codes. Requests follow a skewed frequency: a
few hundred common tests make up most lines, the rest is a long tail.

**Insurer dialects.** Each insurer gets its own wording for every test, drawn from
transformation rules: abbreviations (GOT, AST, ASAT), word order ("Colesterol HDL",
"HDL-colesterol"), specimen words added or left out, casing, and its own profile names with
**its own composition** (one insurer's hepatic profile has five tests, another's four).
That last rule produces, without having to guess, cases where the same text means different
codes depending on the insurer. Documents without an insurer use a generic dialect.

**Catalan forms** (added by the product owner on 2026-10-23, after block 1). The lab works
with insurers in Catalonia: some print their forms in Spanish, others in Catalan. Language
is a property of each insurer: three of the seven fictional insurers are Catalan and their
documents are **entirely in Catalan** (labels, sex as Home/Dona, months, the authorisation
letter, and the tests: "Àcid úric", "Urinocultiu", "Hemograma complet", "en sèrum"). The
lab catalog **stays in Spanish only**, like a typical LIS, so mapping has to cross the
language; that is the hard case worth measuring, and approved mappings learn it. Two
consequences for the extractor: the garbled-text check must accept the Catalan middle dot
between two l's ("pol·len", "cèl·lules"), which it currently flags; and the prompt's sex rule
must read Home, Dona and a bare D (prompt v4), measured in the block 6 run.

**Done on 2026-10-23**, as part of block 1. Garbí Salut Mútua, Serralada Assegurances
Mèdiques and Rosada Salut Assegurances (fictional, replacing three Spanish names) print in
Catalan. The recorder translates every fixed text of a Catalan document; the identity card
stays in Spanish. Test names go through a vocabulary of the catalog's terms, with elision
("Sistemàtic d'orina") and the middle dot ("Pol·len d'olivera"). The garbled-text check
accepts `l·l` and still flags a middle dot anywhere else; prompt v4 is written, not yet run.
In the regenerated seed-42 dataset, 60 of 200 documents and 400 of 1,578 test lines are
Catalan; only 2 lines have an `l·l`.

**Golden.** Each entry of `tests[]` gains `codes`: the list of lab codes it means, one for a
single test, several for a profile. Golden format version bumped.

**LIS population.** Patients, physicians and insurers generated once per seed, and documents
draw patients from that population, so some patients come back. Each document is assigned a
scenario at a configurable rate, recorded in the golden so results can be sliced by it:

| Scenario | Example |
|---|---|
| match | patient in the LIS, everything agrees |
| drift | patient in the LIS, phone changed since |
| form typo | the form has a digit wrong in the identity document |
| new patient | not in the LIS |
| homonym | another LIS patient with the same name and a different birth date |
| unknown physician or insurer | not registered in the LIS |

The generator writes the population as `lis.json` next to the manifest. The web app owns the
SQLite schema through Drizzle and a seed script loads `lis.json` into it, so the schema is
defined in one place.

**Consequence:** every document changes, so the seed-42 dataset is regenerated and the runs
recorded above cannot be compared with new ones. A new baseline full run with Gemini is needed
(about 1.2 USD).

#### B. Fusion engine for the fields

In `web/src/lib/fusion/`, pure functions over a prediction and the LIS.

**Finding the record.** The patient is linked automatically only on a strong match: the
identity document agrees, and so does the name or the birth date. A single agreeing key, or
keys that point to different patients, gives a candidate that is shown but not applied: the
patient link itself is red and the operator confirms it. A wrong link is worse than none: it
would paint another person's data green. The physician is found by registration number, then
by name; the insurer by name, compared with `casefold`, against the LIS insurers and their
known aliases.

**Each field** gets the traffic light in `CLAUDE.md`, comparing values with the shared compare
modes (`schema/compare-cases.json`), so fusion and evaluation cannot disagree on what "the
same value" means. One addition: an AI-only value that carries an extractor warning
(`garbled_text`, `pattern_mismatch`) is red, not orange. `Edad` has no LIS column; it stays
AI-only.

**Provenance**, per field: the AI value with its page, box and warnings; the LIS value with
its record id; the final value and its source (`lis`, `ai`, `default`, `operator`); the state
and a reason code; and a history of who changed what and when.

**Configuration** stays in `schema/fields.json` (version 3): per field, the LIS column it maps
to and a `default` (null for every field in v1; the mechanism exists for the third source).

#### C. Test mapping

In `web/src/lib/mapping/`. Input: each extracted test line plus the **whole extraction of the
document** as context (insurer, template, the other tests, the physician). Output per line:
the codes, the state, the source and the candidates that were considered.

Layers, in order of confidence:

1. **Confirmed mappings.** A table keyed by (insurer, normalised text) → codes, with how many
   times technicians approved it and how many times they corrected it. The insurer is the LIS
   insurer the document was linked to, not the raw text, so a spelling variant of its name
   still finds its mappings. Enough approvals and no contradiction → **green**, with an
   explanation ("approved 14 times for this insurer"), and still pending this request's
   approval. The same text approved for other insurers is only a suggestion → orange. Conflicting approvals → red, with both options.
2. **Catalog search.** Lexical candidates from catalog names, synonyms and lab profiles
   (SQLite FTS5 or trigram similarity), top 20. The catalog is too large to send whole to the
   model on every document, and a search can be measured on its own (recall@k).
3. **Model choice.** A language model receives the line, the document context and the
   candidates, and returns codes **constrained to that candidate list**, or none: it cannot
   invent a code. One call per document for every line the first layer did not settle.
   Result: **orange**. Revised on 2026-10-23 (block 5 below): the model is selectable,
   Gemini or the local Qwen, and comes after a local embedding search, only if that search
   leaves problems the measurements show.
4. **Nothing clear, or a tie → red.** The operator picks from a catalog search.

**Approval.** Mapping proposes; it never accepts. Every line, green included, waits for the
technician's approval (see the requirement at the top of this section and decision 9).

**Learning.** Only approved requests feed layer 1, never a proposal on its own: an approved
line adds to the count, a correction records the contradiction. Approvals of lines that were
shown green are counted apart from lines the technician resolved actively (picked or changed
the codes), because a person approving a green line may be trusting the colour rather than
checking it. Green needs actively resolved evidence, so a mapping cannot confirm itself
only through its own green approvals. As mappings accumulate, more lines are green and fewer
need the model, so the cost per document falls with use. That is the learning this proposal
offers first: a memory of human decisions, scoped per insurer, explainable and useful from the
first document. A trained model could come later, when there is data to train it, and the
harness would say whether it beats the table. Semantic search with embeddings was to be
added only if lexical recall@k turned out too low; block 5, revised, tries it first anyway,
for ordering candidates rather than finding them.

#### D. Measurement

The harness grows with F4, as it did for the extractor. Mapping outputs are written as JSON
per document by a TypeScript batch script, like `extract-batch.ts`, and scored in Python.

- **Fusion**: per field, the state against the one the scenario implies. Key figures: values
  wrong and green (target: zero), patients linked to the wrong record (target: zero),
  discrepancies caught as red. Needs no Gemini call: it can run on the golden used as a
  perfect prediction, and on recorded runs. Cheap enough for every commit.
- **Mapping**, twice: from the golden text (mapping errors alone) and from the predicted text
  (end to end). Per line, exact, partial or wrong code set; per state, how many lines and how
  many of them wrong. Key figure: **wrong codes in green**. Also the search's recall@20.
- **Learning curve**: the documents of each insurer in order, with a simulated operator who
  approves or corrects with the golden codes. The technician's work after 1, 10 and 50
  documents (lines only to review and approve against lines to correct) and the green errors, and the same with an operator who makes mistakes 2% of the
  time, to see whether a wrong confirmation spreads. This chart is the piece a reader of the
  portfolio remembers.

#### Blocks

1. Generator v2: catalog, dialects and `codes` in the golden. **Done on 2026-10-23**
   (generator 0.3.0, golden version 2, `catalog.json`; described in `docs/golden-format.md`).
   One departure from A: the catalog has **726 tests**, not about 2,000. Built only from real
   generic terminology (analytes by specimen, serology, autoimmunity, about 150 allergens,
   cultures by site, drug levels, genetics), that is where it ends; reaching 2,000 would take
   invented names, which would make the long tail unrealistic. 726 is still large enough that
   sending the whole catalog with every document costs about 10k input tokens, so the
   candidate search stays. The seed-42 dataset was regenerated: 1,578 test lines, 33 of them
   profiles requested as one line (several codes) and 207 from the long tail. Every dialect
   name of three seeds (7,406) passes the extractor's garbled-text check unflagged. With
   about 20 documents per insurer, the learning curve of block 4 will need a larger dataset;
   generating one costs no API call.
2. Generator v2: LIS population and scenarios; Drizzle schema and seed script. **Done on
   2026-10-23** (golden version 3, `lis.json`; described in `docs/golden-format.md`). The LIS
   has 415 patients (15 namesake pairs), 60 physicians and 6 of the 7 insurers. In seed 42:
   92 match, 28 drift, 22 form typos (14 in the birth date, 8 in the ID), 33 new patients
   and 25 homonyms; 118 distinct LIS patients, up to 5 documents each; 30 unknown physicians
   and 19 documents of the unregistered insurer. The web app owns the schema
   (`web/src/lib/lis/schema.ts`, migrations in `web/drizzle/`) and `npm run seed-lis` loads
   `lis.json` into `data/lis/seed-42.sqlite` through libSQL, which also leaves a hosted
   SQLite open for decision 8. Physicians' titles now follow their sex, which fixes "Dra."
   printed for some men. For block 3, two things the data already shows: forms print phones
   with `+34` while the LIS keeps nine digits, and patient names in "SURNAMES, NAME" order,
   so neither compares as is.
3. Fusion engine with provenance, and its scoring. **Done on 2026-10-23.** Two compare modes
   for comparing with the LIS (`phone`, which drops +34, and `person_name`, word order and
   commas ignored); `fields.json` v3 names each field's LIS value, compare mode and default;
   the engine in `web/src/lib/fusion`; `npm run fuse` and `intake-synth evaluate-fusion`
   (`docs/evaluation.md`, "Fusion"). Two details beyond B: an insurer's aliases count as its
   name, and a physician without a registration number on the form is linked on a unique
   name, since physicians have no namesakes in practice.

   **Measured** with every golden as a perfect prediction (seed 42, 200 documents): no wrong
   link, no wrong green value, all 50 planted disagreements red and no red conflict without
   one. Patients: 146 linked, 21 offered as candidates (the 8 identity-document typos and the
   13 forms without one, all the right record) and 33 rightly without record. Fields: 1,161
   green, 937 orange, 57 red, 445 grey. This is the engine without reading errors, so it only
   shows that the rules do what they say; how it behaves when the AI misreads is measured by
   fusing the block 6 run.
4. Mapping layers 1, 2 and 4, recall@k, and the learning-curve simulation without the model.
   **Done on 2026-10-23.** The catalog (format version 2, which marks each test's usual
   specimen; codes unchanged) and a `mapping_memory` table join the LIS database; the engine
   is in `web/src/lib/mapping`; `npm run map-simulate` and `intake-synth evaluate-mapping`
   (`docs/evaluation.md`, "Test mapping"). A dataset of 1,000 documents
   (`data/synth/seed-42-n1000`, whose first 200 are byte-identical to seed-42's) gives every
   insurer 80 to 140 requests.

   **Measured** on the 1,000 documents, 8,329 lines, perfect technician:

   | Request k of its insurer | 1 | 2-5 | 6-10 | 11-25 | 26-50 | 51-100 | 101+ |
   |---|---|---|---|---|---|---|---|
   | Green, all | 0% | 4% | 20% | 52% | 70% | 81% | 88% |
   | Work, Spanish insurers | 4% | 1% | 0% | 2% | 2% | 1% | 0.5% |
   | Work, Catalan insurers | 19% | 22% | 14% | 5% | 4% | 3% | 3% |

   No line came out green with wrong codes. Proposals: memory 6,743 of 6,743 right, other
   insurers' memory 361 of 373, search 1,039 of 1,064. The search has the right codes among
   its 20 candidates for 99.2% of Spanish lines and 98.7% of Catalan ones, but only for 152
   of the 225 profiles requested as one line: insurers compose profiles their own way, which
   only the memory learns. Catalan insurers start with five times the work and catch up by
   their 11th to 25th request, which is the learning the design was for. The plateau below
   100% is the long tail: a test an insurer requests once or twice never reaches green.

   **With a technician who errs.** At 2% the run is almost unchanged (one wrong orange
   proposal, no wrong green): the technician acts on so few lines that 2% is a handful of
   mistakes. As a stress test at 20%, 83 wrong actions led to 14 wrong green lines: a wrong
   meaning turns green only after two independent mistakes on the same line, so the
   two-approval rule bounds the spread at about the square of the error rate.

   **Caveats.** The synthetic dialects are built from the catalog's own synonyms plus
   spelling rules, so lexical search finds them more easily than real insurers' wording; the
   recall and search precision above are optimistic. The thresholds (2 approvals, 0.55 and
   0.05) are first choices, not tuned; `lines.jsonl` keeps each line's top score and lead so
   that they can be.
5. **Revised on 2026-10-23, approved by the product owner:** compare ways of choosing among
   candidates on the same harness, cheapest first, and keep only what beats what came before.
   Block 4 already finds the right codes among the 20 candidates for 99% of lines, so the
   open problem is **choosing** (search proposals are right 97.6% of the time; about 150
   lines stay red) and **profiles** (recall only 68%, since insurers compose them their own
   way), not finding.

   - **5a. Local embeddings.** A small multilingual sentence-embedding model run in Node
     (transformers.js with ONNX weights, a few hundred MB downloaded once; no server, no API,
     nothing leaves the machine, the same answer every time). Used to rank the catalog for a
     line, alone and combined with the trigram score. It should help where meaning differs
     from spelling, Catalan against a Spanish catalog above all. It cannot compose a profile
     or use the rest of the document.
   - **5b. A language model that chooses**, only if 5a leaves problems worth the cost. It
     receives the lines the memory did not settle, the document's context (insurer,
     language, the other requested tests) and each line's candidates, and returns codes from
     those candidates or none, as a JSON schema with the candidate codes as an enum. For a
     line that looks like a lab profile, the profile's components join the candidates so
     that the model can compose the insurer's version. **The provider is selectable**: Gemini
     (the SDK the extractor uses) or the **local Qwen** served by LM Studio's
     OpenAI-compatible API on `127.0.0.1:1234` (Qwen3.6-35B-A3B, text only here, so the
     image check of the local-model track above does not apply). Chosen by environment
     variable, overridable per run. No patient data is sent: only test lines, the insurer
     and the catalog candidates. Responses are cached by request, so repeated simulations
     cost nothing.

   Measured with `map-simulate` on the same 1,000 documents against block 4: the
   technician's work along the learning curve, precision of each layer on the same lines,
   wrong green lines (still 0), calls, tokens, cost and latency per document, and how the
   calls fall as the memory fills. For 5b, both providers, and two policies: the model on
   every line the memory does not settle, or only where the search is unsure (red lines).
   The local model on an APU is expected to be slow (prompt processing of a few thousand
   tokens per call); its latency is part of the result.

   **5a done on 2026-10-23: local embeddings measured and not adopted.** Model
   `Xenova/multilingual-e5-small` (q8, about 130 MB in `data/models`), run with
   transformers.js, vectors cached in `data/embeddings`; three searches compared on the
   1,586 distinct (insurer, line) pairs of the 1,000 documents, which are the lines that
   reach the search once the memory is in place (`npm run search-compare`,
   `intake-synth evaluate-search`, `docs/evaluation.md`):

   | Search | Right first | Right among 20 | Profiles among 20 | ms per line |
   |---|---|---|---|---|
   | trigrams (block 4) | 94.3% | 97.5% | 60.5% | 1 |
   | embeddings | 92.0% | 97.8% | 65.8% | 7 |
   | mean of both | 94.8% | 97.5% | 60.5% | 3 |

   Compared at matched precision with thresholds chosen on all the lines, the mean gained
   about one point of coverage. That gain was the thresholds fitting the data they were
   measured on: chosen on the first half and measured on the second, neither the mean nor
   tuned trigrams beat block 4's own point (88% of lines proposed at about 96.9% precision on
   that half), and embeddings alone propose far fewer lines (68%). The trigram thresholds
   chosen this way for 99.5% land on block 4's guess (0.56 and 0.05 against 0.55 and 0.05).
   End to end, replaying the 1,000 documents: technician work 2.2% with trigrams, 2.3% with
   the mean, 4.8% with embeddings alone; no wrong green line in any. The embedding search
   stays in the code as measured tooling (`web/src/lib/mapping/embeddings.ts`,
   `--search` in `map-simulate`), not in the product's proposals, and transformers.js is a
   development dependency.

   What it says for 5b: the search is not where the remaining work is. Of the 2.2%, about
   150 lines per 1,000 documents are red and 35 proposals are wrong (25 from the search, 12
   from other insurers' memory), with profiles as the hardest case. That is the room a
   model has to earn its cost. Two observations from the split: the second half of the
   lines is harder than the first (more long-tail tests), so a precision chosen on early
   requests does not hold on later ones; and the synthetic dialects, built from the
   catalog's own synonyms, flatter lexical search, so a real-data rerun could rank the
   methods differently.
   **5b done on 2026-10-23: the model layer, measured and adopted, red lines only.** Code in
   `web/src/lib/mapping/model.ts` (prompt, a JSON schema with each line's candidate codes as
   an enum, components added for profile candidates among the first five, a disk cache of
   replies) and `document.ts` (`proposeDocument`, one model call per document);
   `map-simulate --model gemini|local --policy red|all`. Local Qwen3.6-35B-A3B through LM
   Studio's server, with `reasoning_effort: "none"`: with reasoning on, the first manual
   check took 63 s for the same answer it gave in 3.7 s without. Same 1,000 documents,
   perfect technician:

   | Variant | Technician work | Red lines | Model right | Calls per 100 documents | Tokens in / out | ms per call |
   |---|---|---|---|---|---|---|
   | block 4, no model | 2.2% | 149 | – | 0 | – | – |
   | Gemini, red lines only | **0.8%** | 11 | 121 of 138 (87.7%) | 11.6 | 90k / 10k | 2,900 |
   | Gemini, every unsettled line | **0.6%** | 13 | 1,172 of 1,200 (97.7%) | 55.7 | 627k / 34k | 2,700 |
   | local Qwen, red lines only | **0.9%** | 10 | 107 of 139 (77.0%) | 11.6 | 93k / 4k | 2,600 |
   | local Qwen, every unsettled line | 1.2% | 27 | 1,121 of 1,186 (94.5%) | 55.7 | 647k / 26k | 4,700 |

   No line came out green with wrong codes in any run (the model's answers are orange, and
   the memory turns them green only after two active approvals). The gain is where block 4
   was weakest: Catalan insurers' first requests, where the technician's work falls from
   19-22% to 0-5%, and profiles requested as one line, where the model composes the
   insurer's version (29 of 133 non-green profile lines right under "every line", 11 or 12
   under "red only").

   **Decision taken from the measurement:** the model consults only the lines the memory and
   the search left red. It takes three quarters of the work away with a fifth of the calls
   of the alternative, which saves only 0.2 points more with Gemini and does worse than red
   lines only with local Qwen (Qwen chooses less precisely than the search where the search
   is confident). Gemini is slightly better than local Qwen (0.8% against 0.9%); local Qwen
   costs nothing, sends nothing out of the machine and is as fast on this APU. Both stay
   selectable (`MAPPING_MODEL_PROVIDER`). **Default, decided by the product owner on
   2026-10-23: local Qwen**, with Gemini as the alternative and for the public demo, whose
   server does not run the local model. The caveat of block 4 holds: synthetic dialects
   flatter the search, so on real wording the model may have more to do.

6. Full run with Gemini on the new dataset, and the chain measured end to end. **Done on
   2026-10-27.** The Gemini run on the 200 documents of `seed-42` was made in section 3
   (prompt v6), together with local Qwen's (v6, OCR boxes); here both are fused and mapped
   as the product chains them.

   **New measures in the harness:**
   - `evaluate-fusion` tallies the **wrong** and **missing proposed values by state**. Wrong
     green only counts the errors that slip through; reading errors need to be followed to
     the colour they end in.
   - `map-simulate --fusion` maps the lines a run read, with the insurer its fusion linked.
     Each read line is set against the golden's as exact, misread or invented (the
     technician removes it), and golden lines nobody read are listed as unread
     (`docs/evaluation.md`, "End to end, from a real reading").

   **Fusion**, 200 documents:

   | Reading | Wrong links | Wrong green | Wrong values, by state | Misreads caught red by the LIS | Planted disagreements red |
   |---|---|---|---|---|---|
   | golden (perfect) | 0 | 0 | 0 | – | 50 of 50 |
   | Gemini v6 | 0 | 0 | 5: orange 3, red 2 | 0 | 50 of 50 |
   | Qwen v6 + OCR | 0 | 0 | 7: orange 7 | 3 | 49 of 50 |

   **No reading error ended green.**
   - **Gemini:** its two red values are the garbled ones ("Carri%n", "Ib%rica"); the garble
     also left that insurer unlinked. The three orange ones are digits wrong in numbers the
     LIS does not hold (request, insurer's request, telephone of a patient without a record).
   - **Qwen:** three misreads were caught red because the LIS disagreed: "Isodoro" for
     "Isidoro", and two sexes swapped. They show up as the 3 "conflicts with no
     disagreement". Its 7 orange ones are digits wrong in numbers the LIS cannot check, two
     insurer's request numbers it invented, and one document described below.
   - **The weak point (`synth-000186`, Qwen):** the form has a typo in the identity
     document, which the scenario plants, and Qwen also misread the name ("INIELA" for
     "INIESTA"). With neither the identity document nor the name agreeing, the engine found
     no candidate. It offered a new patient, all orange, where a known patient was due.
     Nothing is green, but a technician could create a duplicate patient. Proposal below.

   **Mapping**, the same 200 documents. Simulated technician without errors; the memory
   starts empty and learns as the requests come in. Local Qwen chooses among the candidates
   on red lines, the product's default:

   | Reading | Lines | Green | Orange | Red | Work | Work without the model | Wrong green | Misread / invented / not read |
   |---|---|---|---|---|---|---|---|---|
   | golden (perfect) | 1,601 | 591 | 1,005 | 5 | 1.4% | 4.6% | 0 | – |
   | Gemini v6 | 1,597 | 582 | 1,010 | 5 | 1.5% | 4.7% | 0 | 3 / 0 / 4 |
   | Qwen v6 + OCR | 1,601 | 588 | 1,008 | 5 | 1.5% | 4.7% | 0 | 8 / 1 / 1 |

   - **Reading errors cost the mapping almost nothing:** 0.1 points of work, and no wrong
     green.
   - **Every misread line got the right codes.**
     - "PORFINAS TOTALES" and "VELOC. DE SEDIMENTACIÓN" went orange through the search;
       "HOMOCISTE%NA" too.
     - "G-GT", "r-GT", "Г-GT" and "I-GT" for "Γ-GT": the search alone leaves them red with
       the wrong code, the model then proposes the right one. On the third and fourth
       requests of that insurer where Qwen read "G-GT", the memory had learnt the misreading
       and proposed it green. Decision 4 of 2026-10-27, leaving "Γ-GT" to the mapping,
       holds.
   - **The one invented line** ("ESTUDIO TIROIDEO", a heading read as a test) went orange,
     and the technician removes it.
   - **Lines not read are the remaining cost:** 4 with Gemini, 1 with Qwen. Nothing proposes
     codes for them, and the technician has to notice and add them. The viewer in F5 is where
     they will be noticed.
   - **Model calls:** 23.5 per 100 documents, about 3.1 s each.

   **Proposal, not approved: candidates by birth date and a similar name.** When neither the
   identity document nor the name agrees, a patient whose birth date agrees and whose name
   is close (the similarity the OCR boxes use) could be offered as a candidate. That would
   catch `synth-000186`. It needs measuring against the scenarios of new patients, so that
   it does not offer false candidates.

#### Decisions

Answered by the product owner on 2026-10-23:

1. **Profiles as several codes:** yes, often a profile is requested and the lab enters
   separate codes. Proposed: a line maps to a list of codes from the start; doing it later
   would mean reworking the golden, the table and the metrics.
2. **The same text meaning different codes per insurer:** not known whether it happens.
   Proposed: confirmed mappings are scoped per insurer, and evidence from other insurers is
   only a suggestion. That is safe either way.
3. **Context for mapping:** everything read from the document. Proposed: the whole extraction
   goes to the model layer; the confirmed-mapping key stays (insurer, text) so that every
   green can be explained.
4. **Catalog size:** thousands of tests in a real lab. Proposed: a synthetic catalog of about
   2,000 codes, and a candidate search before the model.

Settled on 2026-10-23 as recommended:

5. **Approvals needed for green.** Recommended: two actively resolved approvals (see
   Learning in C), with no contradiction, configurable; the learning curve with operator
   errors will show whether one is enough.
6. **Automatic patient link.** Recommended: only on a strong match, as in B.
7. **Replacing the seed-42 dataset**, which makes earlier runs incomparable and needs a new
   baseline run (about 1.2 USD). Recommended: yes; the extractor's history stays in this file.
8. **Persistence on the public demo.** Recommended: F4 works on local SQLite only; the
   demo's storage is decided in F6. *Changed on 2026-10-26:* the demo runs on the product
   owner's self-hosted Dokploy, not on Vercel, so it is a Docker container whose SQLite file
   can live on a persistent volume; the read-only file system that motivated this decision
   no longer applies.
9. **How the technician approves.** Nothing is accepted without approval; the granularity
   settled is: red lines and fields must be resolved one by one; orange
   ones need a confirmation each (one keystroke in F5); green ones are reviewed on screen and
   covered by a single approval of the whole request, which stays disabled while anything is
   red or orange. The approval records the technician, the time and the approved values and
   codes. The alternative, a confirmation for every line, green included, is the strictest
   and slows down the common case.

`CLAUDE.md` now carries the test mapping in its architecture and v1 fields, and the approval
requirement next to the traffic light: a colour is a signal, never an acceptance.

### 5. F5 and F6

As in `CLAUDE.md`, with these decisions for F6, taken by the product owner on 2026-10-26:

- **The public demo replays recorded replies.** It runs on the product owner's self-hosted
  Dokploy, which cannot run a local model. For a fixed set of synthetic documents, the
  replies of Gemini and of local Qwen (extraction and mapping) are recorded beforehand on the
  development machine; the demo lets the visitor pick a provider and serves the recorded
  reply. No API key on the server and no cost per visit. Proposed: the UI says the reply
  is recorded (model, date, measured latency) rather than passing it off as live.
- **No uploads on the public demo.** Only the bundled synthetic documents.
- **Uploads in local mode.** Run on the development machine, the app calls the models live
  and accepts new documents, for a demo from that machine on request. Uploaded documents
  are stored outside the repository tree, since they may be real.
- One environment variable chooses the mode, replay or live.

#### Batches: the demo as a workflow

**Status: proposed on 2026-10-27 at the product owner's request; the four open decisions
answered by the product owner the same day (below).** It sets the scope of F5 and of the
final demo: not "upload a PDF and see the result", but the way a lab works. A technician
creates a batch of documents, the batch is processed, and each document waits for
verification until it is opened, checked and approved. As complete as possible, in both
modes.

**Life cycle.** A batch is the unit of work; each of its documents moves through:

```
queued → extracting → awaiting verification → in verification → approved
             ↘ failed (can be retried)                       ↘ rejected (illegible, not a request…)
```

- **Extracting** is the whole chain for one document: extractor, fusion against `mock-lis`,
  test mapping. Its result is stored as the document's *proposal*.
- **A batch's state** is derived from its documents ("12 documents: 3 extracting, 7 awaiting
  verification, 2 approved"), never stored on its own.
- **In verification** locks the document to the technician who opened it.
- **Approving** writes an immutable record: who, when, and the exact values and codes approved.
  Only approved records feed the mapping memory, as already decided in F4.
- **Rejecting** asks for a reason and keeps the document and its proposal.

**One code path in both modes.** The queue and its worker are the same in replay and live
mode; only what answers changes:

- **Replay mode, the public demo:** a replay provider serves the recorded replies and waits
  the latency measured when they were recorded. The visitor sees the batch advance document
  by document, and the UI says the replies are recorded (model, date, latency).
- **Live mode, the development machine:** the extractor calls Gemini or local Qwen.

Nothing is staged: the workflow is the real one, and only the model's reply is recorded.

**The queue.** A jobs table in the same SQLite database. The worker runs inside the Next.js
server, so the demo stays one container, with a concurrency per provider: several calls at
a time for Gemini, one for the local model. At start-up, jobs left in "extracting" go back
to the queue.

**Screens.**

1. **Batches:** the list, with each batch's progress, and "New batch".
2. **New batch:**
   - Replay mode: pick from the bundled synthetic documents (those with recorded replies),
     or "random batch of N".
   - Live mode: synthetic documents and uploaded PDFs can be mixed in one batch. Uploads are
     stored outside the repository tree, as already decided.
   - In both modes, the provider is chosen per batch.
3. **Worklist:** the documents awaiting verification, with "open the next one".
4. **Verification:**
   - The page viewer with the boxes: exact when they come from the OCR, approximate (a margin
     and a visible mark) when they come from the model (`box_source`).
   - The form with the traffic light and each field's provenance.
   - The tests with their proposed codes.
   - Keyboard navigation.
   - Approve or reject, then straight on to the batch's next document.

**Decisions of 2026-10-27, by the product owner:**

1. **Separate sandboxes on the public demo.** Each visitor works in their own space, tied to
   their session and deleted after some hours; visitors never see each other's batches.
   Consequence: each sandbox starts from the same seeded mapping memory and learns only from
   its own approvals.
2. **The technician is picked, not logged in.** On entering, the visitor picks one of a few
   synthetic technicians; no real authentication. Enough for the audit trail to say
   "approved by …".
3. **Approving also creates the request in `mock-lis`**, with its values and test codes. That
   closes the loop up to the system of record, in addition to the approval record.
4. **Live-mode batches may mix** uploaded PDFs and bundled synthetic documents.

**Blocks, in order (each about 90 minutes, after F4 block 6):**

1. **Batches and queue.**
   - Tables for batches, documents, jobs, proposals and approvals, plus a requests table in
     `mock-lis`.
   - The worker and the replay provider.
   - The sandbox and technician session.
   - The API routes.
2. **The batch list and the new-batch screen.**
3. **The verification screen:** viewer, form, tests and keyboard.
4. **Approval and rejection:**
   - The immutable record.
   - The request created in `mock-lis`.
   - The mapping memory fed.
   - On to the next document.

**Block 1 done on 2026-10-27: batches and queue**, described in `docs/workflow.md` (the
code is in `web/src/lib/batches/`).

- **One SQLite database per workspace,** copied from the seeded LIS template. A sandbox is
  therefore apart in everything (batches, decisions, LIS requests, memory) without a
  workspace column in any table. Sandboxes are swept 24 hours after their last use.
- **The queue is the documents' state;** no separate jobs table. A worker in the server
  process takes queued documents across workspaces: 4 at a time for Gemini, 1 for the local
  model. When the server starts, `src/instrumentation.ts` queues again what was left
  extracting.
- **The chain:**
  1. **Reading:** the extractor live, or in replay mode its recorded prediction, found by the
     PDF's hash in an extractor run and served after the latency measured when recorded.
  2. **Fusion** against the workspace's LIS.
  3. **Mapping:** memory, search, then the model on red lines. In replay mode the mapping
     model answers from its cached replies only; without one, the line stays red.

  The result is stored as the proposal.
- **Tables:** `batches`, `batch_documents`, `proposals` and `decisions` (written once, used in
  block 4), plus `requests` in the mock LIS. Migration `0002_batches`.
- **The API:** session (technician picked from three synthetic ones), bundled documents,
  batches (JSON, or multipart with uploads in live mode), retry, the proposal and the PDF.
- **Checked:**
  - 6 tests (replay, failure and retry, interrupted documents, sandboxes apart, sweep).
  - On the dev server: three Gemini documents replayed in about 9 s each, with their full
    proposals; a second visitor sees no batch; a local-model batch stopped mid-document is
    picked up again on restart.
  - `next build` and `next start`: the queue resumes, and both providers advance
    independently.

**Block 2 done on 2026-10-27: the batch screens** (`docs/workflow.md`, "Screens").

- **Entry:** the technician picker, which says what the project is and, in replay mode, that
  replies are recorded.
- **Batch list:** each batch with a progress bar by state.
- **New batch:**
  - the model that reads it;
  - the bundled requests, described from their goldens (pages, scanned, handwriting,
    language), filterable, with "add 5 at random";
  - uploads in live mode.
- **Batch page:** each document's state; for one already read, its fields and lines by
  colour, the model and the latency; for a failed one, its error and a retry.

The workflow's states use their own colours, so they are never confused with the traffic
light. Pages poll while anything is moving.

**Checked in the browser,** in replay mode:
- a six-document Gemini batch created from the screens, read at the recorded pace, with its
  summaries;
- the pages at phone width, with no horizontal scroll;
- no server errors.

**Live mode, through the API on a production build:** a batch mixing a bundled request and
an uploaded PDF, read by local Qwen (70 s and 60 s). Its boxes came from the OCR and one line
was mapped by the model. The upload was kept under the data directory.

**Replay sped up, 2026-10-27, at the product owner's request.** A demo batch at the recorded
pace took minutes with local Qwen (about 80 s per document), so replies are now replayed five
times faster by default (`REPLAY_SPEED`). The screens say so, and each document still shows
the latency measured when it was recorded. Six Gemini documents now take 4 s.

**A modern look, 2026-10-27, at the product owner's request.** The screens were redesigned
(`docs/workflow.md`, "Screens"):
- Geist type, an indigo brand, white cards, inline icons and logo, and the logo as the tab icon.
- An entry page with the product's four steps, the traffic light, measured figures (99.8%
  field precision, no reading error shown green, 1.5% of lines left to the technician, no
  wrong patient link) and a glimpse of the verification screen.
- Batches as cards with a progress bar and counts by state.
- A new-batch screen in steps, with model cards and a summary at the side.
- A batch page with its progress, mean read time and each document's colours as small bars.

Checked at desktop and phone width, with no console errors. The product owner then
generated three illustrations from prompts written for the project:
- the entry's hero;
- the empty batch list;
- the image shown when a link to the demo is shared, with its title set over it.

They are optimised to WebP and JPEG, about 140 KB in all. Only the share image needed a
`.gitignore` exception, since image formats are ignored by default to keep real documents
out.

**Block 3 done on 2026-10-27: the verification screen** (`docs/workflow.md`, "Screens").

- **The pages,** rendered on the server, with a box on every value. The focused one is
  highlighted and scrolled to; clicking a box focuses its item.
- **The links** to patient, physician and insurer.
- **Fields by group,** with their light, the reason, and what the document and the records
  say. A conflict is resolved with one click or Alt+1/Alt+2, and any field can be typed over.
- **The requested lines,** with their codes, names and source; they can be changed to another
  candidate or removed.
- **Moving around:** keyboard navigation, and moving between the batch's documents.
- **Locks:** opening a document locks it to the technician; leaving or moving on releases it,
  and another technician can take it over.

Decided while building it: Gemini's own boxes are drawn exact, like the OCR's, since they are
as good (99.4%); only the local model's own boxes are approximate. The roadmap's earlier note
said "model boxes" in general, written when only Qwen's had been measured that way.

The changes stay in the page until block 4's approval records them. Checked in the browser:
- three Gemini documents, one of four pages;
- a date-of-birth conflict resolved with Alt+2, and Alt+↓ to the next field;
- moving to the next document, which released the previous one;
- phone width, and no console errors.

One test for the locks; 156 in all.

**The verification screen for wide screens, 2026-10-27, at the product owner's request.**
The product owner asked for verification to be designed for 4K screens, showing for each
field what was read, what is proposed and what is selected. This is the base; the work will
go on from it step by step.
- **Columns per field:** Read, Records, Proposed, Selected. Read and Records can be clicked to
  select their value.
- **Columns per test line:** Read, Proposed, Selected.
- **Breakpoints:** new ones at 1920, 2560 and 3200 px. From 2560 px the screen has three
  columns (document, fields, tests), and the viewer shows two pages per row when it is wide
  enough.
- **Checked** with screenshots at 1920, 2560 and 3840 px, taken with headless Chrome. At
  3840 px the four pages, the 13 fields and the 24 lines of `synth-000003` fit on one screen
  without scrolling.

**The lens, 2026-10-27, at the product owner's request.** When an item is in focus, a
magnified window of the page shows where its value was read. The window sits beside the item,
and a line runs from it to the value's box in the viewer. It is switched with Alt+Z.
Screenshots at 1920 and 2560 px checked it. On the first look it followed the focus, so it
stayed on screen and covered rows being worked on. It now shows only while the pointer is on
a value in the Read column; the viewer brings the value's box into view when it is off screen.

**Editing the tests, 2026-10-27, at the product owner's request.** The selected codes of a line
are chips that can be removed, and any test or profile of the catalog can be added with a
search by name or code, not only the proposed candidates. Lines that were not read can be
added, and lines that were read can be dropped (kept in view struck through, with an undo).
What the approval records for each, and what the memory learns from it, is block 4's: the
proposal is a drop or a correction for a read line, and nothing for an added one.

**The app in Spanish, 2026-10-27, at the product owner's request.** An EN | ES switch on the
entry page and in the header; every text in both languages, field labels from fields.json,
the server's explanations translated by pattern (docs/workflow.md). The README and the docs
stay in English.

**Block 4 done on 2026-10-27: approval and rejection** (`docs/workflow.md`, "Approving").

- **Decision 9 as settled:** red and orange items resolved one by one, by a change or an
  explicit confirmation (one keystroke, Alt+Enter, which also moves to the next item to
  check); green ones covered by the single approval, disabled until nothing is left.
- **One transaction:** the immutable decision with, per field and line, what was proposed,
  approved and done; the request in `mock-lis` with the linked records; the memory taught
  the approved lines (passive for green kept, active for confirmed or chosen, a correction
  for a replaced proposal); the document approved and released.
- **Rejection** with a reason and an optional note, required with "other".
- **On to the next document** of the batch after either; a decided document opens read-only
  with its decision.
- **Checked:** a test of the whole path (refused while unresolved, approved once, the
  request and the memory written, rejected); in the browser, a document approved with
  Alt+Enter and Ctrl+Enter, the next one opened, rejected, and the approved one shown as
  recorded.
- **Found:** a patient linked only as a candidate goes to the request without a patient
  record, even when the technician confirms every value. Confirming the link itself belongs
  with the open proposal of candidates by birth date and a similar name.

**After the product owner's first look at approval, 2026-10-27:**

- **An age is proposed as a number.** `fields.json` gains `stored_as`: the form the system
  of record keeps a value read from the document in. Edad is `digits`, so "22 anys" is
  proposed as 22; the reading stays exact (the extractor's rule), and the evaluation
  already compares ages by their digits. Proposals made before keep their value.
- **Read-only is obvious.** A document another technician has open showed inputs that
  looked editable but were not: they now look disabled, and the notice stands out with
  taking it over as a button.
- **Searching the records by hand.** A magnifier on each record card searches the LIS
  (patients, physicians, insurers); choosing a record, or "no record", fuses the document
  again against it, and the approval checks and records the choice. It also settles the
  case found in block 4: a patient only offered as a candidate can now be linked by the
  technician, and the request then carries the patient's record.

**Deleting batches, 2026-10-27, at the product owner's request,** to clear away trials:
everything a batch left goes with it, except what the mapping memory learned
(`docs/workflow.md`). In a real lab, approved requests would not be deletable; here the
sandbox is a place to try things out.

**The decision log, 2026-10-27, at the product owner's request** (`docs/workflow.md`): for each
field and line, the steps from the reading to the proposal and what the technician did,
under its row or in a panel for the whole document. What changes over time (the memory, the
model's consultation) is recorded when the document is processed; the rest is derived from
what is stored. Checked with a test of the steps and in the browser at 1920 px.

### F6 block 1 done on 2026-10-27: recorded replies and the starting memory

- **The starting memory** (`npm run seed-memory`): the demo's LIS template now holds what
  technicians approved before the visitor arrived. The history is synthetic documents 200 to
  999 of the 1,000-document set, which the demo never shows (its 200 are the set's first),
  each line approved with its right codes under its insurer. Measured on the demo set (memory
  and catalog only, no model), by documents of history:

  | history | green | orange | red | wrong greens |
  |---|---|---|---|---|
  | 0 | 0.0% | 90.5% | 9.5% | 0 |
  | 100 | 43.8% | 53.2% | 2.9% | 0 |
  | 200 | 63.1% | 34.6% | 2.3% | 0 |
  | 400 | 75.8% | 22.8% | 1.4% | 0 |
  | 800 | 84.0% | 15.2% | 0.8% | 0 |

  400 is the default: most lines green, and still orange and red ones for the visitor to work
  on. Same figures with the local model's readings, within 0.2 points.
- **The mapping model's recorded replies** (`npm run record-mapping`, Gemini): which lines are
  red depends on the memory, and so on the visitor's approvals, so a reply recorded for one
  set of red lines would not answer another. The model was asked about every line of each
  demo document, with the whole form as context, and replay serves each red line its own
  answer (`lib/mapping/recorded.ts`). 200 documents and 1,611 lines; the local model's
  readings asked only about the lines they read differently; about 670,000 input and 23,000
  output tokens.
- **End to end as the demo runs it**, 400 documents of history, Gemini readings: 75.8% green,
  24.0% orange, 0.2% red, no wrong green; 22 red lines went to the model, 19 answered, 17 of
  them right. Local readings: 75.9%, 23.9%, 0.2%; 25, 22, 20.
- **Starting from scratch:** the entry page offers it in replay mode; the visitor's sandbox is
  deleted and the next one starts from the template (`DELETE /api/session`).
- **For block 2:** `data/` is outside version control, so the image needs the bundled PDFs,
  both extractor runs, the demo template and the recording from somewhere: built in, or
  fetched at build time.

**Open points found while building it, for later blocks:**

- **Form language.** The extractor does not report it, so the mapping model is told
  "Spanish" for every form. F4's measurement gave the model the right language, so the cost
  on Catalan forms is not measured.
- **Replies the demo needs.** A sandbox starts with an empty memory, so which lines are red,
  and the mapping model's prompts, depend on the order of the visitor's approvals; a reply
  recorded for one order may not match another. F6 has to record the replies for the
  bundled set, and decide whether sandboxes start from a seeded memory (the decision of
  2026-10-27 says they do; the template has none yet).

F6 then records the replies for the bundled set, deploys on Dokploy and writes the README.
