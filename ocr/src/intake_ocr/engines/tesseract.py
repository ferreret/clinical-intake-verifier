"""Tesseract, the native binary, with Spanish and Catalan: its own lines, with word boxes.

Needs ``tesseract`` with the ``spa`` and ``cat`` data on the PATH (Ubuntu: ``tesseract-ocr``,
``tesseract-ocr-spa``, ``tesseract-ocr-cat``). Lines are Tesseract's, in its reading order
(block, paragraph, line), as the extractor's in-process Tesseract gives them.
"""

from __future__ import annotations

import io
import shutil
import subprocess

from PIL import Image

from intake_ocr.document import Box, Segment, Word

LANGUAGES = "spa+cat"


def parse_tsv(tsv: str) -> list[Segment]:
    """Tesseract's TSV (level 5 rows are words) as one segment per line, words in order."""
    lines: dict[tuple[int, int, int, int], list[Word]] = {}
    rows = tsv.splitlines()
    header = rows[0].split("\t")
    col = {name: i for i, name in enumerate(header)}
    for row in rows[1:]:
        cells = row.split("\t")
        if len(cells) < len(header) or cells[col["level"]] != "5":
            continue
        text = cells[col["text"]].strip()
        # Words of punctuation alone are left out, as the extractor's OCR does.
        if not any(ch.isalnum() for ch in text):
            continue
        left, top = int(cells[col["left"]]), int(cells[col["top"]])
        width, height = int(cells[col["width"]]), int(cells[col["height"]])
        key = tuple(int(cells[col[k]]) for k in ("page_num", "block_num", "par_num", "line_num"))
        lines.setdefault(key, []).append(Word(text, Box(left, top, left + width, top + height)))
    out = []
    for words in lines.values():
        box = words[0].box
        for w in words[1:]:
            box = box.union(w.box)
        out.append(Segment(text=" ".join(w.text for w in words), box=box, words=words))
    return out


class TesseractEngine:
    name = "tesseract"
    regroup = False

    def __init__(self, binary: str = "tesseract") -> None:
        found = shutil.which(binary)
        if found is None:
            raise RuntimeError(
                "tesseract is not installed: sudo apt install tesseract-ocr tesseract-ocr-spa "
                "tesseract-ocr-cat"
            )
        self.binary = found
        langs = subprocess.run(
            [found, "--list-langs"], capture_output=True, text=True, check=True
        ).stdout.split()
        missing = [lang for lang in LANGUAGES.split("+") if lang not in langs]
        if missing:
            raise RuntimeError(f"tesseract has no data for {', '.join(missing)}")
        version = subprocess.run(
            [found, "--version"], capture_output=True, text=True, check=True
        ).stdout.splitlines()[0]
        self._model = f"{version.strip()}, {LANGUAGES}, LSTM"

    @property
    def model(self) -> str:
        return self._model

    def read(self, image: Image.Image) -> list[Segment]:
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        dpi = image.info.get("dpi", (300, 300))[0]
        result = subprocess.run(
            [
                self.binary,
                "stdin",
                "stdout",
                "-l",
                LANGUAGES,
                "--oem",
                "1",
                "--dpi",
                str(dpi),
                "tsv",
            ],
            input=buf.getvalue(),
            capture_output=True,
            check=True,
        )
        return parse_tsv(result.stdout.decode("utf-8"))
