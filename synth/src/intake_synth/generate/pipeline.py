"""End-to-end generation of one document or a batch.

A document is a sequence of sheets: the main request form (one template, possibly continued
over several pages) plus companion sheets in random order, the way real scans arrive. Any
field may therefore sit on any page, and the request is not always page 1.

Determinism contract: the seed of document ``i`` is derived from ``(seed, i)``, so
``generate_document(i)`` produces byte-identical output whether run alone or inside a batch.
The scan decision is the first random draw, so changing ``scan_ratio`` never changes the
content of a document, only whether it is passed through the scanner simulation.
"""

from __future__ import annotations

import hashlib
import json
import random
from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
from faker import Faker
from reportlab.lib.pagesizes import A4

from .. import __version__
from . import catalog
from .golden import build_golden
from .identities import make_doc_data
from .model import DocData
from .recorder import INK_COLORS, HandwritingPlan, Recorder
from .scan import sample_scan_params, scan_pdf, transform_box_pt
from .templates import HANDWRITING_CANDIDATES, SHEETS, TEMPLATES

MANIFEST_NAME = "manifest.json"

# Companion sheets and their relative frequency. "duplicate" re-renders the request form
# (the same sheet scanned twice) and is handled by the pipeline, not by SHEETS.
SHEET_WEIGHTS: dict[str, int] = {
    "authorization": 3,
    "id-copy": 2,
    "consent": 2,
    "fax-cover": 1,
    "blank": 2,
    "duplicate": 1,
}
# Number of companion sheets: most documents are multipage.
EXTRA_SHEET_COUNTS = (0, 1, 2, 3, 4)
EXTRA_SHEET_WEIGHTS = (25, 35, 25, 10, 5)


@dataclass(frozen=True)
class GenerateOptions:
    seed: int = 42
    scan_ratio: float = 0.5
    templates: tuple[str, ...] = catalog.TEMPLATE_NAMES
    dpi: int = 200
    handwriting_ratio: float = 0.4


@dataclass(frozen=True)
class GeneratedDoc:
    id: str
    pdf: bytes
    golden: dict
    template: str
    scanned: bool

    @property
    def pdf_name(self) -> str:
        return f"{self.id}.pdf"

    @property
    def golden_name(self) -> str:
        return f"{self.id}.json"

    @property
    def page_count(self) -> int:
        return len(self.golden["pages"])


