"""The mock LIS and how each document's scenario relates to it."""

from __future__ import annotations

import json

import pytest

from intake_synth.evaluate.compare import compare_key, values_match
from intake_synth.generate import catalog
from intake_synth.generate.lis import DNI_LETTERS, SCENARIOS, population
from intake_synth.generate.pipeline import GenerateOptions, generate_batch, generate_document

SEED = 7
N = 80


def _checks(doc_id: str) -> bool:
    digits = doc_id[:-1]
    if digits[0] in "XYZ":
        digits = str("XYZ".index(digits[0])) + digits[1:]
    return DNI_LETTERS[int(digits) % 23] == doc_id[-1]


@pytest.fixture(scope="module")
def docs():
    opts = GenerateOptions(seed=SEED, scan_ratio=0)
    return [generate_document(i, opts).golden for i in range(N)]


def test_population_is_consistent():
    pop = population(SEED)
    for group in (pop.patients, pop.physicians, pop.insurers):
        assert len({r.id for r in group}) == len(group)
    assert len({p.doc_id for p in pop.patients}) == len(pop.patients)
    assert len({m.colegiado for m in pop.physicians}) == len(pop.physicians)
    assert all(_checks(p.doc_id) for p in pop.patients)
    assert pop.unregistered_insurer in catalog.INSURERS
    assert pop.insurer(pop.unregistered_insurer) is None
    assert len(pop.insurers) == len(catalog.INSURERS) - 1


def test_homonyms_share_a_name_and_nothing_else():
    pop = population(SEED)
    by_id = {p.id: p for p in pop.patients}
    names: dict[tuple[str, str, str], list] = {}
    for pid in pop.homonyms:
        p = by_id[pid]
        names.setdefault((p.first_name, p.last_name1, p.last_name2), []).append(p)
    for pair in names.values():
        assert len(pair) >= 2
        assert len({p.birth_date for p in pair}) == len(pair)
        assert len({p.doc_id for p in pair}) == len(pair)


def test_population_depends_on_the_seed_only():
    assert population(SEED) is population(SEED)
    assert population(SEED).to_json() != population(SEED + 1).to_json()


def test_every_scenario_occurs(docs):
    assert {g["lis"]["scenario"] for g in docs} == set(SCENARIOS)


def test_documents_agree_with_the_lis_as_their_scenario_says(docs):
    pop = population(SEED)
    patients = {p.id: p for p in pop.patients}
    lis_doc_ids = {p.doc_id for p in pop.patients}
    for g in docs:
        f, rec = g["fields"], g["lis"]
        scenario = rec["scenario"]
        if scenario == "new_patient":
            assert rec["patient_id"] is None
            if f["DocumentoIdentidad"]:
                assert (
                    compare_key(f["DocumentoIdentidad"]["value"], "alnum_upper") not in lis_doc_ids
                )
            continue
        p = patients[rec["patient_id"]]
        assert (scenario == "homonym") == (p.id in pop.homonyms), g["id"]
        assert compare_key(p.last_name1, "casefold") in compare_key(
            f["Paciente"]["value"], "casefold"
        )
        lis_values = {
            "DocumentoIdentidad": p.doc_id,
            "FechaNacimiento": p.birth_date.strftime("%d/%m/%Y"),
            "Telefono": p.phone,
        }
        for field, lis_value in lis_values.items():
            if f[field] is None:
                assert field != rec["differs"], (g["id"], field)
                continue
            mode = {"DocumentoIdentidad": "alnum_upper", "Telefono": "digits"}.get(field, "exact")
            printed = f[field]["value"]
            if field == "Telefono":  # forms may add the +34 prefix the LIS does not keep
                printed = compare_key(printed, "digits")[-9:]
            agrees = values_match(printed, lis_value, mode)
            assert agrees == (field != rec["differs"]), (g["id"], scenario, field)
        if rec["differs"]:
            expected = "document" if scenario == "drift" else "lis"
            assert rec["correct"] == expected


def test_physicians_and_insurers_link_to_their_records(docs):
    pop = population(SEED)
    physicians = {m.id: m for m in pop.physicians}
    for g in docs:
        f, rec = g["fields"], g["lis"]
        if rec["physician_id"]:
            m = physicians[rec["physician_id"]]
            assert f["NombreMedico"]["value"] == f"{m.first_name} {m.last_name1} {m.last_name2}"
            if f["NumeroColegiado"]:
                assert values_match(f["NumeroColegiado"]["value"], m.colegiado, "digits")
        insurer = f["NombreMutua"]["value"] if f["NombreMutua"] else None
        registered = pop.insurer(insurer) if insurer else None
        assert rec["insurer_id"] == (registered.id if registered else None), g["id"]


def test_titles_match_the_physicians_sex(docs):
    pop = population(SEED)
    physicians = {m.id: m for m in pop.physicians}
    for g in docs:
        m = physicians.get(g["lis"]["physician_id"])
        printed = g["fields"]["NombreMedico"]["printed"]
        if m and printed.startswith("Dr"):
            assert printed.startswith("Dra. " if m.sex == "M" else "Dr. "), (g["id"], printed)


def test_batch_writes_the_lis(tmp_path):
    opts = GenerateOptions(seed=SEED, scan_ratio=0)
    manifest = generate_batch(range(2), opts, tmp_path)
    data = json.loads((tmp_path / manifest["lis"]).read_text("utf-8"))
    assert data == population(SEED).to_json()
