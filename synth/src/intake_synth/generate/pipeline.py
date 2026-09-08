"""End-to-end generation of one document or a batch.

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
from .templates import HANDWRITING_CANDIDATES, TEMPLATES

MANIFEST_NAME = "manifest.json"


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
    if rng.random() >= ratio:
        return HandwritingPlan()
    candidates = _present_candidates(data, template)
    if not candidates:
        return HandwritingPlan()
    k = rng.randint(1, min(3, len(candidates)))
    chosen = frozenset(rng.sample(candidates, k))
    return HandwritingPlan(
        fields=chosen,
        font=rng.choice(["Caveat", "IndieFlower"]),
        ink=rng.choice(INK_COLORS),
        scale=rng.uniform(1.2, 1.45),
    )


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

    rec = Recorder(A4, rng, plan)
    TEMPLATES[template](rec, data, rng)
    pdf = rec.save()
    items = rec.items
    pages = rec.pages

    scan_public = None
    if scan_roll < opts.scan_ratio:
        params = sample_scan_params(rng, dpi=opts.dpi)
        pdf = scan_pdf(pdf, params, np_rng)
        items = [
            replace(
                d, box=transform_box_pt(d.box, pages[d.page - 1][0], pages[d.page - 1][1], params)
            )
            for d in items
        ]
        scan_public = params.public()

    handwritten = sorted(
        {d.name for d in items if d.kind == "field" and d.style == "handwritten" and d.name}
    )
    generator = {
        "version": __version__,
        "seed": opts.seed,
        "index": index,
        "template": template,
        "scan": scan_public,
        "handwritten_fields": handwritten,
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
    """Generate the given indices into ``out_dir`` and write ``manifest.json``. Returns the manifest."""
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
