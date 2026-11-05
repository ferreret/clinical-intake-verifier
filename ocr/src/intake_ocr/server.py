"""intake-ocr serve: the OCR engines behind HTTP, on the machine that runs the models.

The OCR runs where the language model runs, the AI box, not in the application that sends the
document: the application posts a PDF and gets its OCR document back, as it posts a prompt to
LM Studio and gets a reply. Each engine is loaded once, on its first request, and kept; one
document is read at a time per engine.

    GET  /health                                   engines, those loaded, OCR format version
    POST /ocr?engine=rapidocr&checkboxes=1&dpi=300 body: the PDF (application/pdf)
         -> 200 the OCR document (schema/ocr.schema.json)

Errors are JSON ``{"error": "..."}``: 400 for a bad parameter or a body that is not a PDF, 401
without the token, 413 for a body over MAX_BYTES, 500 when the engine fails. It binds to
127.0.0.1 unless told otherwise: documents are health data, so on a network give it a token
(``--token`` or INTAKE_OCR_TOKEN) and keep it on the local network.
"""

from __future__ import annotations

import hmac
import json
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from intake_ocr.checkboxes import CheckboxDetector
from intake_ocr.document import OCR_VERSION
from intake_ocr.engines import ENGINES, TEXT_ONLY, Engine, make_engine
from intake_ocr.reader import read_document

#: The largest PDF accepted, as the extractor's API route accepts.
MAX_BYTES = 20 * 1024 * 1024
SERVED = tuple(e for e in ENGINES if e not in TEXT_ONLY)


class BadRequest(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status


class OcrService:
    """The engines, made on first use and kept; a lock each, as none is made for threads."""

    def __init__(self, factory=make_engine) -> None:
        self._factory = factory
        self._engines: dict[str, Engine] = {}
        self._locks: dict[str, threading.Lock] = {e: threading.Lock() for e in SERVED}
        self._made = threading.Lock()

    def loaded(self) -> dict[str, str]:
        return {name: e.model for name, e in self._engines.items()}

    def read_engine(self, name: str) -> Engine:
        """The engine ``name``, made now if it was not yet."""
        if name not in SERVED:
            raise BadRequest(HTTPStatus.BAD_REQUEST, f"engine must be one of {', '.join(SERVED)}")
        return self._engine(name)

    def _engine(self, name: str) -> Engine:
        with self._made:
            if name not in self._engines:
                self._engines[name] = self._factory(name)
            return self._engines[name]

    def read(self, data: bytes, engine: str, dpi: int, checkboxes: bool) -> dict:
        if engine not in SERVED:
            raise BadRequest(HTTPStatus.BAD_REQUEST, f"engine must be one of {', '.join(SERVED)}")
        if not 50 <= dpi <= 600:
            raise BadRequest(HTTPStatus.BAD_REQUEST, "dpi must be between 50 and 600")
        if not data.startswith(b"%PDF-"):
            raise BadRequest(HTTPStatus.BAD_REQUEST, "the body is not a PDF")
        ocr = self._engine(engine)
        with self._locks[engine]:
            detector = CheckboxDetector(dpi) if checkboxes else None
            return read_document(data, ocr, dpi=dpi, detector=detector)


def _flag(values: dict[str, list[str]], name: str) -> bool:
    value = values.get(name, ["0"])[-1].lower()
    if value not in ("0", "1", "true", "false"):
        raise BadRequest(HTTPStatus.BAD_REQUEST, f"{name} must be 0 or 1")
    return value in ("1", "true")


def make_handler(service: OcrService, token: str | None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "intake-ocr"

        def _send(self, status: HTTPStatus, body: dict) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorised(self) -> bool:
            if token is None:
                return True
            given = self.headers.get("Authorization", "")
            return hmac.compare_digest(given.encode(), f"Bearer {token}".encode())

        def do_GET(self) -> None:
            if urlparse(self.path).path != "/health":
                return self._send(HTTPStatus.NOT_FOUND, {"error": "GET /health or POST /ocr"})
            if not self._authorised():
                return self._send(HTTPStatus.UNAUTHORIZED, {"error": "a bearer token is needed"})
            self._send(
                HTTPStatus.OK,
                {"ocr_version": OCR_VERSION, "engines": list(SERVED), "loaded": service.loaded()},
            )

        def do_POST(self) -> None:
            url = urlparse(self.path)
            if url.path != "/ocr":
                return self._send(HTTPStatus.NOT_FOUND, {"error": "GET /health or POST /ocr"})
            if not self._authorised():
                return self._send(HTTPStatus.UNAUTHORIZED, {"error": "a bearer token is needed"})
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                return self._send(HTTPStatus.LENGTH_REQUIRED, {"error": "send the PDF's length"})
            if length > MAX_BYTES:
                return self._send(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": f"at most {MAX_BYTES} bytes"}
                )
            data = self.rfile.read(length)
            query = parse_qs(url.query)
            try:
                doc = service.read(
                    data,
                    engine=query.get("engine", ["rapidocr"])[-1],
                    dpi=int(query.get("dpi", ["300"])[-1]),
                    checkboxes=_flag(query, "checkboxes"),
                )
            except BadRequest as err:
                return self._send(err.status, {"error": str(err)})
            except ValueError:
                return self._send(HTTPStatus.BAD_REQUEST, {"error": "dpi must be a number"})
            except Exception as err:  # noqa: BLE001 (any engine failure: the caller gets why)
                return self._send(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{err}"})
            self._send(HTTPStatus.OK, doc)

        def log_message(self, format: str, *args) -> None:
            # One line per request; the body, the document, is never logged.
            print(f"{self.address_string()} {format % args}", flush=True)

    return Handler


def make_server(host: str, port: int, token: str | None, service: OcrService | None = None):
    return ThreadingHTTPServer((host, port), make_handler(service or OcrService(), token))
