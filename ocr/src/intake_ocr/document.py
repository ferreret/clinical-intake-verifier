"""The OCR document: lines in reading order with their boxes, as schema/ocr.schema.json says.

Engines hand over *segments*, a piece of text with its box in pixels and, when the engine
reports them, its words. Some engines' segments are already lines (Tesseract's, a whole row of
the page); others are what a text detector found, a label, a value, a cell, which
``group_lines`` puts in reading order.

Detector segments are not joined into rows. Over the first 20 documents of seed 42 (RapidOCR,
2026-11-05) the gap between two segments of a row is no help: a label and its value are up to
0.13 of the page apart ("Asunto:" and its subject), two columns as little as 0.07 ("EDAD" and
"SEXO" in a table header), and the gaps in between are spread evenly. Joining them would put
two tests, each with its own checkbox, on one line. Only segments that touch are joined: a
mark read as a letter in front of its test ("X MAGNESIO (SUERO)", 0.004 of the page).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Literal

import jsonschema

OCR_VERSION = 1

Mark = Literal["checked", "unchecked"] | None

#: Segments whose vertical centres are this close, in heights of the shorter one, share a row.
ROW_TOLERANCE = 0.5
#: Segments of a row closer than this, in page widths (a character at 10 pt is about 0.01),
#: are one line: they touch. Anything wider is another line (see above).
JOIN_GAP = 0.01


@dataclass(frozen=True)
class Box:
    """In pixels of the rendered page, origin top-left."""

    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    def union(self, other: Box) -> Box:
        return Box(
            min(self.x0, other.x0),
            min(self.y0, other.y0),
            max(self.x1, other.x1),
            max(self.y1, other.y1),
        )

    @staticmethod
    def of_points(points) -> Box:
        """The box around a quadrilateral or any list of (x, y)."""
        xs = [float(p[0]) for p in points]
        ys = [float(p[1]) for p in points]
        return Box(min(xs), min(ys), max(xs), max(ys))


@dataclass(frozen=True)
class Word:
    text: str
    box: Box


@dataclass
class Segment:
    """A piece of text an engine read, with its box, and its words when the engine has them."""

    text: str
    box: Box
    words: list[Word] = field(default_factory=list)
    mark: Mark = None


@dataclass
class Page:
    number: int
    width: int
    height: int
    lines: list[Segment]
    elapsed_ms: int | None = None


def _same_row(a: Box, b: Box) -> bool:
    return abs(a.cy - b.cy) <= ROW_TOLERANCE * min(a.height, b.height)


def group_lines(segments: list[Segment], width: int) -> list[Segment]:
    """Segments as lines in reading order, rows top to bottom and left to right; touching ones joined."""
    rows: list[list[Segment]] = []
    for seg in sorted(segments, key=lambda s: (s.box.cy, s.box.x0)):
        if not seg.text.strip():
            continue
        for row in rows:
            if _same_row(row[-1].box, seg.box) or _same_row(row[0].box, seg.box):
                row.append(seg)
                break
        else:
            rows.append([seg])
    lines: list[Segment] = []
    for row in sorted(rows, key=lambda r: min(s.box.y0 for s in r)):
        row.sort(key=lambda s: s.box.x0)
        current: list[Segment] = [row[0]]
        for seg in row[1:]:
            if seg.box.x0 - current[-1].box.x1 > JOIN_GAP * width or seg.mark is not None:
                lines.append(_join(current))
                current = [seg]
            else:
                current.append(seg)
        lines.append(_join(current))
    return lines


def _join(segments: list[Segment]) -> Segment:
    box = segments[0].box
    for s in segments[1:]:
        box = box.union(s.box)
    words = [w for s in segments for w in (s.words or [Word(s.text, s.box)])]
    return Segment(
        text=" ".join(s.text.strip() for s in segments),
        box=box,
        words=words,
        mark=segments[0].mark,
    )


def _norm(box: Box, width: int, height: int) -> dict:
    def clamp(v: float) -> float:
        return round(min(1.0, max(0.0, v)), 4)

    return {
        "x0": clamp(box.x0 / width),
        "y0": clamp(box.y0 / height),
        "x1": clamp(box.x1 / width),
        "y1": clamp(box.y1 / height),
    }


def page_dict(page: Page) -> dict:
    lines = []
    for n, line in enumerate((s for s in page.lines if s.text.strip()), start=1):
        lines.append(
            {
                "id": f"p{page.number}l{n}",
                "box": _norm(line.box, page.width, page.height),
                "text": " ".join(line.text.split()),
                "words": [
                    {"text": w.text, "box": _norm(w.box, page.width, page.height)}
                    for w in line.words
                    if w.text.strip()
                ],
                "mark": line.mark,
            }
        )
    out = {"number": page.number, "width": page.width, "height": page.height, "lines": lines}
    if page.elapsed_ms is not None:
        out["elapsed_ms"] = page.elapsed_ms
    return out


def document_dict(
    *,
    engine: str,
    model: str | None,
    dpi: int,
    sha256: str,
    pages: list[Page],
    elapsed_ms: int,
    checkboxes: bool,
    doubtful_checkboxes: int | None = None,
) -> dict:
    doc = {
        "ocr_version": OCR_VERSION,
        "engine": engine,
        "model": model,
        "dpi": dpi,
        "sha256": sha256,
        "elapsed_ms": elapsed_ms,
        "checkboxes": checkboxes,
        "pages": [page_dict(p) for p in pages],
    }
    if doubtful_checkboxes is not None:
        doc["doubtful_checkboxes"] = doubtful_checkboxes
    validate(doc)
    return doc


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


@cache
def _validator() -> jsonschema.Draft202012Validator:
    schema = json.loads((repo_root() / "schema" / "ocr.schema.json").read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema)


def validate(doc: dict) -> None:
    """Raises jsonschema.ValidationError when ``doc`` is not a valid OCR document."""
    _validator().validate(doc)
