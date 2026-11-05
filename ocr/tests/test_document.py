from __future__ import annotations

import hashlib

import jsonschema
import pytest

from intake_ocr.document import Box, Page, Segment, Word, document_dict, group_lines, validate
from intake_ocr.engines.tesseract import parse_tsv


def _seg(text: str, x0: float, y0: float, x1: float, y1: float) -> Segment:
    return Segment(text, Box(x0, y0, x1, y1))


def test_segments_are_lines_in_reading_order_and_only_touching_ones_are_joined() -> None:
    width = 2481
    segments = [
        _seg("Teléfono:", 1285, 761, 1444, 799),
        _seg("M", 534, 753, 583, 801),
        _seg("Sexo:", 170, 758, 290, 798),
        _seg("X", 175, 1607, 209, 1637),
        _seg("MAGNESIO (SUERO)", 218, 1601, 601, 1648),
        _seg("Paciente:", 170, 600, 300, 640),
    ]
    lines = group_lines(segments, width)
    assert [line.text for line in lines] == [
        "Paciente:",
        "Sexo:",
        "M",
        "Teléfono:",
        "X MAGNESIO (SUERO)",
    ]
    assert lines[-1].box == Box(175, 1601, 601, 1648)
    assert [w.text for w in lines[-1].words] == ["X", "MAGNESIO (SUERO)"]


def test_a_document_is_written_on_0_1_and_checked_against_the_schema() -> None:
    words = [Word("Urea", Box(248, 351, 348, 386))]
    page = Page(1, 2481, 3508, [Segment("Urea", Box(248, 351, 348, 386), words, "checked")], 900)
    doc = document_dict(
        engine="rapidocr",
        model="test",
        dpi=300,
        sha256=hashlib.sha256(b"pdf").hexdigest(),
        pages=[page, Page(2, 2481, 3508, [])],
        elapsed_ms=1000,
        checkboxes=True,
        doubtful_checkboxes=0,
    )
    line = doc["pages"][0]["lines"][0]
    assert line == {
        "id": "p1l1",
        "box": {"x0": 0.1, "y0": 0.1001, "x1": 0.1403, "y1": 0.11},
        "text": "Urea",
        "words": [{"text": "Urea", "box": {"x0": 0.1, "y0": 0.1001, "x1": 0.1403, "y1": 0.11}}],
        "mark": "checked",
    }
    assert doc["pages"][1]["lines"] == []
    bad = dict(doc, engine="Rapid OCR")
    with pytest.raises(jsonschema.ValidationError):
        validate(bad)


TSV_ROWS = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t2481\t3508\t-1\t",
    "4\t1\t1\t1\t1\t0\t170\t758\t430\t43\t-1\t",
    "5\t1\t1\t1\t1\t1\t170\t758\t120\t40\t96\tSexo:",
    "5\t1\t1\t1\t1\t2\t534\t753\t49\t48\t91\tM",
    "5\t1\t1\t1\t1\t3\t560\t753\t10\t48\t30\t|",
    "5\t1\t1\t1\t2\t1\t170\t820\t200\t40\t95\tTeléfono:",
    "5\t1\t2\t1\t1\t1\t170\t900\t300\t40\t95\tUrea",
]
TSV = "\n".join(TSV_ROWS)


def test_tesseract_tsv_gives_its_lines_with_their_words_and_no_punctuation_alone() -> None:
    lines = parse_tsv(TSV)
    assert [line.text for line in lines] == ["Sexo: M", "Teléfono:", "Urea"]
    assert lines[0].box == Box(170, 753, 583, 801)
    assert [w.text for w in lines[0].words] == ["Sexo:", "M"]
