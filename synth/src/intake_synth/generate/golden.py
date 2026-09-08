"""Build and validate the golden JSON from what the recorder actually drew."""

from __future__ import annotations

from ..schema import field_names, validate_golden
from .recorder import BBoxPt, Drawn


class GoldenError(RuntimeError):
    """The generator produced something the golden contract does not allow. Always a bug."""


def _norm(box: BBoxPt, page_size: tuple[float, float]) -> dict:
    w, h = page_size
    x0, y0, x1, y1 = box

    def clamp(v: float) -> float:
        return round(min(1.0, max(0.0, v)), 4)

    return {"x0": clamp(x0 / w), "y0": clamp(y0 / h), "x1": clamp(x1 / w), "y1": clamp(y1 / h)}


def build_golden(
    *,
    doc_id: str,
    file_name: str,
    sha256: str,
    generator: dict,
    pages: list[tuple[float, float]],
    items: list[Drawn],
    context: dict,
) -> dict:
    names = field_names()
    known = set(names)

    fields: dict[str, dict | None] = {}
    for d in items:
        if d.kind == "field" and d.name not in known:
            raise GoldenError(
                f"recorded unknown field {d.name!r}; add it to schema/fields.json first"
            )

    for name in names:
        drawn = [d for d in items if d.kind == "field" and d.name == name]
        if not drawn:
            fields[name] = None
            continue
        values = {d.value for d in drawn}
        if len(values) != 1:
            raise GoldenError(f"{name}: inconsistent values across occurrences {sorted(values)}")
        primaries = [d for d in drawn if d.primary] or drawn
        p = primaries[0]
        others = [d for d in drawn if d is not p]
        fields[name] = {
            "value": p.value,
            "printed": p.printed,
            "page": p.page,
            "bbox": _norm(p.box, pages[p.page - 1]),
            "style": p.style,
            "also_at": [{"page": o.page, "bbox": _norm(o.box, pages[o.page - 1])} for o in others],
        }

    tests = [
        {
            "value": d.value,
            "printed": d.printed,
            "page": d.page,
            "bbox": _norm(d.box, pages[d.page - 1]),
            "style": d.style,
        }
        for d in items
        if d.kind == "test"
    ]
    if len({t["value"] for t in tests}) != len(tests):
        raise GoldenError("duplicate test entries recorded")

    golden = {
        "golden_version": 1,
        "id": doc_id,
        "file": file_name,
        "sha256": sha256,
        "generator": generator,
        "pages": [
            {"number": i + 1, "width_pt": round(w, 2), "height_pt": round(h, 2)}
            for i, (w, h) in enumerate(pages)
        ],
        "fields": fields,
        "tests": tests,
        "context": context,
    }
    errors = validate_golden(golden)
    if errors:
        raise GoldenError("golden failed schema validation:\n  " + "\n  ".join(errors))
    return golden
