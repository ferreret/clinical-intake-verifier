"""RapidOCR on ONNX Runtime, CPU only, with the PP-OCRv6 models (multilingual, Latin script).

Its detector finds pieces of text (a label, a value, a cell), each with its words;
document.group_lines joins them into lines. A piece's text is made of its words
(document.line_text): the text RapidOCR gives for it drops some of their spaces. The models are fetched by RapidOCR from its model
hub on first use and kept in data/models/rapidocr, outside the repository.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from intake_ocr.document import Box, Segment, Word, line_text, repo_root

#: The detector and recogniser size: tiny, small or medium.
MODEL_TYPE = "small"
#: RapidOCR shrinks a page whose longer side exceeds this; a 300 dpi A4 page is 3508 high.
MAX_SIDE = 4000


class RapidEngine:
    name = "rapidocr"
    regroup = True

    def __init__(self, model_type: str = MODEL_TYPE, models_dir: Path | None = None) -> None:
        from rapidocr import ModelType, OCRVersion, RapidOCR
        from rapidocr._version import __version__ as rapid_version

        models = models_dir or repo_root() / "data" / "models" / "rapidocr"
        models.mkdir(parents=True, exist_ok=True)
        self._engine = RapidOCR(
            params={
                "Global.max_side_len": MAX_SIDE,
                "Global.log_level": "warning",
                "Global.model_root_dir": str(models),
                "Det.ocr_version": OCRVersion.PPOCRV6,
                "Det.model_type": ModelType(model_type),
                "Rec.ocr_version": OCRVersion.PPOCRV6,
                "Rec.model_type": ModelType(model_type),
            }
        )
        self._model = f"RapidOCR {rapid_version}, PP-OCRv6 det/rec {model_type}, onnxruntime CPU"

    @property
    def model(self) -> str:
        return self._model

    def read(self, image: Image.Image) -> list[Segment]:
        result = self._engine(np.array(image), return_word_box=True)
        if result.boxes is None:
            return []
        words_of = result.word_results or [()] * len(result.txts)
        segments = []
        for points, text, words in zip(result.boxes, result.txts, words_of):
            ws = [Word(w[0], Box.of_points(w[2])) for w in words if w[0].strip()]
            segments.append(Segment(line_text(ws, text), box=Box.of_points(points), words=ws))
        return segments
