"""The evaluation harness on a small generated batch, with predictions made from the goldens."""

from __future__ import annotations

import copy
import json

import pytest
from typer.testing import CliRunner

from intake_synth.cli import app
from intake_synth.evaluate import evaluate_against, evaluate_run
from intake_synth.evaluate.load import LoadError
from intake_synth.evaluate.score import (
    CORRECT,
    CORRECT_NULL,
    INVENTED,
    LOCATED,
    MISSED,
    NO_BOX,
    NOT_LOCATED,
    WRONG,
    WRONG_PAGE,
    check_box,
    field_outcome,
)
from intake_synth.generate.pipeline import GenerateOptions, generate_batch

N = 4


@pytest.fixture(scope="module")
def golden_dir(tmp_path_factory):
    out = tmp_path_factory.mktemp("golden")
    generate_batch(range(N), GenerateOptions(seed=7, scan_ratio=0.5), out)
    return out


def _goldens(golden_dir) -> list[dict]:
    return [
        json.loads(p.read_text(encoding="utf-8")) for p in sorted(golden_dir.glob("synth-*.json"))
    ]


def perfect(golden: dict) -> dict:
    """The prediction a flawless extractor would return for this golden."""

    def item(v):
        return {"value": v["value"], "page": v["page"], "bbox": v["bbox"]}

    return {
        "prediction_version": 1,
        "id": golden["id"],
        "file": golden["file"],
        "sha256": golden["sha256"],
        "extractor": {
            "model": "test-model",
            "model_version": "test-model",
            "prompt_version": "2",
            "input_mode": "pdf-inline",
            "temperature": 0,
            "thinking_level": "low",
            "attempts": 1,
            "latency_ms": 1000,
            "usage": {"input_tokens": 100, "output_tokens": 50, "thinking_tokens": None},
            "created_at": "2026-10-22T00:00:00Z",
            "error": None,
        },
        "pages": [
            {"number": p["number"], "width_pt": p["width_pt"], "height_pt": p["height_pt"]}
            for p in golden["pages"]
        ],
        "fields": {k: (item(v) if v else None) for k, v in golden["fields"].items()},
        "tests": [item(t) for t in golden["tests"]],
        "warnings": [],
    }


def write_run(run_dir, predictions: list[dict]):
    run_dir.mkdir(parents=True, exist_ok=True)
    for p in predictions:
        (run_dir / f"{p['id']}.pred.json").write_text(json.dumps(p), encoding="utf-8")
    return run_dir


@pytest.fixture
def goldens(golden_dir):
    return _goldens(golden_dir)


def test_a_perfect_run_scores_perfectly(tmp_path, golden_dir, goldens):
    r = evaluate_run(write_run(tmp_path / "run", [perfect(g) for g in goldens]), golden_dir)
    f = r["fields"]["total"]
    assert r["documents"] == {
        "evaluated": N,
        "failed": 0,
        "rejected": [],
        "source": N,
        "not_in_run": 0,
    }
    assert f[WRONG] == f[MISSED] == f[INVENTED] == 0
    assert f[CORRECT] == sum(v is not None for g in goldens for v in g["fields"].values())
    assert f[CORRECT_NULL] == sum(v is None for g in goldens for v in g["fields"].values())
    assert f["precision"] == f["recall"] == 1.0
    assert r["tests"]["f1"] == 1.0 and r["tests"]["exact_lists"] == N
    assert r["boxes"]["all"]["located_rate"] == 1.0
    assert r["worst"] == []
    assert len(r["outcomes"]) == N


def test_each_kind_of_error_is_counted_once(tmp_path, golden_dir, goldens):
    preds = [perfect(g) for g in goldens]
    base = evaluate_run(write_run(tmp_path / "base", preds), golden_dir)["fields"]["total"]

    doc = preds[0]
    present = [k for k, v in doc["fields"].items() if v is not None]
    absent_doc, absent = next((p, k) for p in preds for k, v in p["fields"].items() if v is None)
    doc["fields"][present[0]]["value"] = "ZZZ 999 not the value"
    doc["fields"][present[1]] = None
    absent_doc["fields"][absent] = {"value": "made up", "page": 1, "bbox": None}
    dropped = doc["tests"].pop(0)["value"]
    doc["tests"].append({"value": "Prueba inexistente", "page": 1, "bbox": None})

    r = evaluate_run(write_run(tmp_path / "run", preds), golden_dir)
    f = r["fields"]["total"]
    assert f[CORRECT] == base[CORRECT] - 2
    assert (f[WRONG], f[MISSED], f[INVENTED]) == (1, 1, 1)
    assert f[CORRECT_NULL] == base[CORRECT_NULL] - 1
    assert (r["tests"]["missed"], r["tests"]["extra"]) == (1, 1)
    assert r["tests"]["exact_lists"] == N - 1

    by_id = {o["id"]: o for o in r["outcomes"]}
    assert by_id[doc["id"]]["fields"][present[0]]["outcome"] == WRONG
    assert by_id[doc["id"]]["fields"][present[1]]["outcome"] == MISSED
    assert by_id[absent_doc["id"]]["fields"][absent]["outcome"] == INVENTED
    assert by_id[doc["id"]]["tests"]["missed"] == [dropped]
    assert by_id[doc["id"]]["tests"]["extra"] == ["Prueba inexistente"]


