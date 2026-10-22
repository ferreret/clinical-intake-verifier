"""Scoring one prediction against its golden: one outcome per field, a set match for tests,
and a localisation check for every box that comes with a correct value."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..schema import load_fields
from .compare import match_key, values_match

CORRECT = "correct"
WRONG = "wrong"
MISSED = "missed"
CORRECT_NULL = "correct_null"
INVENTED = "invented"
OUTCOMES = (CORRECT, WRONG, MISSED, CORRECT_NULL, INVENTED)

LOCATED = "located"
NOT_LOCATED = "not_located"  # on a right page, below the IoU threshold
WRONG_PAGE = "wrong_page"  # on a page where the value does not appear
NO_BOX = "no_box"
BOX_STATUSES = (LOCATED, NOT_LOCATED, WRONG_PAGE, NO_BOX)


@dataclass
class FieldResult:
    name: str
    outcome: str
    expected: str | None
    predicted: str | None
    style: str | None  # "printed" | "handwritten" from the golden, None when absent there
    box: str | None = None  # a BOX_STATUSES value, only for correct values
    iou: float | None = None


@dataclass
class TestMatch:
    expected: str
    predicted: str
    box: str
    iou: float | None


@dataclass
class TestsResult:
    matched: list[TestMatch] = field(default_factory=list)
    missed: list[str] = field(default_factory=list)
    extra: list[str] = field(default_factory=list)

    @property
    def exact(self) -> bool:
        return not self.missed and not self.extra


@dataclass
class DocResult:
    id: str
    template: str
    scanned: bool
    pages: int
    fields: list[FieldResult]
    tests: TestsResult


def iou(a: dict, b: dict) -> float:
    ix = max(0.0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    iy = max(0.0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    inter = ix * iy
    union = (
        (a["x1"] - a["x0"]) * (a["y1"] - a["y0"])
        + (b["x1"] - b["x0"]) * (b["y1"] - b["y0"])
        - inter
    )
    return inter / union if union > 0 else 0.0


def check_box(predicted: dict, golden: dict, threshold: float) -> tuple[str, float | None]:
    """Best IoU against the golden's primary location and every ``also_at`` on the same page."""
    if predicted.get("bbox") is None or predicted.get("page") is None:
        return NO_BOX, None
    locations = [(golden["page"], golden["bbox"])] + [
        (a["page"], a["bbox"]) for a in golden.get("also_at", [])
    ]
    on_page = [box for page, box in locations if page == predicted["page"]]
    if not on_page:
        return WRONG_PAGE, None
    best = max(iou(predicted["bbox"], box) for box in on_page)
    return (LOCATED if best >= threshold else NOT_LOCATED), best


def field_outcome(expected: str | None, predicted: str | None, mode: str) -> str:
    if expected is None:
        return CORRECT_NULL if predicted is None else INVENTED
    if predicted is None:
        return MISSED
    return CORRECT if values_match(expected, predicted, mode) else WRONG


def score_document(golden: dict, prediction: dict, threshold: float) -> DocResult:
    spec = load_fields()
    fields = []
    for f in spec["fields"]:
        g, p = golden["fields"][f["name"]], prediction["fields"][f["name"]]
        expected = g["value"] if g else None
        predicted = p["value"] if p else None
        result = FieldResult(
            f["name"],
            field_outcome(expected, predicted, f["compare"]),
            expected,
            predicted,
            g["style"] if g else None,
        )
        if result.outcome == CORRECT:
            result.box, result.iou = check_box(p, g, threshold)
        fields.append(result)

    mode = spec["tests"]["compare"]
    expected_tests = {match_key(t["value"], mode): t for t in golden["tests"]}
    predicted_tests: dict[str, dict] = {}
    for t in prediction["tests"]:
        predicted_tests.setdefault(match_key(t["value"], mode), t)
    tests = TestsResult()
    for key, g in expected_tests.items():
        p = predicted_tests.get(key)
        if p is None:
            tests.missed.append(g["value"])
        else:
            box, best = check_box(p, g, threshold)
            tests.matched.append(TestMatch(g["value"], p["value"], box, best))
    tests.extra = [t["value"] for key, t in predicted_tests.items() if key not in expected_tests]

    return DocResult(
        id=golden["id"],
        template=golden["generator"]["template"],
        scanned=golden["generator"]["scan"] is not None,
        pages=len(golden["pages"]),
        fields=fields,
        tests=tests,
    )
