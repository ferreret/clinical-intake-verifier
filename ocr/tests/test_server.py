"""The OCR server, with an engine that needs no model, over a real socket."""

from __future__ import annotations

import hashlib
import io
import json
import threading
import urllib.error
import urllib.request

import pypdfium2 as pdfium
import pytest

from intake_ocr.document import Box, Segment, Word, validate
from intake_ocr.server import OcrService, make_server


class FakeEngine:
    name = "rapidocr"
    regroup = True
    model = "fake"

    def __init__(self) -> None:
        self.calls = 0

    def read(self, image):
        self.calls += 1
        box = Box(100, 100, 300, 140)
        return [Segment("Urea", box, [Word("Urea", box)])]


def _pdf(pages: int = 2) -> bytes:
    doc = pdfium.PdfDocument.new()
    for _ in range(pages):
        doc.new_page(595, 842)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.fixture
def server():
    made: list[str] = []
    engine = FakeEngine()

    def factory(name: str):
        made.append(name)
        return engine

    httpd = make_server("127.0.0.1", 0, "secret", OcrService(factory))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}", made, engine
    httpd.shutdown()
    httpd.server_close()


def _call(url: str, path: str, body: bytes | None = None, token: str | None = "secret"):
    headers = {"Content-Type": "application/pdf"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url + path, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as err:
        return err.code, json.load(err)


def test_a_pdf_posted_comes_back_as_its_ocr_document(server) -> None:
    url, made, engine = server
    pdf = _pdf()
    status, doc = _call(url, "/ocr?engine=rapidocr&dpi=150", pdf)
    assert status == 200
    validate(doc)
    assert doc["sha256"] == hashlib.sha256(pdf).hexdigest()
    assert doc["engine"] == "rapidocr" and doc["dpi"] == 150 and doc["checkboxes"] is False
    assert [p["lines"][0]["text"] for p in doc["pages"]] == ["Urea", "Urea"]
    # The engine is made once and kept.
    _call(url, "/ocr", pdf)
    assert made == ["rapidocr"] and engine.calls == 4


def test_checkboxes_are_looked_for_when_asked(server) -> None:
    url, _, _ = server
    status, doc = _call(url, "/ocr?checkboxes=1", _pdf(1))
    assert status == 200
    assert doc["checkboxes"] is True and doc["doubtful_checkboxes"] == 0


def test_health_lists_the_engines_and_those_loaded(server) -> None:
    url, _, _ = server
    status, body = _call(url, "/health")
    assert status == 200
    assert body["ocr_version"] == 1 and "rapidocr" in body["engines"] and body["loaded"] == {}


@pytest.mark.parametrize(
    "path,body,token,status",
    [
        ("/ocr", b"%PDF-", None, 401),
        ("/health", None, "wrong", 401),
        ("/ocr", b"not a pdf", "secret", 400),
        ("/ocr?engine=paddle-vl", b"%PDF-", "secret", 400),
        ("/ocr?dpi=9000", b"%PDF-", "secret", 400),
        ("/ocr?checkboxes=yes", b"%PDF-", "secret", 400),
        ("/nothing", b"%PDF-", "secret", 404),
    ],
)
def test_bad_requests_are_refused_with_a_reason(server, path, body, token, status) -> None:
    url, made, _ = server
    code, reply = _call(url, path, body, token)
    assert code == status and reply["error"]
    assert made == []
