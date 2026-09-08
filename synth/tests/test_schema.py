"""The field configuration and the golden JSON Schema must never drift apart."""

from intake_synth.schema import field_names, load_fields, load_golden_schema, validate_golden


def test_golden_schema_lists_exactly_the_configured_fields():
    names = field_names()
    fields_schema = load_golden_schema()["properties"]["fields"]
    assert fields_schema["required"] == names
    assert list(fields_schema["properties"]) == names


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
