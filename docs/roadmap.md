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
| F3 | Evaluation harness | design **proposed**, see below |
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

### 2. F3: evaluation harness (proposed)

**Status: proposed on 2026-10-22, awaiting approval. Nothing implemented.**

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

**Open decisions**, with the recommendation:

1. ~~A dropped honorific counts as wrong.~~ **Settled on 2026-10-22 the other way, as a product
   decision:** what matters is the physician's name and surnames, not the title. `NombreMedico`
   now has the `no-title` normalisation rule (fields.json v2): the golden value drops the title,
   the prompt (v2) asks for it to be dropped, and the boundary removes any title left, with a
   `title_removed` warning. The metric stays strict on the name itself.
2. **Failures stay out of the quality metrics.** This means amending one sentence of
   `docs/extractor-contract.md`, which currently says a failed prediction scores as all-missing.
3. **A shared `schema/compare-cases.json`**, run by both pytest and vitest, so that the Python
   and TypeScript implementations of the compare modes cannot drift apart. The fusion engine
   in F4 reuses it.
4. **Two blocks.** (a) Scoring, reports and `docs/evaluation.md` with the metric definitions.
   (b) Baseline comparison and a full 200-document run. Running the evaluation in CI on every
   commit needs a Gemini key in CI and is deferred to F6.

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
