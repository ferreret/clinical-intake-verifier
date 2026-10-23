"""Reading a run and its goldens, with the pre-checks that decide what can be scored.

A prediction is only scored against the golden it was made from: same document id, same PDF
hash, supported format versions, valid against its schema and with exactly the configured
field keys. Anything else is rejected with a reason instead of being scored.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from ..schema import field_names, repo_root, validate_golden, validate_prediction

GOLDEN_VERSIONS = frozenset({2})
PREDICTION_VERSIONS = frozenset({1})
PREDICTION_SUFFIX = ".pred.json"
NOT_GOLDEN = frozenset({"manifest.json", "run.json", "catalog.json"})


class LoadError(Exception):
    """The run or the golden directory cannot be read at all."""


@dataclass
class Pair:
    golden: dict
    prediction: dict

    @property
    def id(self) -> str:
        return self.golden["id"]

    @property
    def error(self) -> dict | None:
        return self.prediction["extractor"]["error"]


@dataclass
class Loaded:
    run_dir: Path
    golden_dir: Path
    run: dict | None  # run.json, when the run directory has one
    pairs: list[Pair] = field(default_factory=list)
    rejected: list[tuple[str, str]] = field(default_factory=list)  # (prediction file, reason)
    source_ids: list[str] = field(default_factory=list)  # every golden in golden_dir


def _read(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def default_golden_dir(run_dir: Path) -> Path:
    """The source recorded in ``run.json``, relative to the repository root."""
    run_file = run_dir / "run.json"
    if not run_file.exists():
        raise LoadError(f"{run_dir} has no run.json; pass --golden")
    source = Path(_read(run_file)["source"])
    return source if source.is_absolute() else repo_root() / source


def _check_pair(golden: dict, prediction: dict) -> str | None:
    """The reason a pair cannot be scored, or None."""
    if golden.get("golden_version") not in GOLDEN_VERSIONS:
        return f"unsupported golden_version {golden.get('golden_version')!r}"
    if prediction.get("prediction_version") not in PREDICTION_VERSIONS:
        return f"unsupported prediction_version {prediction.get('prediction_version')!r}"
    errors = validate_golden(golden)
    if errors:
        return f"golden does not match its schema: {errors[0]}"
    errors = validate_prediction(prediction)
    if errors:
        return f"prediction does not match its schema: {errors[0]}"
    names = set(field_names())
    if set(golden["fields"]) != names or set(prediction["fields"]) != names:
        return "field keys do not match schema/fields.json"
    if prediction["sha256"] != golden["sha256"]:
        return "sha256 differs from the golden's: the prediction was made from another PDF"
    return None


def load(run_dir: Path, golden_dir: Path, only: set[str] | None = None) -> Loaded:
    if not run_dir.is_dir():
        raise LoadError(f"{run_dir} is not a directory")
    if not golden_dir.is_dir():
        raise LoadError(f"golden directory {golden_dir} does not exist")
    run_file = run_dir / "run.json"
    out = Loaded(run_dir, golden_dir, _read(run_file) if run_file.exists() else None)

    goldens = {
        p.name.removesuffix(".json"): p
        for p in sorted(golden_dir.glob("*.json"))
        if p.name not in NOT_GOLDEN
    }
    out.source_ids = sorted(goldens)

    predictions = sorted(run_dir.glob(f"*{PREDICTION_SUFFIX}"))
    if not predictions:
        raise LoadError(f"{run_dir} has no *{PREDICTION_SUFFIX} files")
    for path in predictions:
        doc_id = path.name.removesuffix(PREDICTION_SUFFIX)
        if only is not None and doc_id not in only:
            continue
        prediction = _read(path)
        if prediction.get("id") != doc_id:
            out.rejected.append(
                (path.name, f"id {prediction.get('id')!r} does not match file name")
            )
            continue
        if doc_id not in goldens:
            out.rejected.append((path.name, f"no golden {doc_id}.json in {golden_dir}"))
            continue
        golden = _read(goldens[doc_id])
        reason = _check_pair(golden, prediction)
        if reason:
            out.rejected.append((path.name, reason))
        else:
            out.pairs.append(Pair(golden, prediction))

    if only is not None:
        found = {p.id for p in out.pairs} | {
            f.removesuffix(PREDICTION_SUFFIX) for f, _ in out.rejected
        }
        for doc_id in sorted(only - found):
            out.rejected.append(
                (f"{doc_id}{PREDICTION_SUFFIX}", "requested with --only, not in this run")
            )
    return out
