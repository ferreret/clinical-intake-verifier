"""Aggregating document scores into ``report.json``, ``report.md`` and a console summary.

Metric definitions are in ``docs/evaluation.md``. Failed extractions are left out of every
quality metric and counted by error code; only the end-to-end line counts them as missed.
"""

from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

from ..schema import load_fields, repo_root
from .load import Loaded, Pair
from .score import (
    BOX_STATUSES,
    CORRECT,
    CORRECT_NULL,
    INVENTED,
    LOCATED,
    MISSED,
    NOT_LOCATED,
    OUTCOMES,
    WRONG,
    WRONG_PAGE,
    DocResult,
    FieldResult,
)

HARNESS_VERSION = "1"
WORST_SHOWN = 3


def _ratio(n: int, d: int) -> float | None:
    return n / d if d else None


def _display(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(repo_root()))
    except ValueError:
        return str(path.resolve())


def field_stats(results: Iterable[FieldResult]) -> dict:
    c = Counter(r.outcome for r in results)
    counts = {o: c[o] for o in OUTCOMES}
    return {
        **counts,
        "precision": _ratio(c[CORRECT], c[CORRECT] + c[WRONG] + c[INVENTED]),
        "recall": _ratio(c[CORRECT], c[CORRECT] + c[WRONG] + c[MISSED]),
        "invention_rate": _ratio(c[INVENTED], c[CORRECT_NULL] + c[INVENTED]),
    }


def test_stats(docs: list[DocResult]) -> dict:
    tp = sum(len(d.tests.matched) for d in docs)
    fp = sum(len(d.tests.extra) for d in docs)
    fn = sum(len(d.tests.missed) for d in docs)
    precision, recall = _ratio(tp, tp + fp), _ratio(tp, tp + fn)
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision is not None and recall is not None and precision + recall > 0
        else None
    )
    return {
        "matched": tp,
        "extra": fp,
        "missed": fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "exact_lists": sum(d.tests.exact for d in docs),
        "documents": len(docs),
    }


def box_stats(items: list[tuple[str, float | None]]) -> dict:
    c = Counter(status for status, _ in items)
    ious = [v for _, v in items if v is not None]
    with_box = c[LOCATED] + c[NOT_LOCATED] + c[WRONG_PAGE]
    return {
        **{s: c[s] for s in BOX_STATUSES},
        "with_box": with_box,
        "located_rate": _ratio(c[LOCATED], with_box),
        "iou_median": statistics.median(ious) if ious else None,
        "iou_min": min(ious) if ious else None,
    }


def _field_boxes(docs: list[DocResult]) -> list[tuple[str, float | None]]:
    return [(f.box, f.iou) for d in docs for f in d.fields if f.box is not None]


def _test_boxes(docs: list[DocResult]) -> list[tuple[str, float | None]]:
    return [(m.box, m.iou) for d in docs for m in d.tests.matched]


def _doc_slice(docs: list[DocResult]) -> dict:
    return {
        "documents": len(docs),
        "fields": field_stats(f for d in docs for f in d.fields),
        "tests": test_stats(docs),
    }


def _slices(docs: list[DocResult]) -> dict:
    groups: dict[str, dict[str, list[DocResult]]] = defaultdict(lambda: defaultdict(list))
    for d in docs:
        groups["scan"]["scanned" if d.scanned else "clean"].append(d)
        groups["template"][d.template].append(d)
        groups["pages"]["single" if d.pages == 1 else "multi"].append(d)
    out = {dim: {k: _doc_slice(v) for k, v in sorted(g.items())} for dim, g in groups.items()}
    styles = sorted({f.style for d in docs for f in d.fields if f.style})
    out["style"] = {
        s: {"fields": field_stats(f for d in docs for f in d.fields if f.style == s)}
        for s in styles
    }
    return out


def _outcomes(docs: list[DocResult]) -> list[dict]:
    return [
        {
            "id": d.id,
            "fields": {
                f.name: {
                    "outcome": f.outcome,
                    "expected": f.expected,
                    "predicted": f.predicted,
                    "box": f.box,
                    "iou": f.iou,
                }
                for f in d.fields
            },
            "tests": {
                "matched": [
                    {"expected": m.expected, "predicted": m.predicted, "box": m.box, "iou": m.iou}
                    for m in d.tests.matched
                ],
                "missed": d.tests.missed,
                "extra": d.tests.extra,
            },
        }
        for d in docs
    ]


