"""Evaluation of extractor runs against the golden sample (phase F3)."""

from __future__ import annotations

import json
from pathlib import Path

from .load import load
from .report import build_report, markdown
from .score import score_document

REPORT_JSON = "report.json"
REPORT_MD = "report.md"


def evaluate_run(
    run_dir: Path, golden_dir: Path, threshold: float = 0.5, only: set[str] | None = None
) -> dict:
    """Score every prediction in ``run_dir`` against ``golden_dir`` and return the report."""
    loaded = load(run_dir, golden_dir, only)
    failed = [p for p in loaded.pairs if p.error is not None]
    docs = [
        score_document(p.golden, p.prediction, threshold) for p in loaded.pairs if p.error is None
    ]
    return build_report(loaded, docs, failed, threshold, only)


def write_report(report: dict, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path, md_path = out_dir / REPORT_JSON, out_dir / REPORT_MD
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(markdown(report), encoding="utf-8")
    return json_path, md_path
