"""Checkboxes drawn with PIL as the generator draws them: a square of 8 pt, a cross or a check."""

from __future__ import annotations

import pytest
from PIL import Image, ImageDraw, ImageFilter

from intake_ocr.checkboxes import CheckboxDetector
from intake_ocr.document import Box, Segment, Word, group_lines

DPI = 300
PT = DPI / 72


def _box(draw: ImageDraw.ImageDraw, x: float, y: float, side_pt: float, mark: str | None) -> None:
    s = side_pt * PT
    draw.rectangle([x, y, x + s, y + s], outline="black", width=round(0.7 * PT))
    pad = s * 0.18
    w = round(1.2 * PT)
    if mark == "x":
        draw.line([x + pad, y + pad, x + s - pad, y + s - pad], fill="black", width=w)
        draw.line([x + pad, y + s - pad, x + s - pad, y + pad], fill="black", width=w)
    elif mark == "tick":
        draw.line([x + pad, y + s * 0.55, x + s * 0.42, y + s - pad], fill="black", width=w)
        draw.line([x + s * 0.42, y + s - pad, x + s - pad, y + pad], fill="black", width=w)


def _page(boxes: list[tuple[float, float, float, str | None]], blur: float = 0) -> Image.Image:
    img = Image.new("RGB", (1200, 600), "white")
    draw = ImageDraw.Draw(img)
    for x, y, side, mark in boxes:
        _box(draw, x, y, side, mark)
    # Text and shapes that are not checkboxes: a round letter, a filled band, a large cell.
    draw.ellipse([900, 100, 933, 133], outline="black", width=6)
    draw.rectangle([0, 500, 1200, 560], fill=(0, 100, 80))
    draw.rectangle([1010, 490, 1040, 520], outline="white", width=3)
    draw.rectangle([700, 300, 900, 400], outline="black", width=3)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return img


@pytest.mark.parametrize("blur", [0, 1.2])
def test_finds_ticked_and_empty_boxes_and_nothing_else(blur: float) -> None:
    img = _page(
        [(100, 100, 8, "x"), (100, 200, 8, None), (300, 100, 8, "tick"), (300, 200, 6.8, "x")],
        blur=blur,
    )
    found = CheckboxDetector(DPI).detect(img)
    states = sorted((round(c.box.x0, -1), round(c.box.y0, -1), c.state) for c in found)
    assert states == [
        (100, 100, "checked"),
        (100, 200, "unchecked"),
        (300, 100, "checked"),
        (300, 200, "checked"),
    ]


def test_a_box_neither_empty_nor_marked_is_doubtful() -> None:
    img = _page([(100, 100, 8, None)])
    ImageDraw.Draw(img).rectangle([114, 114, 119, 119], fill="black")  # a stray dot inside
    (box,) = CheckboxDetector(DPI).detect(img)
    assert box.state is None
    assert 0.06 <= box.fill <= 0.12


def _words(x: float, y: float, text: str) -> list[Word]:
    out = []
    for word in text.split():
        w = 18 * len(word)
        out.append(Word(word, Box(x, y, x + w, y + 30)))
        x += w + 18
    return out


def _seg(words: list[Word]) -> Segment:
    box = words[0].box
    for w in words[1:]:
        box = box.union(w.box)
    return Segment(" ".join(w.text for w in words), box, words)


def test_a_line_with_two_boxes_is_split_into_two_marked_lines() -> None:
    img = _page([(100, 100, 8, "x"), (600, 100, 8, None)])
    found = CheckboxDetector(DPI).detect(img)
    # Tesseract's reading of a row of two columns: the boxes read as "L]", then the tests.
    row = _seg(_words(100, 102, "L]") + _words(150, 102, "Glucosa") + _words(600, 102, "LJ]"))
    row = _seg(row.words + _words(650, 102, "Hemograma completo"))
    lines = CheckboxDetector(DPI).attach([row], found, img.width)
    assert [(line.text, line.mark) for line in lines] == [
        ("Glucosa", "checked"),
        ("Hemograma completo", "unchecked"),
    ]


def test_text_with_no_box_in_front_keeps_no_mark() -> None:
    img = _page([(100, 100, 8, "x")])
    found = CheckboxDetector(DPI).detect(img)
    label = _seg(_words(100, 300, "Observaciones:"))
    far = _seg(_words(900, 102, "Fecha: 15/05/2026"))
    lines = CheckboxDetector(DPI).attach([label, far], found, img.width)
    assert [(line.text, line.mark) for line in lines] == [
        ("Observaciones:", None),
        ("Fecha: 15/05/2026", None),
    ]


def test_a_marked_segment_starts_a_line_of_its_own() -> None:
    sex = Segment("Sexo:", Box(100, 100, 200, 130), _words(100, 100, "Sexo:"))
    home = Segment("Home", Box(240, 100, 320, 130), _words(240, 100, "Home"), mark="checked")
    lines = group_lines([sex, home], width=2481)
    assert [(line.text, line.mark) for line in lines] == [("Sexo:", None), ("Home", "checked")]
