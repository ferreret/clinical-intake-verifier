"""End-to-end properties of generated documents and their goldens."""

from __future__ import annotations

import hashlib
import re
import unicodedata

import pymupdf
import pytest

from intake_synth.generate import catalog
from intake_synth.generate.pipeline import GenerateOptions, generate_batch, generate_document
from intake_synth.generate.recorder import PAGE_ROLES
from intake_synth.schema import field_names, validate_golden

SEED = 7
N = 24
OPTS = GenerateOptions(seed=SEED, scan_ratio=0.5)


@pytest.fixture(scope="module")
def batch(tmp_path_factory):
    out = tmp_path_factory.mktemp("synth")
    manifest = generate_batch(range(N), OPTS, out)
    docs = [generate_document(i, OPTS) for i in range(N)]
    return out, manifest, docs


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s).strip().casefold()


def _text_in_box(page: pymupdf.Page, bbox: dict, pad_pt: float = 1.5) -> str:
    w, h = page.rect.width, page.rect.height
    rect = pymupdf.Rect(
        bbox["x0"] * w - pad_pt,
        bbox["y0"] * h - pad_pt,
        bbox["x1"] * w + pad_pt,
        bbox["y1"] * h + pad_pt,
    )
    return page.get_text("text", clip=rect)


def _expected_text(printed: str) -> str:
    return printed.removeprefix("[X] ")


# --------------------------------------------------------------------------- contract


def test_goldens_validate_and_match_pdf(batch):
    out, manifest, docs = batch
    assert manifest["count"] == N
    for doc in docs:
        assert validate_golden(doc.golden) == []
        assert doc.golden["sha256"] == hashlib.sha256(doc.pdf).hexdigest()
        assert (out / doc.pdf_name).read_bytes() == doc.pdf
        assert set(doc.golden["fields"]) == set(field_names())


def test_pages_describe_the_pdf(batch):
    _, _, docs = batch
    for doc in docs:
        pdf = pymupdf.open(stream=doc.pdf, filetype="pdf")
        pages = doc.golden["pages"]
        assert len(pdf) == len(pages)
        assert [p["number"] for p in pages] == list(range(1, len(pages) + 1))
        for p, pg in zip(pages, pdf, strict=True):
            assert p["role"] in PAGE_ROLES
            assert abs(pg.rect.width - p["width_pt"]) < 0.5
            assert abs(pg.rect.height - p["height_pt"]) < 0.5
        assert sum(1 for p in pages if p["role"] == "request") >= 1
        pdf.close()


def test_every_recorded_page_exists(batch):
    _, _, docs = batch
    for doc in docs:
        n = len(doc.golden["pages"])
        for name, v in doc.golden["fields"].items():
            if v is None:
                continue
            assert 1 <= v["page"] <= n, (doc.id, name)
            for loc in v["also_at"]:
                assert 1 <= loc["page"] <= n, (doc.id, name)
        for t in doc.golden["tests"]:
            assert 1 <= t["page"] <= n
            for loc in t["also_at"]:
                assert 1 <= loc["page"] <= n


# --------------------------------------------------------------------------- variability


def test_batch_covers_the_variability_axes(batch):
    _, _, docs = batch
    assert {d.template for d in docs} == set(catalog.TEMPLATE_NAMES)
    assert any(d.scanned for d in docs) and any(not d.scanned for d in docs)
    assert any(d.golden["generator"]["handwritten_fields"] for d in docs)
    assert any(f is None for d in docs for f in d.golden["fields"].values())


def test_batch_is_mostly_multipage_with_fields_anywhere(batch):
    _, _, docs = batch
    multipage = [d for d in docs if d.page_count > 1]
    assert len(multipage) > len(docs) / 2
    # The request form is not always the first sheet.
    assert any(d.golden["pages"][0]["role"] != "request" for d in docs)
    # Some primary field or test lives beyond page 1.
    beyond = [
        d
        for d in docs
        if any(v is not None and v["page"] > 1 for v in d.golden["fields"].values())
        or any(t["page"] > 1 for t in d.golden["tests"])
    ]
    assert beyond
    # Companion sheets repeat values: some field has occurrences on two different pages.
    spread = [
        d
        for d in docs
        if any(
            v is not None and any(loc["page"] != v["page"] for loc in v["also_at"])
            for v in d.golden["fields"].values()
        )
    ]
    assert spread


