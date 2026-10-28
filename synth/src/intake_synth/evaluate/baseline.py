"""Comparing a run with a baseline run over the same goldens.

Both runs are scored by the same harness against the same golden directory, restricted to the
documents evaluated in both, so the comparison never mixes goldens, thresholds or document sets.
What comes out is the change in every metric and the list of fields and tests that flipped.

A document that fails in one run is left out of those metrics, so a change that makes the model
fail on the hardest documents could look like an improvement in them. The documents that fail
in this run and were scored in the baseline (and the other way round) are therefore listed,
and the end-to-end recall, which counts a failed document's values as missed, is compared too.
"""

from __future__ import annotations

from .score import CORRECT, CORRECT_NULL, OUTCOMES

RATES = ("precision", "recall", "invention_rate")
RIGHT = frozenset({CORRECT, CORRECT_NULL})


def _delta(before: float | None, after: float | None) -> dict:
    change = None if before is None or after is None else after - before
    return {"before": before, "after": after, "delta": change}


def _field_deltas(before: dict, after: dict) -> dict:
    return {k: _delta(before[k], after[k]) for k in (*OUTCOMES, *RATES)}


def _flip(doc_id: str, name: str, b: dict, a: dict) -> dict:
    return {
        "id": doc_id,
        "field": name,
        "before": b["outcome"],
        "after": a["outcome"],
        "expected": b["expected"],
        "predicted_before": b["predicted"],
        "predicted_after": a["predicted"],
    }


def _test_flip(doc_id: str, value: str, before: str, after: str) -> dict:
    expected = value if "missed" in (before, after) else None
    predicted = None if expected else value
    return {
        "id": doc_id,
        "field": "tests",
        "before": before,
        "after": after,
        "expected": expected,
        "predicted_before": predicted if before == "extra" else None,
        "predicted_after": predicted if after == "extra" else None,
    }


def flips(before: dict, after: dict) -> dict:
    """Fields and tests whose result changed between two reports over the same documents."""
    fixed, broken, changed = [], [], []
    old = {o["id"]: o for o in before["outcomes"]}
    for cur in after["outcomes"]:
        prev = old[cur["id"]]
        for name, a in cur["fields"].items():
            b = prev["fields"][name]
            if b["outcome"] in RIGHT and a["outcome"] not in RIGHT:
                broken.append(_flip(cur["id"], name, b, a))
            elif b["outcome"] not in RIGHT and a["outcome"] in RIGHT:
                fixed.append(_flip(cur["id"], name, b, a))
            elif b["outcome"] not in RIGHT and (b["outcome"], b["predicted"]) != (
                a["outcome"],
                a["predicted"],
            ):
                changed.append(_flip(cur["id"], name, b, a))
        bt, at = prev["tests"], cur["tests"]
        for v in sorted(set(bt["missed"]) - set(at["missed"])):
            fixed.append(_test_flip(cur["id"], v, "missed", "matched"))
        for v in sorted(set(bt["extra"]) - set(at["extra"])):
            fixed.append(_test_flip(cur["id"], v, "extra", "absent"))
        for v in sorted(set(at["missed"]) - set(bt["missed"])):
            broken.append(_test_flip(cur["id"], v, "matched", "missed"))
        for v in sorted(set(at["extra"]) - set(bt["extra"])):
            broken.append(_test_flip(cur["id"], v, "absent", "extra"))
    return {"fixed": fixed, "broken": broken, "changed": changed}


def compare_reports(
    after: dict,
    before: dict,
    *,
    only_in_run: int,
    only_in_baseline: int,
    rejected: list[dict],
    newly_failing: list[dict] = (),
    recovered: list[dict] = (),
    end_to_end: dict | None = None,
) -> dict:
    """The ``baseline`` section of a report. Both reports cover the same documents.

    ``newly_failing`` and ``recovered`` are the documents that fail in one run and are scored in
    the other, and ``end_to_end`` the full runs' end-to-end recalls, before and after.
    """
    t_after, t_before = after["tests"], before["tests"]
    b_after, b_before = after["boxes"]["all"], before["boxes"]["all"]
    return {
        "run": before["run"],
        "documents": {
            "common": after["documents"]["evaluated"],
            "only_in_run": only_in_run,
            "only_in_baseline": only_in_baseline,
            "rejected": rejected,
        },
        "fields": {
            "total": _field_deltas(before["fields"]["total"], after["fields"]["total"]),
            "by_field": {
                name: _field_deltas(before["fields"]["by_field"][name], s)
                for name, s in after["fields"]["by_field"].items()
            },
        },
        "tests": {
            k: _delta(t_before[k], t_after[k])
            for k in ("matched", "missed", "extra", "precision", "recall", "f1", "exact_lists")
        },
        "boxes": {
            k: _delta(b_before[k], b_after[k])
            for k in ("located", "with_box", "located_rate", "iou_median")
        },
        "flips": flips(before, after),
        "failures": {"newly_failing": list(newly_failing), "recovered": list(recovered)},
        "end_to_end": {k: _delta(*end_to_end[k]) for k in ("field_recall", "test_recall")}
        if end_to_end
        else None,
    }


# --------------------------------------------------------------------------- rendering


def _pp(d: dict) -> str:
    """A rate change in percentage points."""
    return "—" if d["delta"] is None else f"{d['delta'] * 100:+.1f} pp"


def _arrow(d: dict, fmt) -> str:
    return f"{fmt(d['before'])} → {fmt(d['after'])}"