def test_a_failed_extraction_stays_out_of_quality_metrics(tmp_path, golden_dir, goldens):
    preds = [perfect(g) for g in goldens]
    failed = preds[1]
    failed["extractor"]["error"] = {"code": "api_error", "message": "quota exhausted"}
    failed["fields"] = {k: None for k in failed["fields"]}
    failed["tests"] = []

    r = evaluate_run(write_run(tmp_path / "run", preds), golden_dir)
    assert r["documents"]["evaluated"] == N - 1
    assert r["documents"]["failed"] == 1
    assert r["failures"]["by_code"] == {"api_error": 1}
    assert r["fields"]["total"]["recall"] == 1.0
    assert r["fields"]["total"][MISSED] == 0
    assert r["end_to_end"]["field_recall"] < 1.0
    assert r["end_to_end"]["test_recall"] < 1.0


def test_predictions_that_cannot_be_scored_are_rejected(tmp_path, golden_dir, goldens):
    preds = [perfect(g) for g in goldens]
    preds[0]["sha256"] = "0" * 64
    stray = copy.deepcopy(preds[1])
    stray["id"] = "synth-999999"
    r = evaluate_run(write_run(tmp_path / "run", [*preds, stray]), golden_dir)
    reasons = {x["file"]: x["reason"] for x in r["documents"]["rejected"]}
    assert "sha256" in reasons[f"{goldens[0]['id']}.pred.json"]
    assert "no golden" in reasons["synth-999999.pred.json"]
    assert r["documents"]["evaluated"] == N - 1


def test_only_restricts_the_evaluation(tmp_path, golden_dir, goldens):
    run = write_run(tmp_path / "run", [perfect(g) for g in goldens])
    r = evaluate_run(run, golden_dir, only={goldens[2]["id"]})
    assert [o["id"] for o in r["outcomes"]] == [goldens[2]["id"]]
    assert r["documents"]["not_in_run"] == N - 1


def test_cli_writes_both_reports(tmp_path, golden_dir, goldens):
    run = write_run(tmp_path / "run", [perfect(g) for g in goldens])
    result = CliRunner().invoke(app, ["evaluate", str(run), "--golden", str(golden_dir)])
    assert result.exit_code == 0, result.output
    assert "precision 100.0%" in result.output
    report = json.loads((run / "eval" / "report.json").read_text(encoding="utf-8"))
    assert report["documents"]["evaluated"] == N
    assert "## Mismatches" in (run / "eval" / "report.md").read_text(encoding="utf-8")


def test_cli_fails_when_a_prediction_is_rejected(tmp_path, golden_dir, goldens):
    preds = [perfect(g) for g in goldens]
    preds[0]["sha256"] = "0" * 64
    run = write_run(tmp_path / "run", preds)
    result = CliRunner().invoke(app, ["evaluate", str(run), "--golden", str(golden_dir)])
    assert result.exit_code == 1
    assert "REJECTED" in result.output


@pytest.mark.parametrize(
    ("expected", "predicted", "outcome"),
    [
        ("45", "45 años", CORRECT),
        ("45", "54", WRONG),
        ("45", None, MISSED),
        (None, None, CORRECT_NULL),
        (None, "45", INVENTED),
    ],
)
def test_field_outcome(expected, predicted, outcome):
    assert field_outcome(expected, predicted, "digits") == outcome


GOLDEN_LOC = {
    "page": 2,
    "bbox": {"x0": 0.1, "y0": 0.1, "x1": 0.3, "y1": 0.2},
    "also_at": [{"page": 3, "bbox": {"x0": 0.5, "y0": 0.5, "x1": 0.7, "y1": 0.6}}],
}