def test_always_present_fields_and_normalisation(batch):
    _, _, docs = batch
    for doc in docs:
        f = doc.golden["fields"]
        for name in ("Paciente", "NumeroPeticion", "NombreMedico", "FechaNacimiento"):
            assert f[name] is not None, f"{doc.id}: {name} missing"
        assert re.fullmatch(r"\d{2}/\d{2}/\d{4}", f["FechaNacimiento"]["value"])
        if f["Sexo"] is not None:
            assert f["Sexo"]["value"] in ("H", "M")
        assert len(doc.golden["tests"]) >= 1
        assert len({t["value"] for t in doc.golden["tests"]}) == len(doc.golden["tests"])
        for name, v in f.items():
            if v is None:
                continue
            b = v["bbox"]
            assert 0 <= b["x0"] < b["x1"] <= 1, (doc.id, name, b)
            assert 0 <= b["y0"] < b["y1"] <= 1, (doc.id, name, b)
            if name not in ("FechaNacimiento", "Sexo"):
                assert v["value"] == v["printed"], (doc.id, name)


def test_handwritten_fields_match_primary_styles(batch):
    _, _, docs = batch
    for doc in docs:
        expected = sorted(
            n for n, v in doc.golden["fields"].items() if v and v["style"] == "handwritten"
        )
        assert doc.golden["generator"]["handwritten_fields"] == expected


def test_request_number_repeats_are_collapsed_into_also_at(batch):
    _, _, docs = batch
    assert any(doc.golden["fields"]["NumeroPeticion"]["also_at"] for doc in docs)


# --------------------------------------------------------------------------- determinism


def test_regenerating_one_index_is_byte_identical(batch):
    _, _, docs = batch
    again = generate_document(3, OPTS)
    assert again.golden == docs[3].golden
    assert again.pdf == docs[3].pdf


def test_scan_ratio_does_not_change_content():
    clean = generate_document(5, GenerateOptions(seed=SEED, scan_ratio=0.0))
    scanned = generate_document(5, GenerateOptions(seed=SEED, scan_ratio=1.0))
    assert not clean.scanned and scanned.scanned
    assert [p["role"] for p in clean.golden["pages"]] == [
        p["role"] for p in scanned.golden["pages"]
    ]
    for name in field_names():
        a, b = clean.golden["fields"][name], scanned.golden["fields"][name]
        assert (a is None) == (b is None)
        if a is not None:
            assert a["value"] == b["value"] and a["printed"] == b["printed"]
    assert [t["value"] for t in clean.golden["tests"]] == [
        t["value"] for t in scanned.golden["tests"]
    ]


# --------------------------------------------------------------------------- boxes vs text


def test_boxes_enclose_their_text_on_clean_documents(batch):
    """On non-scanned PDFs the text layer inside each box must contain the printed value,
    for primary locations and for every ``also_at`` location, on whatever page they are."""
    _, _, docs = batch
    checked = 0
    for doc in docs:
        if doc.scanned:
            continue
        pdf = pymupdf.open(stream=doc.pdf, filetype="pdf")
        entries = [(n, v) for n, v in doc.golden["fields"].items() if v is not None]
        entries += [("test", t) for t in doc.golden["tests"]]
        for name, v in entries:
            found = _text_in_box(pdf[v["page"] - 1], v["bbox"])
            assert _fold(_expected_text(v["printed"])) in _fold(found), (
                doc.id,
                name,
                v["printed"],
                found,
            )
            for loc in v["also_at"]:
                found = _text_in_box(pdf[loc["page"] - 1], loc["bbox"])
                assert _fold(_expected_text(loc["printed"])) in _fold(found), (
                    doc.id,
                    name,
                    "also_at",
                    loc["printed"],
                    found,
                )
            checked += 1
        pdf.close()
    assert checked > 0


def test_boxes_are_tight_on_clean_documents(batch):
    """A bbox must not swallow neighbouring text: the clip should contain little else."""
    _, _, docs = batch
    for doc in docs:
        if doc.scanned:
            continue
        pdf = pymupdf.open(stream=doc.pdf, filetype="pdf")
        for name, v in doc.golden["fields"].items():
            if v is None or v["style"] == "handwritten":
                continue
            expected = _expected_text(v["printed"])
            found = _fold(_text_in_box(pdf[v["page"] - 1], v["bbox"], pad_pt=0.5))
            assert len(found) <= len(_fold(expected)) + 12, (doc.id, name, expected, found)
        pdf.close()


def test_scanned_documents_are_image_only_on_every_page(batch):
    _, _, docs = batch
    for doc in docs:
        if not doc.scanned:
            continue
        pdf = pymupdf.open(stream=doc.pdf, filetype="pdf")
        assert len(doc.golden["generator"]["scan"]["pages"]) == len(pdf)
        for page in pdf:
            assert page.get_text("text").strip() == ""
            assert len(page.get_images()) == 1
            assert abs(page.rect.width - 595.28) < 0.5
        pdf.close()
