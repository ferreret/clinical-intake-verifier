"""End-to-end properties of generated documents and their goldens."""

from __future__ import annotations

import hashlib
import re
import unicodedata

import pymupdf
import pytest

from intake_synth.generate import catalog
from intake_synth.generate.pipeline import GenerateOptions, generate_batch, generate_document
from intake_synth.schema import field_names, validate_golden

SEED = 7
N = 15
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


def test_goldens_validate_and_match_pdf(batch):
    out, manifest, docs = batch
    assert manifest["count"] == N
    for doc in docs:
        assert validate_golden(doc.golden) == []
        assert doc.golden["sha256"] == hashlib.sha256(doc.pdf).hexdigest()
        assert (out / doc.pdf_name).read_bytes() == doc.pdf
        assert set(doc.golden["fields"]) == set(field_names())


def test_batch_covers_the_variability_axes(batch):
    _, _manifest, docs = batch
    templates = {d.template for d in docs}
    assert templates == set(catalog.TEMPLATE_NAMES)
    assert any(d.scanned for d in docs) and any(not d.scanned for d in docs)
    assert any(d.golden["generator"]["handwritten_fields"] for d in docs)
    assert any(f is None for d in docs for f in d.golden["fields"].values())


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
        for name, v in f.items():
            if v is None:
                continue
            b = v["bbox"]
            assert 0 <= b["x0"] < b["x1"] <= 1, (doc.id, name, b)
            assert 0 <= b["y0"] < b["y1"] <= 1, (doc.id, name, b)
            if name not in ("FechaNacimiento", "Sexo"):
                assert v["value"] == v["printed"], (doc.id, name)


def test_request_number_repeats_are_collapsed_into_also_at(batch):
    _, _, docs = batch
    assert any(doc.golden["fields"]["NumeroPeticion"]["also_at"] for doc in docs)


def test_regenerating_one_index_is_byte_identical(batch):
    _, _, docs = batch
    again = generate_document(3, OPTS)
    assert again.golden == docs[3].golden
    assert again.pdf == docs[3].pdf


def test_scan_ratio_does_not_change_content():
    clean = generate_document(5, GenerateOptions(seed=SEED, scan_ratio=0.0))
    scanned = generate_document(5, GenerateOptions(seed=SEED, scan_ratio=1.0))
    assert not clean.scanned and scanned.scanned
    for name in field_names():
        a, b = clean.golden["fields"][name], scanned.golden["fields"][name]
        assert (a is None) == (b is None)
        if a is not None:
            assert a["value"] == b["value"] and a["printed"] == b["printed"]
    assert [t["value"] for t in clean.golden["tests"]] == [
        t["value"] for t in scanned.golden["tests"]
    ]


def _text_in_box(page: pymupdf.Page, bbox: dict, pad_pt: float = 1.5) -> str:
    w, h = page.rect.width, page.rect.height
    rect = pymupdf.Rect(
        bbox["x0"] * w - pad_pt,
        bbox["y0"] * h - pad_pt,
        bbox["x1"] * w + pad_pt,
        bbox["y1"] * h + pad_pt,
    )
    return page.get_text("text", clip=rect)


def test_boxes_enclose_their_text_on_clean_documents(batch):
    """On non-scanned PDFs the text layer inside each bbox must contain the printed value."""
    _, _, docs = batch
    checked = 0
    for doc in docs:
        if doc.scanned:
            continue
        pdf = pymupdf.open(stream=doc.pdf, filetype="pdf")
        for name, v in doc.golden["fields"].items():
            if v is None:
                continue
            page = pdf[v["page"] - 1]
            expected = v["printed"]
            expected = expected.removeprefix("[X] ")
            found = _text_in_box(page, v["bbox"])
            assert _fold(expected) in _fold(found), (doc.id, name, expected, found)
            for loc in v["also_at"]:
                found = _text_in_box(pdf[loc["page"] - 1], loc["bbox"])
                assert _fold(v["printed"]) in _fold(found), (doc.id, name, "also_at", found)
            checked += 1
        for t in doc.golden["tests"]:
            found = _text_in_box(pdf[t["page"] - 1], t["bbox"])
            assert _fold(t["printed"]) in _fold(found), (doc.id, "test", t["printed"], found)
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
            expected = v["printed"].removeprefix("[X] ")
            found = _fold(_text_in_box(pdf[v["page"] - 1], v["bbox"], pad_pt=0.5))
            # Allow the checkbox glyph-less neighbour label but not a whole extra field.
            assert len(found) <= len(_fold(expected)) + 12, (doc.id, name, expected, found)
        pdf.close()


def test_scanned_documents_are_image_only(batch):
    _, _, docs = batch
    for doc in docs:
        if not doc.scanned:
            continue
        pdf = pymupdf.open(stream=doc.pdf, filetype="pdf")
        assert pdf[0].get_text("text").strip() == ""
        assert len(pdf[0].get_images()) == 1
        assert abs(pdf[0].rect.width - 595.28) < 0.5
        pdf.close()
