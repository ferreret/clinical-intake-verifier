"""Scoring fused documents against their LIS scenario."""

from __future__ import annotations

import pytest

from intake_synth.evaluate.fusion import _link_outcome, _lis_values, score_fused
from intake_synth.schema import field_names, load_fields

LIS = _lis_values(
    {
        "patients": [
            {
                "id": "P1",
                "first_name": "María",
                "last_name1": "García",
                "last_name2": "López",
                "sex": "M",
                "birth_date": "03/02/1961",
                "doc_id": "12345678Z",
                "phone": "612345678",
            }
        ],
        "physicians": [],
        "insurers": [],
    }
)


def golden(scenario: str, differs: str | None = None, correct: str | None = None, **values):
    fields = {n: None for n in field_names()}
    fields.update({k: {"value": v} for k, v in values.items()})
    return {
        "id": "synth-000001",
        "fields": fields,
        "lis": {
            "scenario": scenario,
            "patient_id": "P1" if scenario != "new_patient" else None,
            "physician_id": None,
            "insurer_id": None,
            "differs": differs,
            "correct": correct,
        },
    }


def fused(patient_status: str, record: str | None, states: dict[str, tuple[str, str, str | None]]):
    def link(status, rid=None):
        return {"status": status, "recordId": rid, "candidates": []}

    return {
        "links": {
            "patient": link(patient_status, record),
            "physician": link("none"),
            "insurer": link("none"),
        },
        "fields": [
            {
                "name": n,
                "state": states.get(n, ("grey", "absent_optional", None))[0],
                "reason": states.get(n, ("grey", "absent_optional", None))[1],
                "value": states.get(n, ("grey", "absent_optional", None))[2],
            }
            for n in field_names()
        ],
    }


@pytest.mark.parametrize(
    ("expected", "status", "rid", "candidates", "outcome"),
    [
        ("P1", "linked", "P1", [], "linked"),
        ("P1", "linked", "P2", [], "wrong_link"),
        (None, "linked", "P2", [], "wrong_link"),
        (None, "none", None, [], "correct_none"),
        (None, "candidate", "P2", [], "false_candidate"),
        ("P1", "candidate", "P1", [], "candidate_right"),
        ("P1", "ambiguous", None, ["P1", "P2"], "ambiguous_with_right"),
        ("P1", "none", None, [], "missed"),
    ],
)
def test_link_outcomes(expected, status, rid, candidates, outcome):
    link = {"status": status, "recordId": rid, "candidates": candidates}
    assert _link_outcome(expected, link) == outcome


def test_a_green_value_matching_in_another_format_is_right():
    g = golden("match", Paciente="GARCÍA LÓPEZ, MARÍA", Telefono="+34 612 345 678")
    f = fused(
        "linked",
        "P1",
        {
            "Paciente": ("green", "agree", "María García López"),
            "Telefono": ("green", "agree", "612345678"),
        },
    )
    out = score_fused(g, f, LIS, load_fields())
    assert out["links"]["patient"] == "linked"
    assert not any(x["wrong_green"] for x in out["fields"])


def test_after_a_form_typo_the_lis_value_is_the_right_one():
    g = golden("form_typo", "DocumentoIdentidad", "lis", DocumentoIdentidad="12345679Z")
    caught = fused("candidate", "P1", {"DocumentoIdentidad": ("red", "conflict", None)})
    out = score_fused(g, caught, LIS, load_fields())
    doc = next(x for x in out["fields"] if x["field"] == "DocumentoIdentidad")
    assert doc["truth"] == "12345678Z" and doc["discrepancy"] and not doc["wrong_green"]

    # Had the engine taken the form's value and painted it green, that would be wrong.
    slipped = fused("linked", "P1", {"DocumentoIdentidad": ("green", "agree", "12345679Z")})
    out = score_fused(g, slipped, LIS, load_fields())
    assert next(x for x in out["fields"] if x["field"] == "DocumentoIdentidad")["wrong_green"]


def test_a_value_the_form_leaves_out_is_the_lis_value():
    g = golden("match")
    f = fused("linked", "P1", {"Telefono": ("green", "lis_only", "612345678")})
    out = score_fused(g, f, LIS, load_fields())
    tel = next(x for x in out["fields"] if x["field"] == "Telefono")
    assert tel["truth"] == "612345678" and not tel["wrong_green"]


def test_green_with_no_value_is_wrong():
    g = golden("match", Paciente="María García López")
    f = fused("linked", "P1", {"Paciente": ("green", "agree", None)})
    out = score_fused(g, f, LIS, load_fields())
    assert next(x for x in out["fields"] if x["field"] == "Paciente")["wrong_green"]


def test_each_field_says_whether_its_proposed_value_is_right():
    g = golden("match", Paciente="María García López", Telefono="612345678")
    f = fused(
        "linked",
        "P1",
        {
            "Paciente": ("green", "agree", "María García López"),
            "Telefono": ("orange", "ai_only", "612345670"),
        },
    )
    out = {x["field"]: x for x in score_fused(g, f, LIS, load_fields())["fields"]}
    assert out["Paciente"]["right"]
    # A misread outside green is not a wrong green, but it is still a wrong value.
    assert not out["Telefono"]["right"] and not out["Telefono"]["wrong_green"]
