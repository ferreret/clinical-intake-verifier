"""One PDF read by one engine into an OCR document: what `run` writes and `serve` returns."""

from __future__ import annotations

import hashlib
import time

from intake_ocr.checkboxes import CheckboxDetector
from intake_ocr.document import Page, document_dict, group_lines
from intake_ocr.engines import Engine
from intake_ocr.render import render_pages


def read_document(data: bytes, ocr: Engine, *, dpi: int, detector: CheckboxDetector | None) -> dict:
    """The OCR document of the PDF ``data`` (schema/ocr.schema.json), validated.

    ``elapsed_ms`` covers rendering, OCR and checkboxes; each page's, OCR and checkboxes only.
    """
    started = time.perf_counter()
    pages = []
    doubtful = 0
    for number, image in enumerate(render_pages(data, dpi), start=1):
        image.info["dpi"] = (dpi, dpi)
        t = time.perf_counter()
        segments = ocr.read(image)
        if detector is not None:
            found = detector.detect(image)
            doubtful += sum(1 for c in found if c.state is None)
            segments = detector.attach(segments, found, image.width)
        lines = group_lines(segments, image.width) if ocr.regroup else segments
        ms = round((time.perf_counter() - t) * 1000)
        pages.append(Page(number, image.width, image.height, lines, elapsed_ms=ms))
    return document_dict(
        engine=ocr.name,
        model=ocr.model,
        dpi=dpi,
        sha256=hashlib.sha256(data).hexdigest(),
        pages=pages,
        elapsed_ms=round((time.perf_counter() - started) * 1000),
        checkboxes=detector is not None,
        doubtful_checkboxes=doubtful if detector is not None else None,
    )
