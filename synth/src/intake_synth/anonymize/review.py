"""The reviewer's page: a local web server to check and correct each document's plan.

Bound to 127.0.0.1 only: the documents are real until anonymized. It serves the page images, the
plans, a painted preview of unsaved changes, and writes plans and anonymized PDFs into the work
directory. Standard library only.
"""

from __future__ import annotations

import csv
import json
import re
import threading
from functools import cache
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .paint import apply_plan, page_count, page_png, page_sizes
from .plan import KINDS, PERSONAL_FIELDS, STYLES, Plan, load_plan, save_plan
from .propose import documents, new_plan

PAGE_DPI = 110
MAX_BODY = 2_000_000
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


class Review:
    """The documents under review and where their plans and results go."""

    def __init__(self, docs_dir: Path, work: Path, info: Path | None = None) -> None:
        self.docs_dir = docs_dir
        self.work = work
        self.pdfs = {p.stem: p for p in documents(docs_dir)}
        self.info = _read_info(info)
        self.lock = threading.Lock()

    def pdf(self, doc: str) -> Path:
        if not _NAME.match(doc) or doc not in self.pdfs:
            raise KeyError(doc)
        return self.pdfs[doc]

    @cache  # noqa: B019 - one Review per server, documents do not change while it runs
    def pages(self, doc: str) -> int:
        return page_count(self.pdf(doc))

    def plan(self, doc: str) -> Plan:
        return load_plan(self.work, doc) or new_plan(doc, self.pdf(doc).name, None)

    def summary(self) -> list[dict]:
        out = []
        for doc in self.pdfs:
            plan = load_plan(self.work, doc)
            out.append(
                {
                    "doc": doc,
                    "boxes": len(plan.boxes) if plan else 0,
                    "reviewed": bool(plan and plan.reviewed),
                    "applied": (self.work / "out" / f"{doc}.pdf").exists(),
                    "info": self.info.get(doc.lower(), ""),
                }
            )
        return out

    def save(self, doc: str, data: dict) -> Plan:
        plan = Plan.from_json(data)
        if plan.doc != doc:
            raise ValueError("the plan is for another document")
        with self.lock:
            save_plan(self.work, plan, self.pages(doc))
        return plan

    def apply(self, doc: str) -> dict:
        plan = self.plan(doc)
        truth = apply_plan(self.pdf(doc), plan, self.work / "out" / f"{doc}.pdf")
        (self.work / "out" / f"{doc}.truth.json").write_text(
            json.dumps(truth, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        return truth


def _read_info(path: Path | None) -> dict[str, str]:
    """Optional notes per document from a manifest (columns ``file`` and ``what_is_handwritten``)."""
    if not path or not path.exists():
        return {}
    with path.open(encoding="utf-8") as fh:
        return {
            r["file"].lower(): r.get("what_is_handwritten", "")
            for r in csv.DictReader(fh, delimiter="\t")
            if r.get("file")
        }


def make_handler(review: Review) -> type[BaseHTTPRequestHandler]:
    page_html = (Path(__file__).with_name("review.html")).read_bytes()

    class Handler(BaseHTTPRequestHandler):
        server_version = "anon-review"

        def log_message(self, fmt: str, *args) -> None:  # quiet: paths name the documents
            pass

        def _send(self, status: int, body: bytes, ctype: str, cache: bool = False) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, max-age=3600" if cache else "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, data, status: int = 200) -> None:
            self._send(status, json.dumps(data, ensure_ascii=False).encode(), "application/json")

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise ValueError("body too large")
            return json.loads(self.rfile.read(n) or b"{}")

        def _route(self, method: str) -> None:
            url = urlparse(self.path)
            parts = [p for p in url.path.split("/") if p]
            try:
                if method == "GET" and not parts:
                    return self._send(200, page_html, "text/html; charset=utf-8")
                if parts[:1] != ["api"]:
                    return self._json({"error": "not found"}, 404)
                route = parts[1:]
                if method == "GET" and route == ["docs"]:
                    return self._json(
                        {
                            "docs": review.summary(),
                            "kinds": KINDS,
                            "styles": STYLES,
                            "personal": PERSONAL_FIELDS,
                        }
                    )
                if method == "GET" and len(route) == 2 and route[0] == "doc":
                    doc = route[1]
                    sizes = page_sizes(review.pdf(doc))
                    return self._json(
                        {
                            "plan": review.plan(doc).to_json(),
                            "pages": [{"width_pt": w, "height_pt": h} for w, h in sizes],
                            "info": review.info.get(doc.lower(), ""),
                        }
                    )
                if len(route) == 3 and route[0] in ("page", "preview"):
                    doc, number = route[1], int(route[2].removesuffix(".png"))
                    if not 1 <= number <= review.pages(doc):
                        return self._json({"error": "no such page"}, 404)
                    if route[0] == "page" and method == "GET":
                        dpi = int(parse_qs(url.query).get("dpi", [PAGE_DPI])[0])
                        return self._send(
                            200,
                            page_png(review.pdf(doc), number, min(dpi, 200)),
                            "image/png",
                            cache=True,
                        )
                    if route[0] == "preview" and method == "POST":
                        plan = Plan.from_json(self._body())
                        plan.validate(review.pages(doc))
                        return self._send(
                            200, page_png(review.pdf(doc), number, PAGE_DPI, plan), "image/png"
                        )
                if method == "PUT" and len(route) == 2 and route[0] == "plan":
                    plan = review.save(route[1], self._body())
                    return self._json({"ok": True, "boxes": len(plan.boxes)})
                if method == "POST" and len(route) == 2 and route[0] == "apply":
                    truth = review.apply(route[1])
                    return self._json({"ok": True, "fields": truth["fields"]})
                return self._json({"error": "not found"}, 404)
            except KeyError:
                return self._json({"error": "unknown document"}, 404)
            except (ValueError, TypeError, json.JSONDecodeError) as err:
                return self._json({"error": str(err)}, HTTPStatus.BAD_REQUEST)

        def do_GET(self) -> None:
            self._route("GET")

        def do_PUT(self) -> None:
            self._route("PUT")

        def do_POST(self) -> None:
            self._route("POST")

    return Handler


def serve(docs_dir: Path, work: Path, port: int, info: Path | None = None) -> None:
    review = Review(docs_dir, work, info)
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(review))
    print(
        f"{len(review.pdfs)} documents; open http://127.0.0.1:{port}/  (Ctrl+C to stop)", flush=True
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
