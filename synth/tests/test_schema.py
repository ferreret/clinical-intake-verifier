"""The field configuration, the golden JSON Schema and the prediction JSON Schema must never drift apart."""

from intake_synth.schema import (
    field_names,
    load_fields,
    load_golden_schema,
    load_prediction_schema,
    validate_golden,
    validate_prediction,
)


def test_golden_schema_lists_exactly_the_configured_fields():
    names = field_names()
    fields_schema = load_golden_schema()["properties"]["fields"]
    assert fields_schema["required"] == names
    assert list(fields_schema["properties"]) == names


def test_prediction_schema_lists_exactly_the_configured_fields():
    names = field_names()
    fields_schema = load_prediction_schema()["properties"]["fields"]
    assert fields_schema["required"] == names
    assert list(fields_schema["properties"]) == names


def test_prediction_field_is_a_subset_of_golden_field():
    """A golden field minus what the extractor cannot know is a predicted field: no adapters."""
    golden = load_golden_schema()["$defs"]
    prediction = load_prediction_schema()["$defs"]
    assert set(prediction["field"]["properties"]) == {"value", "page", "bbox"}
    assert set(prediction["field"]["properties"]) <= set(golden["field"]["properties"])
    assert prediction["bbox"]["properties"] == golden["bbox"]["properties"]
    assert prediction["bbox"]["required"] == golden["bbox"]["required"]


def test_field_names_are_unique_and_compare_modes_known():
    cfg = load_fields()
    names = [f["name"] for f in cfg["fields"]]
    assert len(names) == len(set(names))
    modes = set(cfg["compare_modes"])
    for f in cfg["fields"]:
        assert f["compare"] in modes, f["name"]
    assert cfg["tests"]["compare"] in modes


def test_validate_golden_reports_errors_for_garbage():
    errors = validate_golden({"golden_version": 2})
    assert errors
    assert any("golden_version" in e for e in errors)


def _minimal_prediction() -> dict:
    return {
        "prediction_version": 1,
        "id": "synth-000000",
        "file": "synth-000000.pdf",
        "sha256": "0" * 64,
        "extractor": {
            "model": "test-model",
            "model_version": None,
            "prompt_version": "1",
            "input_mode": "pdf-inline",
            "temperature": 0,
            "thinking_level": None,
            "attempts": 1,
            "latency_ms": 0,
            "usage": {"input_tokens": None, "output_tokens": None, "thinking_tokens": None},
            "created_at": "2026-09-09T00:00:00.000Z",
            "error": None,
        },
        "pages": [{"number": 1, "width_pt": 595.28, "height_pt": 841.89}],
        "fields": {name: None for name in field_names()},
        "tests": [],
        "warnings": [],
    }


def test_validate_prediction_accepts_minimal_and_rejects_garbage():
    pred = _minimal_prediction()
    assert validate_prediction(pred) == []

    pred["fields"]["Paciente"] = {
        "value": "RUIZ ORTEGA, MARIA",
        "page": 1,
        "bbox": {"x0": 0.1, "y0": 0.2, "x1": 0.4, "y1": 0.22},
    }
    pred["tests"] = [{"value": "Urea", "page": 1, "bbox": None}]
    pred["warnings"] = [{"code": "pattern_mismatch", "field": "FechaNacimiento", "detail": "x"}]
    assert validate_prediction(pred) == []

    assert validate_prediction({"prediction_version": 1})
    pred["warnings"] = [{"code": "made_up", "field": None, "detail": ""}]
    assert any("warnings" in e for e in validate_prediction(pred))
