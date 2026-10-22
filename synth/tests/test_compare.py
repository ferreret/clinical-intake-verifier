"""The compare modes against the cases shared with the TypeScript side."""

from __future__ import annotations

import pytest

from intake_synth.evaluate.compare import MODES, compare_key, values_match
from intake_synth.schema import load_compare_cases, load_fields

CASES = load_compare_cases()


@pytest.mark.parametrize("case", CASES, ids=[f"{c['mode']}:{c['a']!r}~{c['b']!r}" for c in CASES])
def test_shared_case(case):
    assert values_match(case["a"], case["b"], case["mode"]) is case["match"], case.get("note")
    assert values_match(case["b"], case["a"], case["mode"]) is case["match"], "not symmetric"


def test_every_configured_mode_is_implemented_and_covered():
    spec = load_fields()
    configured = set(spec["compare_modes"])
    used = {f["compare"] for f in spec["fields"]} | {spec["tests"]["compare"]}
    assert used <= configured
    assert MODES == configured
    covered = {c["mode"] for c in CASES}
    for mode in configured:
        assert mode in covered, f"no shared case for {mode}"
        assert any(c["match"] for c in CASES if c["mode"] == mode)
        assert any(not c["match"] for c in CASES if c["mode"] == mode)


def test_unknown_mode_is_an_error():
    with pytest.raises(ValueError, match="unknown compare mode"):
        compare_key("x", "fuzzy")
