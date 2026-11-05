"""PDF pages to images, with pdfium (pypdfium2): no system tool needed."""

from __future__ import annotations

from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image


def render_pages(pdf: Path | bytes, dpi: int) -> list[Image.Image]:
    """One RGB image per page, in page order, on a white background."""
    doc = pdfium.PdfDocument(str(pdf) if isinstance(pdf, Path) else pdf)
    try:
        return [page.render(scale=dpi / 72).to_pil().convert("RGB") for page in doc]
    finally:
        doc.close()
