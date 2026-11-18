"""A first plan per document from what the extractor read: its boxes for the personal fields.

The extractor gives one box per field (the golden of a synthetic document also lists the other
places a value is printed, ``also_at``). Everything else a person must add in the review: other
occurrences, signatures, stamps, labels, photos of cards.
"""

from __future__ import annotations

import json
from pathlib import Path

from .identity import make_identity
from .plan import PERSONAL_FIELDS, Box, Plan, load_plan, save_plan


def documents(docs_dir: Path) -> list[Path]:
    return sorted(p for p in docs_dir.glob("*.pdf") if p.is_file())


def reading_for(doc: str, readings: Path | None) -> dict | None:
    """The prediction (``<doc>.pred.json``) or golden (``<doc>.json``) for ``doc``, if any."""
    if readings is None:
        return None
    for name in (f"{doc}.pred.json", f"{doc.lower()}.pred.json", f"{doc}.json"):
        p = readings / name
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    return None


def _box(field: str, page: int, bbox: dict) -> Box | None:
    try:
        box = Box(page, bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"], field, source="extractor")
        box.validate()
        return box
    except (KeyError, TypeError, ValueError):
        return None


def new_plan(doc: str, pdf_name: str, reading: dict | None) -> Plan:
    fields = (reading or {}).get("fields") or {}
    originals = {k: (v or {}).get("value") for k, v in fields.items() if isinstance(v, dict)}
    plan = Plan(doc=doc, pdf=pdf_name, identity=make_identity(doc, originals))
    for name in PERSONAL_FIELDS:
        f = fields.get(name)
        if not isinstance(f, dict) or not f.get("value"):
            continue
        places = [(f.get("page"), f.get("bbox"))] + [
            (a.get("page"), a.get("bbox")) for a in f.get("also_at") or [] if isinstance(a, dict)
        ]
        for page, bbox in places:
            if isinstance(page, int) and isinstance(bbox, dict) and (box := _box(name, page, bbox)):
                plan.boxes.append(box)
    return plan


def propose(docs_dir: Path, work: Path, readings: Path | None, overwrite: bool = False) -> dict:
    """Writes a plan for every document without one (or every one, with ``overwrite``)."""
    made = kept = 0
    for pdf in documents(docs_dir):
        doc = pdf.stem
        existing = load_plan(work, doc)
        if existing is not None and not overwrite:
            kept += 1
            continue
        save_plan(work, new_plan(doc, pdf.name, reading_for(doc, readings)))
        made += 1
    return {"made": made, "kept": kept}