def _worst(by_field: dict, evaluated: int) -> list[dict]:
    rows = [
        {"field": name, "right": s[CORRECT] + s[CORRECT_NULL], "of": evaluated}
        for name, s in by_field.items()
    ]
    rows = [r for r in rows if r["right"] < r["of"]]
    return sorted(rows, key=lambda r: (r["right"], r["field"]))[:WORST_SHOWN]


def _mean(values: Iterable[int | None]) -> float | None:
    present = [v for v in values if v is not None]
    return statistics.fmean(present) if present else None


def build_report(
    loaded: Loaded,
    docs: list[DocResult],
    failed: list[Pair],
    threshold: float,
    only: set[str] | None,
) -> dict:
    spec = load_fields()
    pairs = loaded.pairs  # scored and failed alike: warnings and cost cover both
    by_field = {
        f["name"]: field_stats(r for d in docs for r in d.fields if r.name == f["name"])
        for f in spec["fields"]
    }
    totals = field_stats(r for d in docs for r in d.fields)
    tests = test_stats(docs)

    failed_values = sum(1 for p in failed for v in p.golden["fields"].values() if v is not None)
    failed_tests = sum(len(p.golden["tests"]) for p in failed)
    golden_values = totals[CORRECT] + totals[WRONG] + totals[MISSED]

    warnings_by_code: Counter[str] = Counter()
    warnings_by_field: dict[str, Counter[str]] = defaultdict(Counter)
    for p in pairs:
        for w in p.prediction["warnings"]:
            warnings_by_code[w["code"]] += 1
            warnings_by_field[w["code"]][w["field"] or "-"] += 1

    extractors = [p.prediction["extractor"] for p in pairs]
    scored_ids = {p.id for p in pairs}
    run = loaded.run or {}
    return {
        "harness_version": HARNESS_VERSION,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "run": {
            "id": run.get("run_id", loaded.run_dir.name),
            "dir": _display(loaded.run_dir),
            "models": sorted({e["model"] for e in extractors}),
            "prompt_versions": sorted({e["prompt_version"] for e in extractors}),
            "input_modes": sorted({e["input_mode"] for e in extractors}),
        },
        "golden": {
            "dir": _display(loaded.golden_dir),
            "seeds": sorted({p.golden["generator"]["seed"] for p in pairs}),
            "generator_versions": sorted({p.golden["generator"]["version"] for p in pairs}),
            "golden_versions": sorted({p.golden["golden_version"] for p in pairs}),
        },
        "fields_version": spec["version"],
        "iou_threshold": threshold,
        "only": sorted(only) if only is not None else None,
        "documents": {
            "evaluated": len(docs),
            "failed": len(failed),
            "rejected": [{"file": f, "reason": r} for f, r in loaded.rejected],
            "source": len(loaded.source_ids),
            "not_in_run": len(set(loaded.source_ids) - scored_ids),
        },
        "failures": {
            "by_code": dict(Counter(p.error["code"] for p in failed)),
            "documents": [
                {"id": p.id, "code": p.error["code"], "message": p.error["message"]} for p in failed
            ],
        },
        "fields": {"total": totals, "by_field": by_field},
        "end_to_end": {
            "field_recall": _ratio(totals[CORRECT], golden_values + failed_values),
            "test_recall": _ratio(
                tests["matched"], tests["matched"] + tests["missed"] + failed_tests
            ),
        },
        "tests": tests,
        "boxes": {
            "fields": box_stats(_field_boxes(docs)),
            "tests": box_stats(_test_boxes(docs)),
            "all": box_stats(_field_boxes(docs) + _test_boxes(docs)),
        },
        "warnings": {
            "total": sum(warnings_by_code.values()),
            "by_code": dict(sorted(warnings_by_code.items())),
            "by_field": {c: dict(sorted(f.items())) for c, f in sorted(warnings_by_field.items())},
        },
        "slices": _slices(docs),
        "cost": {
            "documents": len(extractors),
            "latency_ms_mean": _mean(e["latency_ms"] for e in extractors),
            "input_tokens_mean": _mean(e["usage"]["input_tokens"] for e in extractors),
            "output_tokens_mean": _mean(e["usage"]["output_tokens"] for e in extractors),
        },
        "worst": _worst(by_field, len(docs)),
        "outcomes": _outcomes(docs),
    }


