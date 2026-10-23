"""Comparing catalog searches at matched precision."""

from __future__ import annotations

import json

from intake_synth.evaluate.search import best_at, evaluate_search, operating_point, ranking


def row(rank, top1, top2, language="es", truth=("BQ0001",)):
    m = {"top1_right": rank == 1, "rank": rank, "top1": top1, "top2": top2}
    return {
        "scope": "A01",
        "language": language,
        "text": "x",
        "truth": list(truth),
        "methods": {"lexical": m},
    }


LINES = [
    row(1, 0.95, 0.40),
    row(1, 0.80, 0.60),
    row(2, 0.70, 0.65),  # the first candidate is wrong, narrowly ahead
    row(None, 0.30, 0.29),
]


def test_ranking():
    r = ranking(LINES, "lexical")
    assert (r["recall_at_1"], r["recall_at_5"], r["recall_at_20"]) == (50.0, 75.0, 75.0)
    assert r["mrr"] == round((1 + 1 + 0.5) / 4, 3)


def test_operating_point_counts_what_passes_both_thresholds():
    p = operating_point(LINES, "lexical", 0.6, 0.1)
    assert (p["proposed"], p["right"], p["precision"]) == (2, 2, 100.0)
    p = operating_point(LINES, "lexical", 0.0, 0.0)
    assert (p["proposed"], p["right"]) == (4, 2)


def test_best_at_maximises_coverage_at_the_target_precision():
    best = best_at(LINES, "lexical", 1.0)
    assert best["proposed"] == 2 and best["right"] == 2
    assert best_at([row(2, 0.9, 0.1)], "lexical", 0.5) is None


def test_held_out_chooses_on_the_first_half(tmp_path):
    lines = [row(1, 0.9, 0.1)] * 4 + [row(2, 0.9, 0.1)] * 4
    (tmp_path / "search.json").write_text(
        json.dumps(
            {
                "search_id": "t",
                "dataset": "d",
                "methods": ["lexical"],
                "embedding_model": "m",
                "ms_per_line": {},
            }
        )
    )
    (tmp_path / "lines.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    r = evaluate_search(tmp_path)
    test = r["held_out"]["targets"]["0.995"]["lexical"]
    # Perfect on the first half, so the thresholds let everything through; wrong on the second.
    assert (test["proposed"], test["right"]) == (4, 0)
