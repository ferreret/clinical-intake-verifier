"""Visual check of a golden: render the PDF and paint every recorded box on top of it."""

from __future__ import annotations

import json
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

FIELD_COLOR = (220, 30, 30)
ALSO_AT_COLOR = (245, 140, 0)
TEST_COLOR = (30, 90, 220)


def draw_boxes(golden_path: Path, out_dir: Path | None = None, dpi: int = 110) -> list[Path]:
    with open(golden_path, encoding="utf-8") as fh:
        golden = json.load(fh)
    pdf_path = golden_path.parent / golden["file"]
    out_dir = out_dir or golden_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = pymupdf.open(pdf_path)
    images: list[Image.Image] = []
    for page in doc:
        pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
        images.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    doc.close()

    try:
        font = ImageFont.load_default(size=11)
    except TypeError:  # very old Pillow
        font = ImageFont.load_default()

    def paint(page_no: int, bbox: dict, color: tuple[int, int, int], label: str) -> None:
        img = images[page_no - 1]
        w, h = img.size
        d = ImageDraw.Draw(img)
        x0, y0, x1, y1 = bbox["x0"] * w, bbox["y0"] * h, bbox["x1"] * w, bbox["y1"] * h
        d.rectangle([x0, y0, x1, y1], outline=color, width=2)
        if label:
            d.text((x0, max(0, y0 - 12)), label, fill=color, font=font)

    for name, f in golden["fields"].items():
        if f is None:
            continue
        tag = name + (" ✎" if f["style"] == "handwritten" else "")
        paint(f["page"], f["bbox"], FIELD_COLOR, tag)
        for loc in f["also_at"]:
            paint(loc["page"], loc["bbox"], ALSO_AT_COLOR, f"{name} (also)")
    for i, t in enumerate(golden["tests"], start=1):
        paint(t["page"], t["bbox"], TEST_COLOR, f"test {i}")

    outputs = []
    for i, img in enumerate(images, start=1):
        p = out_dir / f"{golden['id']}-p{i}.boxes.png"
        img.save(p)
        outputs.append(p)
    return outputs