# --------------------------------------------------------------------------- rendering


def _pct(x: float | None) -> str:
    return "—" if x is None else f"{x * 100:.1f}%"


def _num(x: float | None, fmt: str = ".2f") -> str:
    return "—" if x is None else format(x, fmt)


def console_summary(r: dict) -> list[str]:
    d, f, t, b = r["documents"], r["fields"]["total"], r["tests"], r["boxes"]["all"]
    nulls = f[CORRECT_NULL] + f[INVENTED]
    lines = [
        f"eval {r['run']['id']} vs {r['golden']['dir']}",
        (
            f"  documents : {d['evaluated']} evaluated, {d['failed']} failed, "
            f"{len(d['rejected'])} rejected, {d['not_in_run']} of the source not in this run"
        ),
        (
            f"  fields    : precision {_pct(f['precision'])}  recall {_pct(f['recall'])}  "
            f"invented {f[INVENTED]}/{nulls}   "
            f"{f[CORRECT]} correct, {f[WRONG]} wrong, {f[MISSED]} missed"
        ),
    ]
    if d["failed"]:
        e = r["end_to_end"]
        lines.append(
            f"  end-to-end: field recall {_pct(e['field_recall'])}  "
            f"test recall {_pct(e['test_recall'])} (failed documents counted as missed)"
        )
    lines += [
        (
            f"  tests     : P {_pct(t['precision'])}  R {_pct(t['recall'])}  F1 {_pct(t['f1'])}  "
            f"exact list {t['exact_lists']}/{t['documents']}"
        ),
        (
            f"  boxes     : located {b[LOCATED]}/{b['with_box']} at IoU>={r['iou_threshold']}, "
            f"median {_num(b['iou_median'])}"
        ),
        f"  warnings  : {r['warnings']['total']}"
        + "".join(f"  {c}={n}" for c, n in r["warnings"]["by_code"].items()),
    ]
    c = r["cost"]
    if c["latency_ms_mean"] is not None:
        lines.append(
            f"  cost      : {c['latency_ms_mean'] / 1000:.1f} s/doc, "
            f"{_num(c['input_tokens_mean'], '.0f')} in / {_num(c['output_tokens_mean'], '.0f')} "
            "out tokens per doc"
        )
    worst = ", ".join(f"{w['field']} {w['right']}/{w['of']}" for w in r["worst"]) or "none"
    lines.append(f"  worst     : {worst}")
    if "baseline" in r:
        from .baseline import console_lines

        lines += console_lines(r["baseline"])
    if d["failed"]:
        codes = ", ".join(f"{k}={v}" for k, v in r["failures"]["by_code"].items())
        lines.append(f"  failures  : {codes}")
    for rej in d["rejected"]:
        lines.append(f"  REJECTED  : {rej['file']}: {rej['reason']}")
    return lines


def _table(header: list[str], rows: list[list[str]]) -> list[str]:
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(row) + " |" for row in rows]
    return out + [""]


def _field_row(label: str, s: dict) -> list[str]:
    return [
        label,
        *(str(s[o]) for o in OUTCOMES),
        _pct(s["precision"]),
        _pct(s["recall"]),
        _pct(s["invention_rate"]),
    ]


FIELD_HEADER = [
    "",
    "correct",
    "wrong",
    "missed",
    "correct null",
    "invented",
    "precision",
    "recall",
    "invention",
]


def _box_row(label: str, s: dict) -> list[str]:
    return [
        label,
        str(s[LOCATED]),
        str(s[NOT_LOCATED]),
        str(s[WRONG_PAGE]),
        str(s["no_box"]),
        _pct(s["located_rate"]),
        _num(s["iou_median"]),
        _num(s["iou_min"]),
    ]


def _cell(value: str | None) -> str:
    return "—" if value is None else value.replace("|", "\\|")


