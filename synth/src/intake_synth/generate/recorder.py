"""A reportlab canvas wrapper that records where every field value is drawn.

Templates work in a top-left-origin coordinate system expressed in PDF points; the recorder
converts to reportlab's bottom-left origin internally. Every value drawn through
:meth:`Recorder.field_text`, :meth:`Recorder.hand`, :meth:`Recorder.test_text` or
:meth:`Recorder.sex_boxes` becomes a :class:`Drawn` entry, and the golden is built only from
those entries. If it is not recorded, it is not ground truth.
"""

from __future__ import annotations

import io
import math
import os
import random
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import ImageFont
from reportlab.graphics.barcode import code39, code128
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

BLACK = colors.black
WHITE = colors.white
GREY = colors.HexColor("#555555")
LIGHT_GREY = colors.HexColor("#9E9E9E")

HANDWRITING_FONTS: dict[str, str] = {
    "Caveat": "Caveat[wght].ttf",
    "IndieFlower": "IndieFlower-Regular.ttf",
}
INK_COLORS = (
    colors.HexColor("#1A237E"),
    colors.HexColor("#0D47A1"),
    colors.HexColor("#111111"),
    colors.HexColor("#263238"),
)

BBoxPt = tuple[float, float, float, float]  # x0, y0, x1, y1 in points, origin top-left


