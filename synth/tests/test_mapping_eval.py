"""Scoring a test-mapping simulation."""

from __future__ import annotations

import json

import pytest

from intake_synth.evaluate.load import LoadError
from intake_synth.evaluate.mapping import _bucket, evaluate_mapping


def line(k, state, right, action, source="memory", language="es", truth=("BQ0001",), scope="A01"):
    proposed = None if state == "red" else (list(truth) if right else ["BQ9999"])
    return {
        "doc": f"synth-{k:06d}",
        "scope": scope,
        "k": k,
        "insurer": "Meridional Salud",
        "language": language,
        "text": "GLU",
        "truth": list(truth),
        "state": state,
        "source": None if state == "red" else source,
        "proposed": proposed,
        "proposed_right": None if state == "red" else right,
        "in_candidates": True,
        "top_score": 0.9,
        "lead": 0.2,
        "action": action,
        "chosen": list(truth),
        "chosen_right": True,
    }


def write(tmp_path, lines, version=1):
    (tmp_path / "mapping.json").write_text(
        json.dumps(
            {
                "mapping_id": "test",
                "mapping_version": version,
                "dataset": "data/synth/x",
                "documents": len(lines),
                "lines": len(lines),
                "error_rate": 0,
                "seed": 1,
                "green_approvals": 2,
                "search_min_score": 0.55,
                "search_min_lead": 0.05,
                "candidates": 20,
            }
        )
    )
    (tmp_path / "lines.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    return tmp_path


@pytest.mark.parametrize(
    ("k", "label"), [(1, "1"), (2, "2-5"), (10, "6-10"), (60, "51-100"), (500, "101+")]
)
def test_buckets(k, label):
    assert _bucket(k) == label


def test_learning_curve_and_work(tmp_path):
    lines = [
        line(1, "red", None, "choose"),
        line(2, "orange", True, "confirm"),
        line(3, "green", True, "approve"),
        line(7, "green", True, "approve"),
        line(8, "orange", False, "correct", source="search", truth=("BQ0002",)),
    ]
    r = evaluate_mapping(write(tmp_path, lines))
    assert r["curve"]["1"]["work_pct"] == 100.0
    assert r["curve"]["2-5"] == {
        "lines": 2,
        "green": 1,
        "orange": 1,
        "red": 0,
        "green_pct": 50.0,
        "work_pct": 0.0,
        "wrong_green": 0,
    }
    assert r["curve"]["6-10"]["work_pct"] == 50.0
    assert r["precision_by_source"]["search"] == {"proposed": 1, "right": 0, "pct": 0.0}
    assert r["wrong_green"] == []


def test_a_wrong_green_line_is_reported(tmp_path):
    r = evaluate_mapping(write(tmp_path, [line(5, "green", False, "approve")]))
    assert r["total"]["wrong_green"] == 1
    assert r["wrong_green"][0]["proposed"] == ["BQ9999"]


def test_profile_lines_and_recall_by_language(tmp_path):
    lines = [
        line(1, "red", None, "choose", language="ca", truth=("BQ0004", "BQ0005")),
        {**line(2, "orange", True, "confirm", source="search"), "in_candidates": False},
    ]
    r = evaluate_mapping(write(tmp_path, lines))
    assert r["profile_lines"] == {"lines": 1, "in_candidates": 1, "green": 0}
    assert r["recall_at_k"] == {"ca": 100.0, "es": 0.0}


def test_unknown_version_is_rejected(tmp_path):
    with pytest.raises(LoadError, match="mapping_version"):
        evaluate_mapping(write(tmp_path, [line(1, "red", None, "choose")], version=9))


def test_model_section(tmp_path):
    called = {
        **line(1, "orange", True, "confirm", source="model"),
        "model_called": True,
        "model_codes": ["BQ0001"],
    }
    wrong = {
        **line(2, "orange", False, "correct", source="model"),
        "model_called": True,
        "model_codes": ["BQ9999"],
    }
    silent = {**line(3, "red", None, "choose"), "model_called": True, "model_codes": None}
    d = write(tmp_path, [called, wrong, silent])
    manifest = json.loads((d / "mapping.json").read_text())
    manifest["model"] = {
        "provider": "local",
        "name": "qwen",
        "policy": "red",
        "prompt_version": "1",
        "calls": 3,
        "cached_calls": 1,
        "lines_sent": 3,
        "input_tokens": 300,
        "output_tokens": 30,
        "latency_ms": 6000,
    }
    (d / "mapping.json").write_text(json.dumps(manifest))
    m = evaluate_mapping(d)["model"]
    assert (m["lines_answered"], m["lines_right"], m["precision"]) == (2, 1, 50.0)
    assert m["ms_per_uncached_call"] == 3000
    assert m["calls_per_100_documents"] == 100.0


def test_reading_section_for_lines_an_extractor_read(tmp_path):
    exact = {**line(1, "green", True, "approve"), "reading": "exact", "golden_text": "GLU"}
    misread = {
        **line(2, "orange", True, "confirm"),
        "text": "GLC",
        "reading": "misread",
        "golden_text": "GLU",
    }
    invented = {
        **line(3, "green", False, "remove", truth=()),
        "text": "UREA",
        "reading": "invented",
        "golden_text": None,
        "in_candidates": False,
    }
    d = write(tmp_path, [exact, misread, invented])
    manifest = json.loads((d / "mapping.json").read_text())
    manifest["fusion"] = {"fusion_id": "f", "predictions": "data/runs/r", "failed_documents": 1}
    manifest["unread"] = [{"doc": "synth-000002", "text": "TSH", "truth": ["HO0001"]}]
    (d / "mapping.json").write_text(json.dumps(manifest))
    r = evaluate_mapping(d)
    rd = r["reading"]
    assert [rd[k]["lines"] for k in ("exact", "misread", "invented")] == [1, 1, 1]
    assert rd["invented"]["wrong_green"] == 1 and rd["invented"]["work_pct"] == 100.0
    assert len(rd["unread"]) == 1 and rd["failed_documents"] == 1
    # The invented line stands for no test: it does not lower the search's recall.
    assert r["recall_at_k"] == {"es": 100.0}


def test_no_reading_section_for_goldens(tmp_path):
    assert evaluate_mapping(write(tmp_path, [line(1, "red", None, "choose")]))["reading"] is None