@pytest.mark.parametrize(
    ("page", "bbox", "status"),
    [
        (2, {"x0": 0.1, "y0": 0.1, "x1": 0.3, "y1": 0.2}, LOCATED),
        (3, {"x0": 0.5, "y0": 0.5, "x1": 0.7, "y1": 0.6}, LOCATED),
        (2, {"x0": 0.25, "y0": 0.1, "x1": 0.45, "y1": 0.2}, NOT_LOCATED),
        (1, {"x0": 0.1, "y0": 0.1, "x1": 0.3, "y1": 0.2}, WRONG_PAGE),
        (2, None, NO_BOX),
    ],
)
def test_check_box(page, bbox, status):
    got, iou = check_box({"page": page, "bbox": bbox}, GOLDEN_LOC, 0.5)
    assert got == status
    assert (iou is None) == (status in (WRONG_PAGE, NO_BOX))


# --------------------------------------------------------------------------- baseline


def _spoil(pred: dict) -> tuple[str, str]:
    """Make one present field wrong and drop one test; return what was touched."""
    name = next(k for k, v in pred["fields"].items() if v is not None)
    pred["fields"][name]["value"] = "ZZZ 999 not the value"
    return name, pred["tests"].pop(0)["value"]


def test_baseline_lists_what_broke(tmp_path, golden_dir, goldens):
    base = write_run(tmp_path / "base", [perfect(g) for g in goldens])
    preds = [perfect(g) for g in goldens]
    name, test = _spoil(preds[0])
    run = write_run(tmp_path / "run", preds)

    b = evaluate_against(run, base, golden_dir)["baseline"]
    assert b["documents"]["common"] == N
    assert b["flips"]["fixed"] == []
    broken = {(e["id"], e["field"], e["before"], e["after"]) for e in b["flips"]["broken"]}
    assert broken == {
        (goldens[0]["id"], name, CORRECT, WRONG),
        (goldens[0]["id"], "tests", "matched", "missed"),
    }
    assert b["fields"]["by_field"][name]["correct"]["delta"] == -1
    assert b["fields"]["total"]["precision"]["delta"] < 0
    assert b["tests"]["exact_lists"]["delta"] == -1
    assert [e["expected"] for e in b["flips"]["broken"] if e["field"] == "tests"] == [test]


def test_baseline_lists_what_was_fixed(tmp_path, golden_dir, goldens):
    preds = [perfect(g) for g in goldens]
    name, test = _spoil(preds[0])
    base = write_run(tmp_path / "base", preds)
    run = write_run(tmp_path / "run", [perfect(g) for g in goldens])

    b = evaluate_against(run, base, golden_dir)["baseline"]
    assert b["flips"]["broken"] == []
    fixed = {(e["field"], e["expected"]) for e in b["flips"]["fixed"]}
    assert ("tests", test) in fixed
    assert name in {f for f, _ in fixed}


def test_baseline_compares_only_documents_in_both(tmp_path, golden_dir, goldens):
    base = write_run(tmp_path / "base", [perfect(g) for g in goldens[:3]])
    preds = [perfect(g) for g in goldens[1:]]
    preds[-1]["extractor"]["error"] = {"code": "invalid_json", "message": "x"}
    preds[-1]["fields"] = {k: None for k in preds[-1]["fields"]}
    preds[-1]["tests"] = []
    run = write_run(tmp_path / "run", preds)

    r = evaluate_against(run, base, golden_dir)
    assert r["documents"]["evaluated"] == N - 2  # the full run is still reported in full
    d = r["baseline"]["documents"]
    assert (d["common"], d["only_in_run"], d["only_in_baseline"]) == (2, 0, 1)
    assert r["baseline"]["flips"] == {"fixed": [], "broken": [], "changed": []}


def test_baseline_refuses_the_run_itself(tmp_path, golden_dir, goldens):
    run = write_run(tmp_path / "run", [perfect(g) for g in goldens])
    with pytest.raises(LoadError, match="itself"):
        evaluate_against(run, run, golden_dir)


def test_cli_with_baseline(tmp_path, golden_dir, goldens):
    base = write_run(tmp_path / "base", [perfect(g) for g in goldens])
    preds = [perfect(g) for g in goldens]
    _spoil(preds[0])
    run = write_run(tmp_path / "run", preds)
    args = ["evaluate", str(run), "--golden", str(golden_dir), "--baseline", str(base)]
    result = CliRunner().invoke(app, args)
    assert result.exit_code == 0, result.output
    assert "0 fixed, 2 broken" in result.output
    md = (run / "eval" / "report.md").read_text(encoding="utf-8")
    assert "## Against baseline" in md and "### Broken (2)" in md
