"""Checkboxes without a model: squares of a checkbox's size, and the ink inside them.

Classic OCR engines do not see checkboxes: Tesseract reads an empty one as "L]" or "[1]" and
drops a ticked one; RapidOCR reads some crosses as an "X" and ignores the rest. The requests
of seed 42 have them in two places: the pre-printed test list of lab-classic (side 8 pt), and
the sex of lab-classic and insurer-form (side 6.8 and 7.65 pt). A ticked box holds a cross or
a check drawn inside it, clear of its border.

``CheckboxDetector.detect`` finds them on a page image; ``attach`` gives each one to the text
on its right, as the ``mark`` of a line of its own, so that the model reads "[X] Glucosa" or
"[ ] Hemograma". A box whose ink is neither clearly empty nor clearly marked is left without a
mark (``state`` None) and counted.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

from intake_ocr.document import Box, Mark, Segment, Word

#: Sides of the boxes drawn on the forms, in points (synth: recorder.checkbox and sex_boxes).
SMALLEST_PT = 6.8
LARGEST_PT = 8.0
#: Tolerance on the side: a scan is resampled, blurred and slightly rotated. Wide enough for
#: that, narrow enough to leave out table cells, which are far larger, and small letters: at
#: 0.7 a handwritten "o" of 5 pt passed (synth-000147).
SIZE_SLACK = (0.85, 1.35)
#: A square within this ratio of width to height.
ASPECT = (0.8, 1.25)
#: Each side of a box is a straight stroke the whole length of the side: at least this share
#: of a thin band along it is ink. Letters whose outline is nearly square ("O", "D", "B", "E")
#: have a rounded corner or an open side, and stay under it; at 0.6, 1,500 of them passed on
#: the first 40 documents of seed 42.
BORDER_INK = 0.9
#: Every corner of a square is ink. Round letters ("O", "Q") pass the test of the sides once
#: blurred, but their corners are paper.
CORNER_INK = 0.3
#: A square's outline fills its bounding box, less its corners once blurred (0.82 for a 6.8 pt
#: box under a 1.2 px blur); a circle's fills pi/4 of it (0.785), and fails CORNER_INK too.
SOLIDITY = 0.8
#: A box is drawn on paper: a band just outside it is mostly paper. The hole of a white letter
#: in a coloured band is surrounded by ink.
OUTSIDE_INK = 0.35
#: The interior compared: the box less this share of its side on every edge, which leaves the
#: border and its blur out. The marks are drawn from 18% of the side inwards.
INNER_MARGIN = 0.2
#: Between the stroke and the interior, a box is partly paper: the marks start further in,
#: though on a scan a cross thickens into it (up to 0.69 in a 6.8 pt sex box of seed 42). A
#: square cut out of a filled area (the coloured band of a header, read as ink) is ink
#: throughout, and is also caught by OUTSIDE_INK.
RING_INK = 0.85
#: Share of the interior that is ink. An empty box holds only scanner grain (under 2% on the
#: scanned forms of seed 42); a cross or a check of 1.2-1.3 pt strokes covers 20-35%. Between
#: the two, the box is doubtful and gets no mark.
EMPTY_BELOW = 0.06
CHECKED_ABOVE = 0.12
#: A box belongs to the text whose first word starts within this many sides to its right.
MAX_LEAD = 3.0


@dataclass(frozen=True)
class Checkbox:
    box: Box
    #: Share of the interior that is ink.
    fill: float
    state: Mark


def _binary(image: Image.Image) -> np.ndarray:
    """Ink as 255, paper as 0: Otsu's threshold on the greyscale page, slightly smoothed."""
    grey = np.array(image.convert("L"))
    grey = cv2.GaussianBlur(grey, (3, 3), 0)
    _, ink = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return ink


def _band(w: int, h: int) -> int:
    """The width of the stroke and its blur, as a band along each side."""
    return max(2, round(min(w, h) * 0.12))


def _corner_ink(ink: np.ndarray, x: int, y: int, w: int, h: int) -> float:
    """The weakest of the four corners: the share of ink in a square of the band's side."""
    b = _band(w, h)
    corners = [
        ink[y : y + b, x : x + b],
        ink[y : y + b, x + w - b : x + w],
        ink[y + h - b : y + h, x : x + b],
        ink[y + h - b : y + h, x + w - b : x + w],
    ]
    return min(float((c > 0).mean()) for c in corners)


def _ring_ink(ink: np.ndarray, x: int, y: int, w: int, h: int) -> float:
    """The share of ink between the band along the sides and the interior."""
    b = _band(w, h)
    mx, my = round(w * INNER_MARGIN), round(h * INNER_MARGIN)
    outer = ink[y + b : y + h - b, x + b : x + w - b] > 0
    inner = ink[y + my : y + h - my, x + mx : x + w - mx] > 0
    ring = int(outer.size) - int(inner.size)
    return (int(outer.sum()) - int(inner.sum())) / ring if ring > 0 else 1.0


def _outside_ink(ink: np.ndarray, x: int, y: int, w: int, h: int) -> float:
    """The share of ink in a band of the stroke's width just outside the box."""
    b = _band(w, h)
    y0, y1 = max(0, y - 2 * b), min(ink.shape[0], y + h + 2 * b)
    x0, x1 = max(0, x - 2 * b), min(ink.shape[1], x + w + 2 * b)
    around = ink[y0:y1, x0:x1] > 0
    within = ink[max(0, y - b) : y + h + b, max(0, x - b) : x + w + b] > 0
    ring = int(around.size) - int(within.size)
    return (int(around.sum()) - int(within.sum())) / ring if ring > 0 else 1.0


