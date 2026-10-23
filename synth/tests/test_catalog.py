"""The lab catalog and the insurers' dialects."""

from __future__ import annotations

import re
import unicodedata

import pytest
from reportlab.pdfbase.pdfmetrics import stringWidth

from intake_synth.evaluate.compare import compare_key
from intake_synth.generate import catalog
from intake_synth.generate.dialects import GENERIC, MAX_WIDTH_PT, dialects
from intake_synth.generate.labcatalog import SECTIONS, build_catalog

SEEDS = (0, 7, 42)

# What a printed test name may contain: the extractor's garbled-text check flags any other
# symbol next to a letter, and Cyrillic anywhere (docs/extractor-contract.md). The Catalan
# middle dot is allowed between two l's only.
ORDINARY = set(" .,'-/()+&")
MIDDLE_DOT = re.compile(r"(?<=l)·(?=l)", re.IGNORECASE)


def test_codes_and_names_are_unique():
    cat = build_catalog()
    codes = [t.code for t in cat.tests]
    assert len(set(codes)) == len(codes)
    assert len({t.name for t in cat.tests}) == len(cat.tests)
    for t in cat.tests:
        assert re.fullmatch(r"[A-Z]{2}\d{4}", t.code), t.code
        assert t.code[:2] == t.section and t.section in SECTIONS


def test_catalog_is_large_enough_to_need_a_search():
    assert len(build_catalog().tests) >= 700


def test_profiles_and_common_tests_resolve():
    cat = build_catalog()
    for p in cat.profiles:
        assert len(p.components) >= 2
        for code in p.components:
            cat.by_code(code)
    pids = {p.id for p in cat.profiles}
    for ref in cat.common:
        assert ref in pids or cat.by_code(ref)


def test_catalog_does_not_depend_on_the_seed():
    first = build_catalog().to_json()
    build_catalog.cache_clear()
    assert build_catalog().to_json() == first


def test_catalog_json_lists_every_code():
    cat = build_catalog()
    data = cat.to_json()
    assert [t["code"] for t in data["tests"]] == [t.code for t in cat.tests]
    assert {p["id"] for p in data["profiles"]} == {p.id for p in cat.profiles}


@pytest.mark.parametrize("seed", SEEDS)
def test_every_issuer_names_every_test_once(seed):
    cat = build_catalog()
    for issuer, d in dialects(seed).items():
        assert set(d.names) == {t.code for t in cat.tests}, issuer
        keys = [compare_key(n, "casefold") for n in d.names.values()]
        keys += [compare_key(p.name, "casefold") for p in d.profiles.values()]
        assert len(set(keys)) == len(keys), issuer


@pytest.mark.parametrize("seed", SEEDS)
def test_printed_names_fit_and_look_clean(seed):
    for issuer, d in dialects(seed).items():
        for name in [*d.names.values(), *(p.name for p in d.profiles.values())]:
            assert stringWidth(name, "Helvetica", 9) <= MAX_WIDTH_PT, (issuer, name)
            for ch in MIDDLE_DOT.sub("", name):
                assert ch.isalnum() or ch in ORDINARY, (issuer, name, ch)
                assert "CYRILLIC" not in unicodedata.name(ch, ""), (issuer, name)


def test_dialects_differ_between_insurers_and_seeds():
    ds = dialects(42)
    glucosa = build_catalog().find("Glucosa").code
    assert len({d.name(glucosa) for d in ds.values()}) >= 3
    assert dialects(42) is ds
    assert any(dialects(7)[i].names != ds[i].names for i in catalog.INSURERS)


def test_the_generic_dialect_keeps_the_lab_profiles():
    cat = build_catalog()
    generic = dialects(42)[GENERIC]
    for p in cat.profiles:
        assert generic.profiles[p.id].codes == p.components
        assert generic.profiles[p.id].name == p.names[0]


def test_some_insurer_profiles_differ_from_the_lab():
    cat = build_catalog()
    ds = dialects(42)
    differing = [
        (i, p.id)
        for i in catalog.INSURERS
        for p in cat.profiles
        if set(ds[i].profiles[p.id].codes) != set(p.components)
    ]
    assert len(differing) >= 5


def test_catalan_insurers_print_in_catalan():
    cat = build_catalog()
    ds = dialects(42)
    catalan = [i for i in catalog.INSURERS if catalog.INSURER_LANGUAGE[i] == "ca"]
    assert len(catalan) == 3
    urocultivo = cat.find("Urocultivo").code
    for issuer, d in ds.items():
        assert d.language == ("ca" if issuer in catalan else "es")
        uro = d.name(urocultivo).casefold()
        assert ("cultiu" if issuer in catalan else "cultivo") in uro, (issuer, uro)
    assert any("·" in n for i in catalan for n in ds[i].names.values())
