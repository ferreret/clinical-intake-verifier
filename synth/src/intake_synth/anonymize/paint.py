"""Paint a plan onto a document's pages and rebuild it as an image-only PDF.

Each page is rendered to an image (PyMuPDF decodes the scanners' CCITT, JPEG 2000 and JBIG2
images), every box is filled with the paper's colour around it, its fictitious text is written in
the ink colour found inside it, and the PDF is rebuilt from the images alone: no text layer, no
original image under the paint, no metadata. A bilevel scan stays bilevel.
"""

from __future__ import annotations

import io
import random
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import pymupdf as fitz
from PIL import Image, ImageDraw, ImageFont

from ..generate.recorder import HANDWRITING_FONTS, fonts_dir
from .plan import COVER, Box, Plan

OUTPUT_DPI = 300
_PRINT_FONTS = (
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
)
_PAD = 0.002  # fraction of the page added around a box, so a stroke's edge is covered too
_MAX_INK = 100  # the lightest ink written, in luminance: well under the bilevel threshold (150)


@dataclass
class RenderedPage:
    image: Image.Image  # RGB
    bilevel: bool
    width_pt: float
    height_pt: float


def page_count(pdf: Path) -> int:
    with fitz.open(pdf) as doc:
        return doc.page_count


def page_sizes(pdf: Path) -> list[tuple[float, float]]:
    with fitz.open(pdf) as doc:
        return [(p.rect.width, p.rect.height) for p in doc]


def render(pdf: Path, page: int, dpi: int) -> RenderedPage:
    with fitz.open(pdf) as doc:
        p = doc[page - 1]
        images = p.get_images(full=True)
        bilevel = bool(images) and all(img[4] == 1 for img in images)
        pix = p.get_pixmap(
            matrix=fitz.Matrix(dpi / 72, dpi / 72), alpha=False, colorspace=fitz.csRGB
        )
        image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        return RenderedPage(image, bilevel, p.rect.width, p.rect.height)


@cache
def _font_file(style: str, hand: str) -> str | None:
    if style == "hand":
        return str(fonts_dir() / HANDWRITING_FONTS[hand])
    return next((f for f in _PRINT_FONTS if Path(f).exists()), None)


