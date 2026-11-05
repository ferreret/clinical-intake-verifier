"""intake-ocr: read a directory of PDFs with one engine and write one <id>.ocr.json each.

    uv run intake-ocr run --engine rapidocr --in ../data/synth/seed-42 \\
        --out ../data/ocr/rapidocr/seed-42 [--dpi 300] [--checkboxes] [--limit 20]

Reads only the PDFs, never the goldens. A document already read with the same engine, dpi and
checkbox setting is skipped unless --force. A run.json beside the files keeps what was run and
the time per page.
"""

from __future__ import annotations

import hashlib
import json
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import typer

from intake_ocr.document import Page, document_dict, group_lines
from intake_ocr.engines import ENGINES, TEXT_ONLY, make_engine
from intake_ocr.render import render_pages

app = typer.Typer(add_completion=False, no_args_is_help=True)


@app.callback()
def main() -> None:
    """OCR engines with positions, for the extractor's text pipeline."""


def _matches(existing: dict, engine: str, dpi: int, checkboxes: bool) -> bool:
    return (
        existing.get("engine") == engine
        and existing.get("dpi") == dpi
        and bool(existing.get("checkboxes")) == checkboxes
    )


@app.command()
def run(
    engine: Annotated[str, typer.Option(help=f"One of: {', '.join(ENGINES)}.")],
    in_dir: Annotated[Path, typer.Option("--in", help="Directory of PDFs.")],
    out: Annotated[Path, typer.Option(help="Where the <id>.ocr.json files go.")],
    dpi: Annotated[int, typer.Option(help="Resolution the pages are rendered at.")] = 300,
    checkboxes: Annotated[bool, typer.Option(help="Look for checkboxes and mark lines.")] = False,
    limit: Annotated[int | None, typer.Option(help="Only the first N PDFs.")] = None,
    only: Annotated[str | None, typer.Option(help="Comma-separated document ids.")] = None,
    force: Annotated[bool, typer.Option(help="Read again documents already read.")] = False,
    server: Annotated[
        str | None, typer.Option(help="llama-server URL, for the engines served by one.")
    ] = None,
) -> None:
    """Read every PDF of --in with one engine."""
    if engine in TEXT_ONLY:
        raise typer.BadParameter(f"{engine} gives no position per line: use intake-ocr bench")
    pdfs = sorted(p for p in in_dir.glob("*.pdf"))
    if only:
        wanted = {s.strip() for s in only.split(",") if s.strip()}
        pdfs = [p for p in pdfs if p.stem in wanted]
    if limit is not None:
        pdfs = pdfs[:limit]
    if not pdfs:
        raise typer.BadParameter(f"no PDFs to read in {in_dir}")
    options = {"server": server} if server else {}
    ocr = make_engine(engine, **options)
    detector = None
    if checkboxes:
        from intake_ocr.checkboxes import CheckboxDetector

        detector = CheckboxDetector(dpi)
    out.mkdir(parents=True, exist_ok=True)
    typer.echo(f"{engine} ({ocr.model}), {dpi} dpi, checkboxes {checkboxes}: {len(pdfs)} PDF(s)")

    page_ms: list[int] = []
    doubtful = 0
    for pdf in pdfs:
        target = out / f"{pdf.stem}.ocr.json"
        if target.exists() and not force:
            existing = json.loads(target.read_text(encoding="utf-8"))
            if _matches(existing, engine, dpi, checkboxes):
                page_ms += [p.get("elapsed_ms", 0) for p in existing["pages"]]
                doubtful += existing.get("doubtful_checkboxes", 0)
                continue
        data = pdf.read_bytes()
        started = time.perf_counter()
        pages = []
        doc_doubtful = 0
        for number, image in enumerate(render_pages(pdf, dpi), start=1):
            image.info["dpi"] = (dpi, dpi)
            t = time.perf_counter()
            segments = ocr.read(image)
            if detector is not None:
                found = detector.detect(image)
                doc_doubtful += sum(1 for c in found if c.state is None)
                segments = detector.attach(segments, found, image.width)
            lines = group_lines(segments, image.width) if ocr.regroup else segments
            ms = round((time.perf_counter() - t) * 1000)
            page_ms.append(ms)
            pages.append(Page(number, image.width, image.height, lines, elapsed_ms=ms))
        doc = document_dict(
            engine=engine,
            model=ocr.model,
            dpi=dpi,
            sha256=hashlib.sha256(data).hexdigest(),
            pages=pages,
            elapsed_ms=round((time.perf_counter() - started) * 1000),
            checkboxes=checkboxes,
            doubtful_checkboxes=doc_doubtful if detector is not None else None,
        )
        doubtful += doc_doubtful
        target.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        lines = sum(len(p["lines"]) for p in doc["pages"])
        typer.echo(
            f"  {pdf.stem}  {doc['elapsed_ms'] / 1000:.1f}s  pages={len(pages)} lines={lines}"
        )

    summary = {
        "engine": engine,
        "model": ocr.model,
        "dpi": dpi,
        "checkboxes": checkboxes,
        "source": str(in_dir),
        "documents": len(pdfs),
        "pages": len(page_ms),
        "page_ms_mean": round(statistics.mean(page_ms)) if page_ms else None,
        "page_ms_median": round(statistics.median(page_ms)) if page_ms else None,
        "doubtful_checkboxes": doubtful if detector is not None else None,
        "finished_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    (out / "run.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    typer.echo(
        f"{len(page_ms)} page(s): mean {summary['page_ms_mean']} ms, "
        f"median {summary['page_ms_median']} ms per page (OCR only, rendering apart)"
    )


@app.command()
def bench(
    engine: Annotated[str, typer.Option(help=f"One of: {', '.join(ENGINES)}.")],
    in_dir: Annotated[Path, typer.Option("--in", help="Directory of PDFs.")],
    out: Annotated[Path, typer.Option(help="Where the text of each page and bench.json go.")],
    pages: Annotated[int, typer.Option(help="How many pages, in document order.")] = 20,
    dpi: Annotated[int, typer.Option(help="Resolution the pages are rendered at.")] = 300,
    server: Annotated[
        str | None, typer.Option(help="OpenAI-compatible server, for the vision engines.")
    ] = None,
) -> None:
    """Time an engine on the first --pages pages and keep what it read of each."""
    options = {"server": server} if server else {}
    ocr = make_engine(engine, **options)
    out.mkdir(parents=True, exist_ok=True)
    timings: list[dict] = []
    for pdf in sorted(in_dir.glob("*.pdf")):
        for number, image in enumerate(render_pages(pdf, dpi), start=1):
            if len(timings) >= pages:
                break
            image.info["dpi"] = (dpi, dpi)
            t = time.perf_counter()
            if engine in TEXT_ONLY:
                text = ocr.read_text(image)
                usage = ocr.last_usage
            else:
                text = "\n".join(s.text for s in ocr.read(image))
                usage = {}
            ms = round((time.perf_counter() - t) * 1000)
            name = f"{pdf.stem}-p{number}"
            (out / f"{name}.txt").write_text(text + "\n", encoding="utf-8")
            timings.append({"page": name, "ms": ms, **usage})
            typer.echo(f"  {name}  {ms / 1000:.1f}s")
        if len(timings) >= pages:
            break
    ms = [t["ms"] for t in timings]
    summary = {
        "engine": engine,
        "model": ocr.model,
        "dpi": dpi,
        "pages": len(ms),
        "page_ms_mean": round(statistics.mean(ms)),
        "page_ms_median": round(statistics.median(ms)),
        "finished_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "timings": timings,
    }
    (out / "bench.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    typer.echo(
        f"{len(ms)} page(s): mean {summary['page_ms_mean']} ms, median {summary['page_ms_median']} ms"
    )
