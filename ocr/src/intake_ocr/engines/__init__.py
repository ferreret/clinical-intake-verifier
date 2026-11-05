"""The engines, by the name given to ``intake-ocr run --engine``.

Each one reads a page image and returns segments (document.Segment) in pixels. ``regroup``
says whether they are pieces of lines that document.group_lines must join, or already lines.
"""

from __future__ import annotations

from typing import Protocol

from PIL import Image

from intake_ocr.document import Segment


class Engine(Protocol):
    name: str
    #: Joined into lines by document.group_lines, or lines already.
    regroup: bool

    @property
    def model(self) -> str | None: ...

    def read(self, image: Image.Image) -> list[Segment]: ...


ENGINES = ("tesseract", "rapidocr", "paddle-vl", "glm-ocr", "dots")
#: Engines that give text without a position per line: measured with intake-ocr bench only.
TEXT_ONLY = ("paddle-vl", "glm-ocr", "dots")


def make_engine(name: str, **options) -> Engine:
    if name == "tesseract":
        from intake_ocr.engines.tesseract import TesseractEngine

        return TesseractEngine(**options)
    if name == "rapidocr":
        from intake_ocr.engines.rapid import RapidEngine

        return RapidEngine(**options)
    if name in TEXT_ONLY:
        from intake_ocr.engines.vlm import VlmEngine

        return VlmEngine(name, **options)
    raise ValueError(f"unknown engine {name!r}: use one of {', '.join(ENGINES)}")