def fonts_dir() -> Path:
    env = os.environ.get("INTAKE_FONTS_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[3] / "assets" / "fonts"


_registered = False


def register_fonts() -> None:
    global _registered
    if _registered:
        return
    for name, filename in HANDWRITING_FONTS.items():
        pdfmetrics.registerFont(TTFont(name, str(fonts_dir() / filename)))
    _registered = True


@lru_cache(maxsize=128)
def _pil_font(name: str, size_px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(fonts_dir() / HANDWRITING_FONTS[name]), size_px)


@dataclass
class Drawn:
    kind: str  # "field" | "test"
    name: str | None  # field name for kind == "field"
    value: str  # expected extractor output
    printed: str  # verbatim string drawn
    page: int  # 1-based
    box: BBoxPt
    style: str  # "printed" | "handwritten"
    primary: bool


@dataclass(frozen=True)
class HandwritingPlan:
    fields: frozenset[str] = frozenset()
    font: str = "Caveat"
    ink: colors.Color = BLACK
    scale: float = 1.3


class Recorder:
    def __init__(
        self,
        pagesize: tuple[float, float],
        rng: random.Random,
        handwriting: HandwritingPlan | None = None,
    ) -> None:
        register_fonts()
        self.buf = io.BytesIO()
        self.W, self.H = pagesize
        self.c = canvas.Canvas(self.buf, pagesize=pagesize, invariant=1, pageCompression=0)
        self.c.setTitle("Synthetic laboratory request")
        self.c.setAuthor("intake-synth")
        self.c.setCreator("intake-synth")
        self.c.setSubject("Synthetic document. No real patient data.")
        self.rng = rng
        self.hw = handwriting or HandwritingPlan()
        self.page = 1
        self.pages: list[tuple[float, float]] = [(self.W, self.H)]
        self.items: list[Drawn] = []

    # ------------------------------------------------------------------ coordinates

    def _rl(self, x: float, y: float) -> tuple[float, float]:
        return x, self.H - y

    def _box_from_corners(self, corners_rl: list[tuple[float, float]]) -> BBoxPt:
        xs = [p[0] for p in corners_rl]
        ys = [self.H - p[1] for p in corners_rl]
        return (min(xs), min(ys), max(xs), max(ys))

    def new_page(self) -> None:
        self.c.showPage()
        self.page += 1
        self.pages.append((self.W, self.H))

    # ------------------------------------------------------------------ text

    def _draw_string(
        self,
        x: float,
        y: float,
        s: str,
        font: str,
        size: float,
        color: colors.Color,
        align: str,
        rotation: float,
    ) -> BBoxPt:
        """Draw ``s`` with its baseline at (x, y) and return the ink box (top-left points)."""
        w = pdfmetrics.stringWidth(s, font, size)
        if align == "right":
            x0 = x - w
        elif align == "center":
            x0 = x - w / 2
        else:
            x0 = x
        rx, ry = self._rl(x0, y)
        c = self.c
        c.saveState()
        c.setFillColor(color)
        c.setFont(font, size)
        if rotation:
            c.translate(rx, ry)
            c.rotate(rotation)
            c.drawString(0, 0, s)
        else:
            c.drawString(rx, ry, s)
        c.restoreState()

        # Extents relative to the baseline origin, y up.
        if font in HANDWRITING_FONTS:
            scale = 4
            left, top, right, bottom = _pil_font(font, round(size * scale)).getbbox(s, anchor="ls")
            ex0, ex1 = left / scale, right / scale
            ey_lo, ey_hi = -bottom / scale, -top / scale
        else:
            ascent, descent = pdfmetrics.getAscentDescent(font, size)
            ex0, ex1, ey_lo, ey_hi = 0.0, w, descent, ascent
        corners = [(ex0, ey_lo), (ex1, ey_lo), (ex0, ey_hi), (ex1, ey_hi)]
        th = math.radians(rotation)
        cos_t, sin_t = math.cos(th), math.sin(th)
        rotated = [
            (rx + cx * cos_t - cy * sin_t, ry + cx * sin_t + cy * cos_t) for cx, cy in corners
        ]
        return self._box_from_corners(rotated)

    def text(
        self,
        x: float,
        y: float,
        s: str,
        *,
        font: str = "Helvetica",
        size: float = 9,
        color: colors.Color = BLACK,
        align: str = "left",
    ) -> BBoxPt:
        """Plain text (labels, decoration). Not recorded."""
        return self._draw_string(x, y, s, font, size, color, align, 0.0)

    def field_text(
        self,
        x: float,
        y: float,
        field: str,
        printed: str | None,
        value: str | None = None,
        *,
        size: float = 10,
        font: str = "Helvetica",
        color: colors.Color = BLACK,
        align: str = "left",
        primary: bool = True,
        hand_ok: bool = True,
    ) -> BBoxPt | None:
        """Draw a field value and record it. ``None`` draws nothing (field absent)."""
        if printed is None:
            return None
        value = printed if value is None else value
        if hand_ok and field in self.hw.fields:
            return self.hand(
                x, y, printed, value=value, field=field, size=size, align=align, primary=primary
            )
        box = self._draw_string(x, y, printed, font, size, color, align, 0.0)
        self.items.append(Drawn("field", field, value, printed, self.page, box, "printed", primary))
        return box

    def hand(
        self,
        x: float,
        y: float,
        printed: str,
        *,
        value: str | None = None,
        field: str | None = None,
        size: float = 10,
        align: str = "left",
        primary: bool = True,
        kind: str = "field",
    ) -> BBoxPt:
        """Simulated handwriting: handwriting font, ink colour, jitter and slight rotation."""
        rng = self.rng
        hsize = size * self.hw.scale
        jx, jy = rng.uniform(-2.0, 3.0), rng.uniform(-1.5, 1.5)
        rotation = rng.uniform(-2.5, 2.5)
        box = self._draw_string(
            x + jx, y + jy, printed, self.hw.font, hsize, self.hw.ink, align, rotation
        )
        if field is not None or kind == "test":
            self.items.append(
                Drawn(
                    kind,
                    field,
                    printed if value is None else value,
                    printed,
                    self.page,
                    box,
                    "handwritten",
                    primary,
                )
            )
        return box

    def test_text(
        self,
        x: float,
        y: float,
        printed: str,
        *,
        size: float = 9,
        font: str = "Helvetica",
        color: colors.Color = BLACK,
    ) -> BBoxPt:
        box = self._draw_string(x, y, printed, font, size, color, "left", 0.0)
        self.items.append(Drawn("test", None, printed, printed, self.page, box, "printed", True))
        return box

    def scribble(
        self, x: float, y: float, s: str, *, size: float = 14, max_rotation: float = 8.0
    ) -> None:
        """Decorative handwriting (signatures, notes). Never recorded."""
        rotation = self.rng.uniform(-max_rotation, max_rotation)
        self._draw_string(x, y, s, self.hw.font, size, self.hw.ink, "left", rotation)

    # ------------------------------------------------------------------ shapes

    def line(
        self,
        x0: float,
        y0: float,
        x1: float,
        y1: float,
        *,
        width: float = 0.6,
        color: colors.Color = BLACK,
    ) -> None:
        c = self.c
        c.saveState()
        c.setStrokeColor(color)
        c.setLineWidth(width)
        c.line(*self._rl(x0, y0), *self._rl(x1, y1))
        c.restoreState()

    def rect(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        *,
        stroke: colors.Color | None = BLACK,
        fill: colors.Color | None = None,
        width: float = 0.6,
        radius: float = 0,
    ) -> None:
        c = self.c
        c.saveState()
        if stroke is not None:
            c.setStrokeColor(stroke)
            c.setLineWidth(width)
        if fill is not None:
            c.setFillColor(fill)
        rx, ry = self._rl(x, y + h)
        if radius:
            c.roundRect(rx, ry, w, h, radius, stroke=stroke is not None, fill=fill is not None)
        else:
            c.rect(rx, ry, w, h, stroke=stroke is not None, fill=fill is not None)
        c.restoreState()

    def circle(
        self,
        cx: float,
        cy: float,
        r: float,
        *,
        fill: colors.Color | None = None,
        stroke: colors.Color | None = None,
    ) -> None:
        c = self.c
        c.saveState()
        if fill is not None:
            c.setFillColor(fill)
        if stroke is not None:
            c.setStrokeColor(stroke)
        c.circle(*self._rl(cx, cy), r, stroke=stroke is not None, fill=fill is not None)
        c.restoreState()

    def checkbox(
        self,
        x: float,
        y: float,
        size: float,
        checked: bool,
        *,
        color: colors.Color = BLACK,
        mark: str = "x",
    ) -> BBoxPt:
        """Square box with top-left corner at (x, y). ``mark`` is "x" or "tick"."""
        self.rect(x, y, size, size, stroke=color, width=0.7)
        if checked:
            pad = size * 0.18
            if mark == "tick":
                self.line(
                    x + pad,
                    y + size * 0.55,
                    x + size * 0.42,
                    y + size - pad,
                    width=1.3,
                    color=color,
                )
                self.line(
                    x + size * 0.42, y + size - pad, x + size - pad, y + pad, width=1.3, color=color
                )
            else:
                self.line(x + pad, y + pad, x + size - pad, y + size - pad, width=1.2, color=color)
                self.line(x + pad, y + size - pad, x + size - pad, y + pad, width=1.2, color=color)
        return (x, y, x + size, y + size)

    def sex_boxes(
        self,
        x: float,
        y: float,
        sex: str,
        *,
        labels: tuple[str, str] = ("Hombre", "Mujer"),
        size: float = 9,
        gap: float = 26,
        font: str = "Helvetica",
    ) -> None:
        """Two checkboxes with labels; records Sexo as the checked box plus its label."""
        mark = self.rng.choice(["x", "tick"])
        cursor = x
        side = size * 0.85
        for code, label in (("H", labels[0]), ("M", labels[1])):
            box_top = y - side
            checked = code == sex
            self.checkbox(cursor, box_top, side, checked, mark=mark)
            tb = self.text(cursor + side + 3, y, label, size=size, font=font)
            if checked:
                box = (cursor, min(box_top, tb[1]), tb[2], max(y, tb[3]))
                self.items.append(
                    Drawn("field", "Sexo", sex, f"[X] {label}", self.page, box, "printed", True)
                )
            cursor = tb[2] + gap

    # ------------------------------------------------------------------ barcodes

    def barcode(
        self,
        x: float,
        y: float,
        value: str,
        *,
        height: float = 30,
        bar_width: float = 0.85,
        field: str | None = None,
        primary: bool = False,
        text_size: float = 8,
        text_font: str = "Courier",
    ) -> float:
        """Code128 with its top-left corner at (x, y) and the human-readable value beneath.

        When ``field`` is given the human-readable text is recorded for that field.
        Returns the barcode width.
        """
        bc = code128.Code128(
            value, barWidth=bar_width, barHeight=height, humanReadable=False, quiet=False
        )
        rx, ry = self._rl(x, y + height)
        bc.drawOn(self.c, rx, ry)
        w = float(bc.width)
        ty = y + height + text_size + 1
        if field is not None:
            self.field_text(
                x + w / 2,
                ty,
                field,
                value,
                size=text_size,
                font=text_font,
                align="center",
                primary=primary,
                hand_ok=False,
            )
        else:
            self.text(x + w / 2, ty, value, size=text_size, font=text_font, align="center")
        return w

    def barcode39(
        self, x: float, y: float, value: str, *, height: float = 16, bar_width: float = 0.6
    ) -> float:
        """Code39, decorative (used for distractors such as record numbers). Not recorded."""
        bc = code39.Standard39(
            value,
            barWidth=bar_width,
            barHeight=height,
            checksum=0,
            humanReadable=False,
            quiet=False,
        )
        rx, ry = self._rl(x, y + height)
        bc.drawOn(self.c, rx, ry)
        return float(bc.width)

    # ------------------------------------------------------------------ output

    def save(self) -> bytes:
        self.c.save()
        return self.buf.getvalue()