def _border_ink(ink: np.ndarray, x: int, y: int, w: int, h: int) -> float:
    """The weakest of the four sides: the share of ink in a band along each."""
    band = _band(w, h)
    sides = [
        ink[y : y + band, x : x + w],
        ink[y + h - band : y + h, x : x + w],
        ink[y : y + h, x : x + band],
        ink[y : y + h, x + w - band : x + w],
    ]
    # A side is inked where any pixel across its band is: a column (or row) counts once.
    shares = []
    for i, side in enumerate(sides):
        covered = side.max(axis=0 if i < 2 else 1) > 0
        shares.append(float(covered.mean()) if covered.size else 0.0)
    return min(shares)


class CheckboxDetector:
    def __init__(self, dpi: int) -> None:
        px = dpi / 72
        self.min_side = SMALLEST_PT * px * SIZE_SLACK[0]
        self.max_side = LARGEST_PT * px * SIZE_SLACK[1]

    def classify(self, fill: float) -> Mark:
        if fill < EMPTY_BELOW:
            return "unchecked"
        if fill > CHECKED_ABOVE:
            return "checked"
        return None

    def detect(self, image: Image.Image) -> list[Checkbox]:
        ink = _binary(image)
        contours, _ = cv2.findContours(ink, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        found: list[Checkbox] = []
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if not (self.min_side <= w <= self.max_side and self.min_side <= h <= self.max_side):
                continue
            if not (ASPECT[0] <= w / h <= ASPECT[1]):
                continue
            if cv2.contourArea(contour) < SOLIDITY * w * h:
                continue
            if _border_ink(ink, x, y, w, h) < BORDER_INK:
                continue
            if _outside_ink(ink, x, y, w, h) > OUTSIDE_INK:
                continue
            if _corner_ink(ink, x, y, w, h) < CORNER_INK or _ring_ink(ink, x, y, w, h) > RING_INK:
                continue
            mx, my = round(w * INNER_MARGIN), round(h * INNER_MARGIN)
            inner = ink[y + my : y + h - my, x + mx : x + w - mx]
            if inner.size == 0:
                continue
            fill = float((inner > 0).mean())
            box = Box(x, y, x + w, y + h)
            # The outer and inner edges of one stroke are two contours of nearly one box: the
            # outer one is kept, the box as drawn.
            same = [c for c in found if _overlap(box, c.box) > 0.5]
            if any(_area(c.box) >= _area(box) for c in same):
                continue
            found = [c for c in found if c not in same]
            found.append(Checkbox(box, fill, self.classify(fill)))
        return sorted(found, key=lambda c: (c.box.cy, c.box.x0))

    def attach(self, segments: list[Segment], boxes: list[Checkbox], width: int) -> list[Segment]:
        """Segments with each box's state as the mark of the text on its right.

        A segment with a box in front of one of its words is split there, so that two tests on
        one row (two columns read as one line) each get their own line and mark. Words lying on
        a box (the box read as "X", "□" or "L]") are dropped.
        """
        out: list[Segment] = []
        for seg in segments:
            words = seg.words or [Word(seg.text, seg.box)]
            words = [w for w in words if not any(_on_box(w.box, c.box) for c in boxes)]
            if not words:
                continue
            row = [
                c
                for c in boxes
                if seg.box.y0 <= c.box.cy <= seg.box.y1
                and seg.box.x0 - MAX_LEAD * c.box.height <= c.box.x1 <= seg.box.x1
            ]
            if not row:
                out.append(_segment(words, seg.mark) if seg.words else seg)
                continue
            row.sort(key=lambda c: c.box.x0)
            parts: list[tuple[Checkbox | None, list[Word]]] = [(None, [])]
            for word in sorted(words, key=lambda w: w.box.x0):
                # The box in front: the last one that starts before the word. A word that starts
                # on a box (the OCR read "L]PRO-BNP" as one word) is its box's too.
                ahead = [c for c in row if c.box.x0 <= word.box.x0 + 0.5 * c.box.height]
                owner = ahead[-1] if ahead else None
                if owner is not parts[-1][0]:
                    parts.append((owner, []))
                parts[-1][1].append(word)
            for owner, ws in parts:
                if not ws:
                    continue
                lead = max(0.0, ws[0].box.x0 - owner.box.x1) if owner else 0
                mark = owner.state if owner and lead <= MAX_LEAD * owner.box.height else None
                out.append(_segment(ws, mark))
        return out


def _segment(words: list[Word], mark: Mark) -> Segment:
    box = words[0].box
    for w in words[1:]:
        box = box.union(w.box)
    return Segment(" ".join(w.text for w in words), box, list(words), mark)


def _area(b: Box) -> float:
    return (b.x1 - b.x0) * (b.y1 - b.y0)


def _overlap(a: Box, b: Box) -> float:
    """Intersection over the smaller box."""
    ix = max(0.0, min(a.x1, b.x1) - max(a.x0, b.x0))
    iy = max(0.0, min(a.y1, b.y1) - max(a.y0, b.y0))
    smaller = min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))
    return ix * iy / smaller if smaller > 0 else 0.0


def _on_box(word: Box, box: Box) -> bool:
    """A word that is the box itself, as the OCR read it: most of it lies on the box."""
    return _overlap(word, box) > 0.6 and (word.x1 - word.x0) < 2 * (box.x1 - box.x0)