def markdown(r: dict) -> str:
    lines = [f"# Evaluation of {r['run']['id']}", ""]
    meta = [
        ("Run", f"`{r['run']['dir']}`"),
        ("Golden", f"`{r['golden']['dir']}`"),
        ("Models", ", ".join(r["run"]["models"])),
        ("Prompt versions", ", ".join(r["run"]["prompt_versions"])),
        ("Input modes", ", ".join(r["run"]["input_modes"])),
        ("Seeds", ", ".join(map(str, r["golden"]["seeds"]))),
        ("Generator versions", ", ".join(r["golden"]["generator_versions"])),
        ("fields.json version", str(r["fields_version"])),
        ("IoU threshold", str(r["iou_threshold"])),
        ("Harness version", r["harness_version"]),
        ("Generated at", r["generated_at"]),
    ]
    if r["only"] is not None:
        meta.append(("Only", ", ".join(r["only"])))
    lines += _table(["", ""], [[k, v] for k, v in meta])

    lines += ["## Summary", "", "```", *console_summary(r), "```", ""]
    if "baseline" in r:
        from .baseline import markdown_lines

        lines += markdown_lines(r["baseline"])

    lines += ["## Fields", ""]
    rows = [_field_row(name, s) for name, s in r["fields"]["by_field"].items()]
    rows.append(_field_row("**all fields**", r["fields"]["total"]))
    lines += _table(FIELD_HEADER, rows)

    t = r["tests"]
    lines += ["## Tests", ""]
    lines += _table(
        ["matched", "missed", "extra", "precision", "recall", "F1", "exact lists"],
        [
            [
                str(t["matched"]),
                str(t["missed"]),
                str(t["extra"]),
                _pct(t["precision"]),
                _pct(t["recall"]),
                _pct(t["f1"]),
                f"{t['exact_lists']}/{t['documents']}",
            ]
        ],
    )

    lines += [f"## Boxes (IoU ≥ {r['iou_threshold']})", ""]
    lines += _table(
        ["", "located", "below threshold", "wrong page", "no box", "located rate", "median", "min"],
        [_box_row(k, r["boxes"][k]) for k in ("fields", "tests", "all")],
    )

    lines += ["## Slices", ""]
    for dim in ("scan", "template", "pages"):
        rows = [
            _field_row(f"{k} ({v['documents']} docs)", v["fields"])
            for k, v in r["slices"][dim].items()
        ]
        lines += [f"### Fields by {dim}", "", *_table(FIELD_HEADER, rows)]
        rows = [
            [k, _pct(v["tests"]["precision"]), _pct(v["tests"]["recall"]), _pct(v["tests"]["f1"])]
            for k, v in r["slices"][dim].items()
        ]
        lines += [f"### Tests by {dim}", "", *_table(["", "precision", "recall", "F1"], rows)]
    rows = [_field_row(k, v["fields"]) for k, v in r["slices"]["style"].items()]
    lines += ["### Fields by writing style", "", *_table(FIELD_HEADER, rows)]

    w = r["warnings"]
    lines += ["## Warnings", ""]
    if w["total"]:
        rows = [[c, f, str(n)] for c, fs in w["by_field"].items() for f, n in fs.items()]
        lines += _table(["code", "field", "count"], rows)
    else:
        lines += ["None.", ""]

    lines += ["## Failures and rejections", ""]
    fails = r["failures"]["documents"]
    rejected = r["documents"]["rejected"]
    if not fails and not rejected:
        lines += ["None.", ""]
    if fails:
        e = r["end_to_end"]
        lines += [
            (
                "Left out of every metric above. End to end, counting them as missed: field "
                f"recall {_pct(e['field_recall'])}, test recall {_pct(e['test_recall'])}."
            ),
            "",
            *_table(
                ["document", "code", "message"],
                [[f["id"], f["code"], _cell(f["message"])] for f in fails],
            ),
        ]
    if rejected:
        lines += _table(
            ["prediction", "reason"], [[x["file"], _cell(x["reason"])] for x in rejected]
        )

    lines += ["## Mismatches", ""]
    rows = []
    for doc in r["outcomes"]:
        for name, f in doc["fields"].items():
            if f["outcome"] in (WRONG, MISSED, INVENTED):
                rows.append(
                    [doc["id"], name, f["outcome"], _cell(f["expected"]), _cell(f["predicted"])]
                )
        rows += [[doc["id"], "tests", MISSED, _cell(v), "—"] for v in doc["tests"]["missed"]]
        rows += [[doc["id"], "tests", "extra", "—", _cell(v)] for v in doc["tests"]["extra"]]
    if rows:
        lines += _table(["document", "field", "outcome", "expected", "predicted"], rows)
    else:
        lines += ["None.", ""]
    return "\n".join(lines).rstrip() + "\n"
