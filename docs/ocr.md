# OCR engines (`ocr/`)

An experiment approved on 2026-11-05: instead of showing the local model the pages, an OCR
reads them and the model gets only the text, numbered by line (the extractor's provider
`local-text`, [extractor-contract.md](extractor-contract.md), "Input mode and model"). This
package runs the OCR engines that pipeline can be given, and writes what each read in one
format. Results are in [roadmap.md](roadmap.md), section 3, "OCR-text pipeline".

It is a uv package of its own, `intake-ocr` (Python 3.12, its own `uv.lock`), apart from
`synth/` and outside the demo's container, like LM Studio. The OCR runs on the server with
the models, the AI box, never in the application that sends the document: the application
posts a PDF to `intake-ocr serve` and gets its OCR back, as it posts a prompt to LM Studio
(decided by the product owner on 2026-11-05). Its tests need no model and run in CI.

```bash
cd ocr
uv sync
uv run intake-ocr serve --preload rapidocr        # http://127.0.0.1:8765
cd ../web
npm run extract -- --in ../data/synth/seed-42 --provider local-text \
    --ocr-url http://127.0.0.1:8765 --checkboxes
```

For measuring, the same engines can also write their OCR to files once, which runs then read
with `--ocr-dir` without reading the pages again:

```bash
uv run intake-ocr run --engine rapidocr --in ../data/synth/seed-42 \
    --out ../data/ocr/rapidocr-cb/seed-42 --checkboxes
npm run extract -- --in ../data/synth/seed-42 --provider local-text \
    --ocr-dir ../data/ocr/rapidocr-cb/seed-42
```

Both go through the same code (`reader.py`), and an engine reads a page the same way each
time: the server's reply and the file are the same lines.

## The server

```
GET  /health                                    {"ocr_version", "engines", "loaded"}
POST /ocr?engine=rapidocr&checkboxes=1&dpi=300  body: the PDF, Content-Type application/pdf
     -> 200 the OCR document (schema/ocr.schema.json)
```

Each engine is loaded on its first request (or at start, `--preload rapidocr`) and kept;
each reads one document at a time. Errors are JSON `{"error": "..."}`: 400 for a parameter
or a body that is not a PDF, 401 without the token, 413 over 20 MB, 500 when the engine
fails. It listens on 127.0.0.1 unless `--host` says otherwise. Documents are health data: on
a network, give it a token (`--token` or `INTAKE_OCR_TOKEN`; clients send `Authorization:
Bearer`), keep it on the local network, and note it logs one line per request and never a
document. The vision engines, which LM Studio serves already, are not served here.

The extractor uses it for `local-text` when `--ocr-url` (or `OCR_URL`) names it, with
`--ocr-engine` (`OCR_ENGINE`, rapidocr by default), `--checkboxes` (`OCR_CHECKBOXES=1`) and
`OCR_TOKEN`. A server that cannot be reached, after one retry, fails that document with
`api_error`, and the model is not called. The time the server takes is part of the
prediction's latency, as the model's is.

## What it writes

One `<id>.ocr.json` per PDF, as [`schema/ocr.schema.json`](../schema/ocr.schema.json) says:
the engine and its model, the resolution, the PDF's `sha256` (the extractor refuses the OCR
of another PDF), the time it took, and per page its lines in reading order, each with an id
(`p2l17`), a box on 0–1 of the page, its text (fullwidth punctuation such as `：` written as
ASCII), its words with their boxes, and the checkbox in front of it (`checked`, `unchecked` or
`null`). A `run.json` beside them keeps the mean
and median time per page. Documents already read with the same engine, resolution and
checkbox setting are skipped unless `--force`. Like everything under `data/`, none of it is
committed; the models are fetched into `data/models/` or LM Studio's folder, never the
repository.

## Engines

| Engine | What | Lines | Positions |
|---|---|---|---|
| `tesseract` | The native Tesseract binary, Spanish and Catalan, from its TSV | Tesseract's own, a whole row of the page | Per word |
| `rapidocr` | RapidOCR 3.9.2 on ONNX Runtime, CPU only, PP-OCRv6 small models | One per piece the detector finds (label, value, cell) | Per word |
| `paddle-vl` | PaddleOCR-VL-1.6, the official GGUF, in LM Studio, prompt `OCR:` | The page's lines, as text | None through LM Studio |
| `glm-ocr` | GLM-OCR, ggml-org's GGUF, in LM Studio | The page's lines, as text | None |
| `dots` | dots.ocr, ggml-org's GGUF, in LM Studio, its layout prompt | Blocks: a paragraph, a list | One per block |

`tesseract` needs the system packages `tesseract-ocr`, `tesseract-ocr-spa` and
`tesseract-ocr-cat`. The extractor's in-process Tesseract (tesseract.js, Spanish only) is
what the text pipeline uses when no OCR file is given.

The three vision models give no position per line through LM Studio: PaddleOCR-VL's
`Spotting:` returns its boxes as special tokens, which the server does not pass on, and the
documented route for them is llama.cpp's `llama-server --special`. So they cannot write an
OCR document; `intake-ocr run` refuses them, and `intake-ocr bench` measures them:

```bash
uv run intake-ocr bench --engine paddle-vl --in ../data/synth/seed-42 --out ../data/ocr/bench/paddle-vl --pages 20
```

times any engine on the first pages of a directory and keeps the text it read of each.

**Lines from a detector.** RapidOCR's detector finds pieces of text, not lines. Joining the
pieces of a row would need a gap that tells a label and its value from two columns, and the
first 20 documents have none: a label lies up to 0.13 of the page from its value, two columns
as close as 0.07. So each piece is a line, in reading order (rows from the top, left to
right), and only pieces that touch are joined (`JOIN_GAP`), such as a mark read as an "X" in
front of its test.

A piece's text is built from its words, one space between two (`line_text`). RapidOCR's own
text for a piece drops spaces its split into words keeps ("CantábricaSegurosMédicos" for the
words "Cantábrica", "Seguros", "Médicos"); over the 200 documents of seed 42, the values found
exactly on their page rose from 1,841 to 1,873 of 1,920 with the words' text. A piece the
engine split into characters, which it does on a line it takes for Chinese or Japanese (a
fullwidth colon, faint small print), keeps the engine's text.

## Checkboxes (`--checkboxes`)

Classic OCR does not read checkboxes: Tesseract reads an empty one as `L]` or `[1]` and drops
a ticked one; RapidOCR reads some crosses as an `X` and nothing else. `checkboxes.py` finds
them with OpenCV and gives each to the text on its right as the line's mark, so that the
model reads `[X] Glucosa` and `[ ] Hemograma`.

A checkbox is a square of the sizes the forms print (6.8 to 8 pt, with some slack for a
scan) whose four sides are straight strokes, with ink in every corner, paper just outside
and mostly paper between the stroke and the interior. The share of ink in the interior
decides: under 0.06 empty, over 0.12 ticked, and in between doubtful, which gets no mark and
is counted in `doubtful_checkboxes`. A line with two boxes, two columns read as one row, is
split at each box, and words that are the box itself are dropped. Each threshold is a
constant in the module, with the case that set it.

Measured against the goldens of seed 42 (2026-11-05): 687 ticked boxes found and 1,072
empty, none in the wrong state, no requested test or sex without its box, none found on the
69 documents that have none, and no doubtful one. The generator draws clean crosses and
checks inside the box; a real form, where a tick overruns the box or a box is filled in, is
the case the doubtful band is for, and the next thing to measure.