def _font(style: str, hand: str, size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    path = _font_file(style, hand)
    return ImageFont.truetype(path, size) if path else ImageFont.load_default(size)


def _pixels(box: Box, w: int, h: int) -> tuple[int, int, int, int]:
    x0 = max(0, int((box.x0 - _PAD) * w))
    y0 = max(0, int((box.y0 - _PAD) * h))
    x1 = min(w, round((box.x1 + _PAD) * w))
    y1 = min(h, round((box.y1 + _PAD) * h))
    return x0, y0, max(x0 + 1, x1), max(y0 + 1, y1)


def _paper_and_ink(image: Image.Image, rect: tuple[int, int, int, int]) -> tuple[tuple, tuple]:
    """The paper's colour in a ring around ``rect`` and the ink's colour inside it."""
    x0, y0, x1, y1 = rect
    w, h = image.size
    ring = max(3, (y1 - y0) // 6)
    outer = (max(0, x0 - ring), max(0, y0 - ring), min(w, x1 + ring), min(h, y1 + ring))
    around = [
        px
        for (a, b, c, d) in (
            (outer[0], outer[1], outer[2], y0),
            (outer[0], y1, outer[2], outer[3]),
            (outer[0], y0, x0, y1),
            (x1, y0, outer[2], y1),
        )
        if c > a and d > b
        for px in image.crop((a, b, c, d)).get_flattened_data()
    ]
    light = sorted(around, key=sum)[len(around) // 2 :] if around else []
    paper = (
        tuple(sorted(c[i] for c in light)[len(light) // 2] for i in range(3))
        if light
        else (255, 255, 255)
    )
    inside = sorted(image.crop(rect).get_flattened_data(), key=sum)
    dark = inside[: max(1, len(inside) // 25)]
    ink = tuple(sorted(c[i] for c in dark)[len(dark) // 2] for i in range(3))
    if sum(paper) - sum(ink) < 150:  # nothing written there: a dark grey that reads as ink
        ink = (40, 40, 40)
    # Faint ink (a pale stamp, pencil) would be lost when a bilevel page is thresholded: the
    # text keeps its hue, darkened until it reads.
    lum = 0.299 * ink[0] + 0.587 * ink[1] + 0.114 * ink[2]
    if lum > _MAX_INK:
        ink = tuple(int(c * _MAX_INK / lum) for c in ink)
    return paper, ink


def _write(draw: ImageDraw.ImageDraw, rect, text: str, style: str, hand: str, ink: tuple) -> None:
    x0, y0, x1, y1 = rect
    bw, bh = x1 - x0, y1 - y0
    size = max(6, int(bh * (0.95 if style == "hand" else 0.78)))
    while True:
        font = _font(style, hand, size)
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        if (right - left <= bw * 0.97 and bottom - top <= bh) or size <= 6:
            break
        size = max(6, int(size * 0.92))
    tx = x0 + max(0, int(bw * 0.015)) - left
    ty = y0 + (bh - (bottom - top)) // 2 - top
    draw.text((tx, ty), text, fill=ink, font=font)


def hand_font_for(doc: str) -> str:
    """The handwriting font of a document: one per document, as one person wrote it."""
    return random.Random(f"anon-font:{doc}").choice(sorted(HANDWRITING_FONTS))


def paint(page: RenderedPage, boxes: list[Box], plan: Plan) -> Image.Image:
    """The page's image with the boxes covered and their text written. Returns RGB."""
    image = page.image.copy()
    w, h = image.size
    draw = ImageDraw.Draw(image)
    hand = hand_font_for(plan.doc)
    # Colours are taken from the page as scanned, and every box is filled before any text is
    # written: a cover next to a value never erases it, whatever the order of the boxes.
    filled = []
    for box in boxes:
        rect = _pixels(box, w, h)
        paper, ink = _paper_and_ink(page.image, rect)
        draw.rectangle(rect, fill=paper)
        filled.append((box, rect, ink))
    for box, rect, ink in filled:
        text = plan.text_for(box)
        if text and box.kind != COVER:
            _write(draw, rect, text, box.style, hand, ink)
    return image


def _final(image: Image.Image, bilevel: bool) -> Image.Image:
    if bilevel:
        return image.convert("L").point(lambda v: 255 if v > 150 else 0, mode="1")
    return image.convert("L") if _is_grey(image) else image


def _is_grey(image: Image.Image) -> bool:
    small = image.resize((64, 64))
    return all(max(px) - min(px) < 18 for px in small.get_flattened_data())


def apply_plan(pdf: Path, plan: Plan, out_pdf: Path, dpi: int = OUTPUT_DPI) -> dict:
    """Writes the anonymized PDF; returns what was written where (the fictitious truth)."""
    n = page_count(pdf)
    plan.validate(n)
    pages: list[Image.Image] = []
    for number in range(1, n + 1):
        rendered = render(pdf, number, dpi)
        boxes = [b for b in plan.boxes if b.page == number]
        pages.append(_final(paint(rendered, boxes, plan), rendered.bilevel))
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_pdf.with_suffix(".pdf.tmp")
    # Bilevel pages are stored as CCITT fax, the rest as JPEG at Pillow's default quality: an
    # encoder option would reach the CCITT encoder too, which rejects it.
    pages[0].save(tmp, "PDF", save_all=True, append_images=pages[1:], resolution=dpi)
    tmp.replace(out_pdf)
    return {
        "doc": plan.doc,
        "source_pdf": plan.pdf,
        "pages": n,
        "fields": plan.written(),
        "boxes": [
            {
                "page": b.page,
                "x0": b.x0,
                "y0": b.y0,
                "x1": b.x1,
                "y1": b.y1,
                "kind": b.kind,
                "text": plan.text_for(b),
            }
            for b in plan.boxes
        ],
    }


def page_png(pdf: Path, page: int, dpi: int, plan: Plan | None = None) -> bytes:
    """One page as PNG, painted with ``plan`` when given (the reviewer's preview)."""
    rendered = render(pdf, page, dpi)
    image = rendered.image
    if plan is not None:
        image = _final(
            paint(rendered, [b for b in plan.boxes if b.page == page], plan), rendered.bilevel
        )
    buf = io.BytesIO()
    image.save(buf, "PNG", optimize=False, compress_level=3)
    return buf.getvalue()
