"""Visual check of a golden: render the PDF and paint every recorded box on top of it.

With a prediction alongside, the extractor's boxes are painted on the same images so that
golden and prediction can be compared page by page.
"""

from __future__ import annotations

import json
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

FIELD_COLOR = (220, 30, 30)
ALSO_AT_COLOR = (245, 140, 0)
TEST_COLOR = (30, 90, 220)
PRED_FIELD_COLOR = (30, 160, 70)
PRED_TEST_COLOR = (160, 40, 180)


def draw_boxes(
    golden_path: Path,
    out_dir: Path | None = None,
    dpi: int = 110,
    prediction_path: Path | None = None,
) -> list[Path]:
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

    def paint(
        page_no: int, bbox: dict, color: tuple[int, int, int], label: str, below: bool = False
    ) -> None:
        if not 1 <= page_no <= len(images):
            return
        img = images[page_no - 1]
        w, h = img.size
        d = ImageDraw.Draw(img)
        x0, y0, x1, y1 = bbox["x0"] * w, bbox["y0"] * h, bbox["x1"] * w, bbox["y1"] * h
        d.rectangle([x0, y0, x1, y1], outline=color, width=2)
        if label:
            y_text = y1 + 2 if below else max(0, y0 - 12)
            d.text((x0, y_text), label, fill=color, font=font)

    for name, f in golden["fields"].items():
        if f is None:
            continue
        tag = name + (" ✎" if f["style"] == "handwritten" else "")
        paint(f["page"], f["bbox"], FIELD_COLOR, tag)
        for loc in f["also_at"]:
            paint(loc["page"], loc["bbox"], ALSO_AT_COLOR, f"{name} (also)")
    for i, t in enumerate(golden["tests"], start=1):
        paint(t["page"], t["bbox"], TEST_COLOR, f"test {i}")
        for loc in t["also_at"]:
            paint(loc["page"], loc["bbox"], ALSO_AT_COLOR, f"test {i} (also)")

    suffix = "boxes"
    if prediction_path is not None:
        with open(prediction_path, encoding="utf-8") as fh:
            pred = json.load(fh)
        if pred.get("sha256") != golden["sha256"]:
            raise ValueError(
                f"{prediction_path.name} was made from a different PDF than {golden_path.name}"
            )
        for name, f in pred["fields"].items():
            if f is None or f["page"] is None or f["bbox"] is None:
                continue
            paint(f["page"], f["bbox"], PRED_FIELD_COLOR, f"P:{name}", below=True)
        for i, t in enumerate(pred["tests"], start=1):
            if t["page"] is None or t["bbox"] is None:
                continue
            paint(t["page"], t["bbox"], PRED_TEST_COLOR, f"P:test {i}", below=True)
        suffix = "compare"

    outputs = []
    for i, img in enumerate(images, start=1):
        p = out_dir / f"{golden['id']}-p{i}.{suffix}.png"
        img.save(p)
        outputs.append(p)
    return outputs
