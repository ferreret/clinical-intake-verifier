"""Evaluation of extractor runs against the golden sample (phase F3)."""

from __future__ import annotations

import json
from pathlib import Path

from .baseline import compare_reports
from .load import LoadError, load
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


def _scored(report: dict) -> set[str]:
    return {o["id"] for o in report["outcomes"]}


def evaluate_against(
    run_dir: Path,
    baseline_dir: Path,
    golden_dir: Path,
    threshold: float = 0.5,
    only: set[str] | None = None,
) -> dict:
    """``evaluate_run`` plus a ``baseline`` section comparing it with another run.

    The baseline is re-scored here against the same goldens, so an old report of it, made
    against goldens that have changed since, can never leak into the comparison. Deltas and
    flips cover only the documents evaluated, not failed, in both runs.
    """
    if run_dir.resolve() == baseline_dir.resolve():
        raise LoadError("the baseline is the run itself")
    report = evaluate_run(run_dir, golden_dir, threshold, only)
    base = evaluate_run(baseline_dir, golden_dir, threshold, only)
    common = _scored(report) & _scored(base)
    if not common:
        raise LoadError(f"no document is evaluated in both {run_dir} and {baseline_dir}")
    after = (
        report
        if _scored(report) == common
        else evaluate_run(run_dir, golden_dir, threshold, common)
    )
    before = (
        base
        if _scored(base) == common
        else evaluate_run(baseline_dir, golden_dir, threshold, common)
    )
    report["baseline"] = compare_reports(
        after,
        before,
        only_in_run=len(_scored(report) - common),
        only_in_baseline=len(_scored(base) - common),
        rejected=base["documents"]["rejected"],
    )
    return report


def write_report(report: dict, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path, md_path = out_dir / REPORT_JSON, out_dir / REPORT_MD
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(markdown(report), encoding="utf-8")
    return json_path, md_path