def doc_seed(seed: int, index: int) -> int:
    digest = hashlib.sha256(f"{seed}:{index}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def doc_id(index: int) -> str:
    return f"synth-{index:06d}"


def _present_candidates(data: DocData, template: str) -> list[str]:
    ins = data.insurance
    present = {
        "Telefono": data.patient.phone is not None,
        "NumeroAutorizacion": ins is not None and ins.autorizacion is not None,
        "NumeroSolicitudMutua": ins is not None and ins.solicitud is not None,
        "NumeroTarjeta": ins is not None and ins.tarjeta is not None,
        "Edad": data.age_printed is not None,
        "NumeroColegiado": data.physician.colegiado is not None,
        "FechaNacimiento": True,
    }
    return [f for f in HANDWRITING_CANDIDATES[template] if present.get(f, False)]


def _plan_handwriting(
    rng: random.Random, data: DocData, template: str, ratio: float
) -> HandwritingPlan:
    font = rng.choice(["Caveat", "IndieFlower"])
    ink = rng.choice(INK_COLORS)
    scale = rng.uniform(1.2, 1.45)
    if rng.random() >= ratio:
        return HandwritingPlan(font=font, ink=ink, scale=scale)
    candidates = _present_candidates(data, template)
    if not candidates:
        return HandwritingPlan(font=font, ink=ink, scale=scale)
    k = rng.randint(1, min(3, len(candidates)))
    return HandwritingPlan(
        fields=frozenset(rng.sample(candidates, k)), font=font, ink=ink, scale=scale
    )


def _plan_sheets(rng: random.Random, data: DocData) -> list[str]:
    """Order of sheets in the scan. The request is always present; a fax cover always leads;
    a duplicate always follows the request; everything else is shuffled."""
    n_extra = rng.choices(EXTRA_SHEET_COUNTS, weights=EXTRA_SHEET_WEIGHTS, k=1)[0]
    pool = dict(SHEET_WEIGHTS)
    if data.insurance is None:
        pool.pop("authorization")
    extras: list[str] = []
    for _ in range(n_extra):
        kinds = [k for k in pool if k == "blank" or k not in extras]
        if not kinds:
            break
        extras.append(rng.choices(kinds, weights=[pool[k] for k in kinds], k=1)[0])
    cover = [e for e in extras if e == "fax-cover"]
    others = [e for e in extras if e not in ("fax-cover", "duplicate")]
    rng.shuffle(others)
    pos = rng.randint(0, len(others))
    seq = others[:pos] + ["request"] + others[pos:]
    if "duplicate" in extras:
        seq.insert(seq.index("request") + 1, "duplicate")
    return cover + seq


def generate_document(index: int, opts: GenerateOptions) -> GeneratedDoc:
    if not opts.templates:
        raise ValueError("at least one template is required")
    seed_i = doc_seed(opts.seed, index)
    rng = random.Random(seed_i)
    fake = Faker("es_ES")
    fake.seed_instance(seed_i)
    np_rng = np.random.default_rng(seed_i)

    scan_roll = rng.random()
    template = rng.choice(list(opts.templates))
    data = make_doc_data(rng, fake, index, template=template)
    plan = _plan_handwriting(rng, data, template, opts.handwriting_ratio)
    sheets = _plan_sheets(rng, data)
    layout_seed = rng.getrandbits(64)
    hand_seed = rng.getrandbits(64)

    rec = Recorder(A4, random.Random(hand_seed), plan, role=sheets[0])
    for i, kind in enumerate(sheets):
        if i > 0:
            rec.new_page(kind)
        if kind in ("request", "duplicate"):
            # Same layout seed and same handwriting rng: a duplicate is the very same sheet.
            rec.rng = random.Random(hand_seed)
            TEMPLATES[template](rec, data, random.Random(layout_seed))
        else:
            SHEETS[kind](rec, data, rng, len(sheets))
    pdf = rec.save()
    items = rec.items
    pages = rec.pages

    scan_public = None
    if scan_roll < opts.scan_ratio:
        params = sample_scan_params(rng, n_pages=len(pages), dpi=opts.dpi)
        pdf = scan_pdf(pdf, params, np_rng)
        items = [
            replace(
                d,
                box=transform_box_pt(
                    d.box,
                    pages[d.page - 1].width,
                    pages[d.page - 1].height,
                    params.pages[d.page - 1],
                    opts.dpi,
                ),
            )
            for d in items
        ]
        scan_public = params.public()

    generator = {
        "version": __version__,
        "seed": opts.seed,
        "index": index,
        "template": template,
        "scan": scan_public,
        "handwritten_fields": [],  # filled in by build_golden from the primary styles
    }
    context = {
        "issue_date": data.issue_date.isoformat(),
        "center": data.center.name,
        "service": data.service,
        "nhc": data.nhc if template == "hospital-compact" else None,
        "observations": data.observations,
        "diagnosis": data.diagnosis,
        "urgent": data.urgent,
        "sex_shown": data.show_sex,
        "insurance_block": data.insurance is not None,
        "sheets": sheets,
    }
    id_ = doc_id(index)
    golden = build_golden(
        doc_id=id_,
        file_name=f"{id_}.pdf",
        sha256=hashlib.sha256(pdf).hexdigest(),
        generator=generator,
        pages=pages,
        items=items,
        context=context,
    )
    return GeneratedDoc(id_, pdf, golden, template, scan_public is not None)


def write_document(doc: GeneratedDoc, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / doc.pdf_name).write_bytes(doc.pdf)
    with open(out_dir / doc.golden_name, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc.golden, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def generate_batch(
    indices: Iterable[int],
    opts: GenerateOptions,
    out_dir: Path,
    *,
    progress: Callable[[GeneratedDoc], None] | None = None,
) -> dict:
    """Generate the given indices into ``out_dir`` and write ``manifest.json``.

    Returns the manifest.
    """
    docs_meta = []
    for i in indices:
        doc = generate_document(i, opts)
        write_document(doc, out_dir)
        g = doc.golden
        docs_meta.append(
            {
                "id": doc.id,
                "file": doc.pdf_name,
                "golden": doc.golden_name,
                "template": doc.template,
                "pages": doc.page_count,
                "roles": [p["role"] for p in g["pages"]],
                "scanned": doc.scanned,
                "handwritten_fields": g["generator"]["handwritten_fields"],
                "fields_present": sum(1 for v in g["fields"].values() if v is not None),
                "tests": len(g["tests"]),
                "sha256": g["sha256"],
            }
        )
        if progress:
            progress(doc)
    manifest = {
        "manifest_version": 1,
        "generator_version": __version__,
        "seed": opts.seed,
        "scan_ratio": opts.scan_ratio,
        "handwriting_ratio": opts.handwriting_ratio,
        "dpi": opts.dpi,
        "templates": list(opts.templates),
        "count": len(docs_meta),
        "documents": docs_meta,
    }
    with open(out_dir / MANIFEST_NAME, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return manifest
