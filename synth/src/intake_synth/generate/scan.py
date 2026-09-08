"""Scanner simulation: rasterise, rotate/shift, blur, add grain, compress, re-embed as an
image-only PDF. The same geometry is applied to the recorded boxes so the golden describes
the delivered PDF, not the clean one.
"""

from __future__ import annotations

import hashlib
import io
import math
import random
from dataclasses import dataclass

import numpy as np
import pymupdf
from PIL import Image, ImageEnhance, ImageFilter

BBoxPt = tuple[float, float, float, float]


@dataclass(frozen=True)
class ScanParams:
    dpi: int
    rotation_deg: float
    offset_px: tuple[int, int]
    blur: float
    noise: float
    jpeg_quality: int
    grayscale: bool
    brightness: float
    contrast: float
    lamp: float  # horizontal shading strength, 0 = none

    def public(self) -> dict:
        """Subset recorded in the golden (see golden.schema.json)."""
        return {
            "dpi": self.dpi,
            "rotation_deg": round(self.rotation_deg, 3),
            "blur": round(self.blur, 3),
            "noise": round(self.noise, 4),
            "jpeg_quality": self.jpeg_quality,
            "grayscale": self.grayscale,
        }


def sample_scan_params(rng: random.Random, dpi: int = 200) -> ScanParams:
    return ScanParams(
        dpi=dpi,
        rotation_deg=rng.uniform(-1.6, 1.6),
        offset_px=(rng.randint(-12, 12), rng.randint(-12, 12)),
        blur=rng.uniform(0.2, 0.9),
        noise=rng.uniform(0.005, 0.03),
        jpeg_quality=rng.randint(45, 80),
        grayscale=rng.random() < 0.6,
        brightness=rng.uniform(0.92, 1.06),
        contrast=rng.uniform(0.85, 1.1),
        lamp=rng.uniform(0.0, 0.08),
    )


# --------------------------------------------------------------------------- geometry


def map_point(
    x: float, y: float, w: float, h: float, p: ScanParams, px_per_unit: float
) -> tuple[float, float]:
    """Map a point through the same transform :func:`scan_image` applies.

    ``w``/``h`` are the page size in the point's units; ``px_per_unit`` converts the pixel
    offset into those units (use 1.0 when the point is already in pixels).
    """
    cx, cy = w / 2.0, h / 2.0
    rx, ry = x - cx, y - cy
    th = math.radians(p.rotation_deg)
    cos_t, sin_t = math.cos(th), math.sin(th)
    # PIL.Image.rotate(angle) is counter-clockwise on screen (y down).
    nx = cx + rx * cos_t + ry * sin_t + p.offset_px[0] / px_per_unit
    ny = cy - rx * sin_t + ry * cos_t + p.offset_px[1] / px_per_unit
    return nx, ny


def transform_box(box: BBoxPt, w: float, h: float, p: ScanParams, px_per_unit: float) -> BBoxPt:
    x0, y0, x1, y1 = box
    pts = [
        map_point(x, y, w, h, p, px_per_unit) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))
    ]
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    return (max(0.0, min(xs)), max(0.0, min(ys)), min(w, max(xs)), min(h, max(ys)))


def transform_box_pt(box: BBoxPt, page_w_pt: float, page_h_pt: float, p: ScanParams) -> BBoxPt:
    return transform_box(box, page_w_pt, page_h_pt, p, px_per_unit=p.dpi / 72.0)


# --------------------------------------------------------------------------- raster


def scan_image(img: Image.Image, p: ScanParams, np_rng: np.random.Generator) -> Image.Image:
    """Apply the scanner look to one rendered page (RGB)."""
    w, h = img.size
    out = img.convert("RGB")
    if p.rotation_deg:
        out = out.rotate(
            p.rotation_deg,
            resample=Image.Resampling.BICUBIC,
            expand=False,
            fillcolor=(255, 255, 255),
        )
    if p.offset_px != (0, 0):
        canvas = Image.new("RGB", (w, h), (255, 255, 255))
        canvas.paste(out, p.offset_px)
        out = canvas
    if p.blur > 0:
        out = out.filter(ImageFilter.GaussianBlur(radius=p.blur))
    if p.brightness != 1.0:
        out = ImageEnhance.Brightness(out).enhance(p.brightness)
    if p.contrast != 1.0:
        out = ImageEnhance.Contrast(out).enhance(p.contrast)

    arr = np.asarray(out).astype(np.float32)
    if p.lamp > 0:
        ramp = 1.0 - p.lamp * np.linspace(0.0, 1.0, w, dtype=np.float32)
        arr *= ramp[None, :, None]
    if p.noise > 0:
        arr += np_rng.normal(0.0, p.noise * 255.0, size=arr.shape).astype(np.float32)
        specks = np_rng.random((h, w)) < p.noise * 0.02
        arr[specks] = np_rng.uniform(0, 90, size=(int(specks.sum()), 3))
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    out = Image.fromarray(arr, "RGB")
    if p.grayscale:
        out = out.convert("L")
    return out


def _jpeg_bytes(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def scan_pdf(pdf_bytes: bytes, p: ScanParams, np_rng: np.random.Generator) -> bytes:
    """Return an image-only PDF with the same page sizes as the input."""
    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    dst = pymupdf.open()
    digest = hashlib.sha256(repr(p).encode())
    for page in src:
        pix = page.get_pixmap(dpi=p.dpi, colorspace=pymupdf.csRGB, alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        scanned = scan_image(img, p, np_rng)
        jpeg = _jpeg_bytes(scanned, p.jpeg_quality)
        digest.update(jpeg)
        new_page = dst.new_page(width=page.rect.width, height=page.rect.height)
        new_page.insert_image(new_page.rect, stream=jpeg)
    dst.set_metadata(
        {
            "title": "Synthetic laboratory request (scanned)",
            "author": "intake-synth",
            "creator": "intake-synth",
            "producer": "intake-synth",
            "subject": "Synthetic document. No real patient data.",
            "creationDate": "D:20260101000000Z",
            "modDate": "D:20260101000000Z",
        }
    )
    # pymupdf would otherwise write a random trailer /ID, breaking byte-level reproducibility.
    file_id = digest.hexdigest()[:32].upper()
    dst.xref_set_key(-1, "ID", f"[<{file_id}><{file_id}>]")
    out = dst.tobytes(garbage=3, deflate=True, no_new_id=True)
    dst.close()
    src.close()
    return out
