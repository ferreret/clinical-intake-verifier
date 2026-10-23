"""Build and validate the golden JSON from what the recorder actually drew."""

from __future__ import annotations

from ..schema import field_names, validate_golden
from .recorder import BBoxPt, Drawn, PageInfo


class GoldenError(RuntimeError):
    """The generator produced something the golden contract does not allow. Always a bug."""


def _norm(box: BBoxPt, page: PageInfo) -> dict:
    x0, y0, x1, y1 = box

    def clamp(v: float) -> float:
        return round(min(1.0, max(0.0, v)), 4)

    return {
        "x0": clamp(x0 / page.width),
        "y0": clamp(y0 / page.height),
        "x1": clamp(x1 / page.width),
        "y1": clamp(y1 / page.height),
    }


def _collapse(drawn: list[Drawn], pages: list[PageInfo], label: str) -> dict:
    """Several occurrences of one value -> primary entry plus ``also_at`` locations.

    The primary is the first occurrence flagged ``primary`` (the main form's body value),
    falling back to the first drawn. Order of ``also_at`` follows drawing order.
    """
    values = {d.value for d in drawn}
    if len(values) != 1:
        raise GoldenError(f"{label}: inconsistent values across occurrences {sorted(values)}")
    primaries = [d for d in drawn if d.primary] or drawn
    p = primaries[0]
    others = [d for d in drawn if d is not p]
    return {
        "value": p.value,
        "printed": p.printed,
        "page": p.page,
        "bbox": _norm(p.box, pages[p.page - 1]),
        "style": p.style,
        "also_at": [
            {"page": o.page, "bbox": _norm(o.box, pages[o.page - 1]), "printed": o.printed}
            for o in others
        ],
    }


def build_golden(
    *,
    doc_id: str,
    file_name: str,
    sha256: str,
    generator: dict,
    pages: list[PageInfo],
    items: list[Drawn],
    test_codes: dict[str, tuple[str, ...]],
    lis: dict,
    context: dict,
) -> dict:
    names = field_names()
    known = set(names)
    for d in items:
        if d.kind == "field" and d.name not in known:
            raise GoldenError(
                f"recorded unknown field {d.name!r}; add it to schema/fields.json first"
            )

    fields: dict[str, dict | None] = {}
    for name in names:
        drawn = [d for d in items if d.kind == "field" and d.name == name]
        fields[name] = _collapse(drawn, pages, name) if drawn else None

    # Tests: one entry per distinct value, in order of first appearance.
    by_value: dict[str, list[Drawn]] = {}
    for d in items:
        if d.kind == "test":
            by_value.setdefault(d.value, []).append(d)
    tests = []
    for value, occurrences in by_value.items():
        if value not in test_codes:
            raise GoldenError(f"test {value!r} was drawn but is not a requested line")
        entry = _collapse(occurrences, pages, f"test {value!r}")
        entry["codes"] = list(test_codes[value])
        tests.append(entry)

    generator = dict(generator)
    generator["handwritten_fields"] = sorted(
        name for name, f in fields.items() if f is not None and f["style"] == "handwritten"
    )

    golden = {
        "golden_version": 3,
        "id": doc_id,
        "file": file_name,
        "sha256": sha256,
        "generator": generator,
        "pages": [
            {
                "number": i + 1,
                "width_pt": round(p.width, 2),
                "height_pt": round(p.height, 2),
                "role": p.role,
            }
            for i, p in enumerate(pages)
        ],
        "fields": fields,
        "tests": tests,
        "lis": lis,
        "context": context,
    }
    errors = validate_golden(golden)
    if errors:
        raise GoldenError("golden failed schema validation:\n  " + "\n  ".join(errors))
    return golden