def console_lines(b: dict) -> list[str]:
    d, f, t, x = b["documents"], b["fields"]["total"], b["tests"], b["boxes"]
    fl, fa, e = b["flips"], b["failures"], b["end_to_end"]
    return [
        (
            f"  baseline  : {b['run']['id']}, {d['common']} documents in common "
            f"({d['only_in_run']} only here, {d['only_in_baseline']} only there)"
        ),
        (
            f"  delta     : fields precision {_pp(f['precision'])}  recall {_pp(f['recall'])}  "
            f"invented {f['invented']['delta']:+d}   tests F1 {_pp(t['f1'])}   "
            f"boxes located {_pp(x['located_rate'])}"
        ),
        (
            f"  flipped   : {len(fl['fixed'])} fixed, {len(fl['broken'])} broken, "
            f"{len(fl['changed'])} changed while still wrong"
        ),
        (
            f"  failures  : {len(fa['newly_failing'])} newly failing, {len(fa['recovered'])} recovered"
            + (
                f"   end-to-end field recall {_pp(e['field_recall'])}  test recall {_pp(e['test_recall'])}"
                if e
                else ""
            )
        ),
        *(
            f"  FAILS NOW : {x['id']} ({x['code']}), scored in the baseline"
            for x in fa["newly_failing"]
        ),
        *(f"  REJECTED  : baseline {rej['file']}: {rej['reason']}" for rej in d["rejected"]),
    ]


def markdown_lines(b: dict) -> list[str]:
    from .report import _cell, _num, _pct, _table

    d = b["documents"]
    lines = [f"## Against baseline {b['run']['id']}", ""]
    lines += _table(
        ["", ""],
        [
            ["Baseline run", f"`{b['run']['dir']}`"],
            ["Models", ", ".join(b["run"]["models"])],
            ["Prompt versions", ", ".join(b["run"]["prompt_versions"])],
            ["Input modes", ", ".join(b["run"]["input_modes"])],
            ["Documents compared", str(d["common"])],
            ["Only in this run", str(d["only_in_run"])],
            ["Only in the baseline", str(d["only_in_baseline"])],
        ],
    )
    lines += [
        (
            "Both runs scored by this harness against the same goldens, over the documents "
            "they share. Cells read baseline → this run (change)."
        ),
        "",
    ]

    def row(label: str, s: dict) -> list[str]:
        return [
            label,
            f"{s['correct']['before']} → {s['correct']['after']}",
            *(f"{_arrow(s[k], _pct)} ({_pp(s[k])})" for k in RATES),
        ]

    rows = [row(name, s) for name, s in b["fields"]["by_field"].items()]
    rows.append(row("**all fields**", b["fields"]["total"]))
    lines += ["### Fields", "", *_table(["", "correct", "precision", "recall", "invention"], rows)]

    t, x = b["tests"], b["boxes"]
    rows = [
        [
            "tests precision",
            _pct(t["precision"]["before"]),
            _pct(t["precision"]["after"]),
            _pp(t["precision"]),
        ],
        ["tests recall", _pct(t["recall"]["before"]), _pct(t["recall"]["after"]), _pp(t["recall"])],
        ["tests F1", _pct(t["f1"]["before"]), _pct(t["f1"]["after"]), _pp(t["f1"])],
        [
            "exact test lists",
            str(t["exact_lists"]["before"]),
            str(t["exact_lists"]["after"]),
            f"{t['exact_lists']['delta']:+d}",
        ],
        [
            "boxes located",
            _pct(x["located_rate"]["before"]),
            _pct(x["located_rate"]["after"]),
            _pp(x["located_rate"]),
        ],
        [
            "median IoU",
            _num(x["iou_median"]["before"]),
            _num(x["iou_median"]["after"]),
            "—" if x["iou_median"]["delta"] is None else f"{x['iou_median']['delta']:+.2f}",
        ],
    ]
    lines += ["### Tests and boxes", "", *_table(["", "baseline", "this run", "change"], rows)]

    fa, e = b["failures"], b["end_to_end"]
    lines += [
        "### Failures",
        "",
        (
            "Left out of the metrics above, so listed here: a run that fails on the hard "
            "documents can look better on the rest."
        ),
        "",
    ]
    if e:
        lines += _table(
            ["end to end", "baseline", "this run", "change"],
            [
                [label, _pct(e[k]["before"]), _pct(e[k]["after"]), _pp(e[k])]
                for label, k in (("field recall", "field_recall"), ("test recall", "test_recall"))
            ],
        )
    for key, title in (
        ("newly_failing", "Failing now, scored in the baseline"),
        ("recovered", "Scored now, failing in the baseline"),
    ):
        lines += [f"**{title} ({len(fa[key])})**", ""]
        lines += [f"- {x['id']}: {x['code']}" for x in fa[key]] or ["None."]
        lines += [""]

    header = [
        "document",
        "field",
        "before",
        "after",
        "expected",
        "predicted before",
        "predicted after",
    ]
    for key, title in (
        ("fixed", "Fixed"),
        ("broken", "Broken"),
        ("changed", "Changed while still wrong"),
    ):
        entries = b["flips"][key]
        lines += [f"### {title} ({len(entries)})", ""]
        if not entries:
            lines += ["None.", ""]
            continue
        lines += _table(
            header,
            [
                [
                    e["id"],
                    e["field"],
                    e["before"],
                    e["after"],
                    _cell(e["expected"]),
                    _cell(e["predicted_before"]),
                    _cell(e["predicted_after"]),
                ]
                for e in entries
            ],
        )
    return lines
