"""Small vision models made for OCR, served by LM Studio: PaddleOCR-VL, GLM-OCR and dots.ocr.

They are sent one page image and the prompt each was trained with, through LM Studio's
OpenAI-compatible server, at temperature 0 and top-k 1. What comes back is text: PaddleOCR-VL
and GLM-OCR return the page's lines without positions (PaddleOCR-VL's "Spotting:" returns
them as special tokens, which LM Studio's server does not pass on), and dots.ocr returns
layout blocks, each a paragraph or a list, with one box for all its lines. None gives the
positions per line an OCR document needs, so these engines are measured with ``intake-ocr
bench`` (time per page, and the text to read) rather than written as ``.ocr.json``.

The weights are the GGUF files their authors publish (PaddlePaddle, ggml-org), placed in
LM Studio's models folder; none of their code runs here.
"""

from __future__ import annotations

import base64
import io
import json
import os
import urllib.request

from PIL import Image

from intake_ocr.document import Segment

DEFAULT_SERVER = "http://127.0.0.1:1234/v1"


def server_headers() -> dict[str, str]:
    """JSON, and LM Studio's token when its server requires one (LOCAL_LLM_TOKEN, as in web/)."""
    headers = {"Content-Type": "application/json"}
    token = os.environ.get("LOCAL_LLM_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


#: dots.ocr's own prompt for layout with text (prompt_layout_all_en in its repository, MIT):
#: the model was trained on these words, so they are used as published.
DOTS_LAYOUT = """Please output the layout information from the PDF image, including each layout element's bbox, its category, and the corresponding text content within the bbox.

1. Bbox format: [x1, y1, x2, y2]

2. Layout Categories: The possible categories are ['Caption', 'Footnote', 'Formula', 'List-item', 'Page-footer', 'Page-header', 'Picture', 'Section-header', 'Table', 'Text', 'Title'].

3. Text Extraction & Formatting Rules:
    - Picture: For the 'Picture' category, the text field should be omitted.
    - Formula: Format its text as LaTeX.
    - Table: Format its text as HTML.
    - All Others (Text, Title, etc.): Format their text as Markdown.

4. Constraints:
    - The output text must be the original text from the image, with no translation.
    - All layout elements must be sorted according to human reading order.

5. Final Output: The entire output must be a single JSON object.
"""

#: engine -> (LM Studio model key, prompt, maximum tokens of the reply).
MODELS = {
    "paddle-vl": ("paddleocr-vl-1.6", "OCR:", 4096),
    "glm-ocr": ("glm-ocr", "Text Recognition:", 4096),
    "dots": ("dots.ocr", DOTS_LAYOUT, 8192),
}

#: Pages are sent at this resolution; each model resizes them to its own limit anyway
#: (PaddleOCR-VL: about a megapixel by default).
SEND_DPI = 150


class VlmEngine:
    regroup = False

    def __init__(self, name: str, server: str | None = None) -> None:
        if name not in MODELS:
            raise ValueError(f"unknown vision OCR engine {name!r}")
        self.name = name
        self.model_key, self.prompt, self.max_tokens = MODELS[name]
        self.server = (server or DEFAULT_SERVER).rstrip("/")
        self.last_usage: dict = {}

    @property
    def model(self) -> str:
        return f"{self.model_key} (GGUF) in LM Studio, temperature 0, top-k 1"

    def read_text(self, image: Image.Image) -> str:
        buf = io.BytesIO()
        scale = SEND_DPI / image.info.get("dpi", (SEND_DPI, SEND_DPI))[0]
        if scale < 1:
            image = image.resize((round(image.width * scale), round(image.height * scale)))
        image.save(buf, format="PNG")
        url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        body = {
            "model": self.model_key,
            "temperature": 0,
            "top_k": 1,
            "max_tokens": self.max_tokens,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": url}},
                        {"type": "text", "text": self.prompt},
                    ],
                }
            ],
        }
        request = urllib.request.Request(
            f"{self.server}/chat/completions",
            data=json.dumps(body).encode(),
            headers=server_headers(),
        )
        with urllib.request.urlopen(request, timeout=1800) as response:
            reply = json.load(response)
        self.last_usage = reply.get("usage") or {}
        return reply["choices"][0]["message"]["content"] or ""

    def read(self, image: Image.Image) -> list[Segment]:
        raise NotImplementedError(
            f"{self.name} gives no position per line through LM Studio: use intake-ocr bench"
        )
