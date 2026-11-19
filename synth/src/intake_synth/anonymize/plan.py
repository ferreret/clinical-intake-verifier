"""The anonymization plan of one document: regions to cover and what to write in each.

Stored as ``<work>/plans/<doc>.json``. Box coordinates are fractions of the page, origin at the
top left, as in the golden and the predictions. A box's ``kind`` is a field it replaces (its text
comes from the plan's fictitious ``identity`` unless ``text`` overrides it), ``Otro`` (any other
personal data: an address, an e-mail, a record number; ``text`` is written as given) or
``Tapar`` (covered, nothing written: signatures, stamps, labels, photos of cards).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

PLAN_VERSION = 1

#: Fields whose value identifies the patient or the physician, in the order shown to the reviewer.
PERSONAL_FIELDS = (
    "Paciente",
    "FechaNacimiento",
    "DocumentoIdentidad",
    "Telefono",
    "NumeroTarjeta",
    "NombreMedico",
    "NumeroColegiado",
    "NumeroPeticion",
    "NumeroSolicitudMutua",
    "NumeroAutorizacion",
)
OTHER = "Otro"
COVER = "Tapar"
KINDS = (*PERSONAL_FIELDS, OTHER, COVER)
STYLES = ("print", "hand")


@dataclass
class Box:
    page: int  # 1-based
    x0: float
    y0: float
    x1: float
    y1: float
    kind: str
    style: str = "print"
    text: str | None = None  # None: the identity's value for ``kind``
    source: str = "manual"  # "manual" | "extractor"

    def validate(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"unknown kind {self.kind!r}")
        if self.style not in STYLES:
            raise ValueError(f"unknown style {self.style!r}")
        if self.page < 1:
            raise ValueError("page numbers start at 1")
        if not (0 <= self.x0 < self.x1 <= 1 and 0 <= self.y0 < self.y1 <= 1):
            raise ValueError(f"box out of the page or empty: {self.x0, self.y0, self.x1, self.y1}")


@dataclass
class Plan:
    doc: str
    pdf: str
    identity: dict[str, str]
    boxes: list[Box] = field(default_factory=list)
    reviewed: bool = False
    notes: str = ""
    version: int = PLAN_VERSION

    def text_for(self, box: Box) -> str:
        """What is written in a box: its own text, else the identity's value for its kind."""
        if box.kind == COVER:
            return ""
        if box.text is not None:
            return box.text
        return self.identity.get(box.kind, "")

    def written(self) -> dict[str, str]:
        """What each kind's boxes write, the first box's text unless the boxes write a value in parts.

        A value printed in parts (surnames and name on lines of their own) gets a box per part,
        each with its part as text: when the parts hold the words of the identity's value, the
        value written is the identity's whole one, in whatever order the form asks for them.
        """
        texts: dict[str, list[str]] = {}
        for b in self.boxes:
            if b.kind != COVER:
                seen = texts.setdefault(b.kind, [])
                if (t := self.text_for(b)) not in seen:
                    seen.append(t)
        written = {}
        for kind, parts in texts.items():
            whole = self.identity.get(kind)
            pieces = [
                t for t in parts if t != whole
            ]  # the whole value may be written elsewhere too
            in_parts = (
                whole is not None
                and len(pieces) > 1
                and sorted(" ".join(pieces).split()) == sorted(whole.split())
            )
            written[kind] = whole if in_parts else parts[0]
        return written

    def validate(self, pages: int | None = None) -> None:
        if self.version != PLAN_VERSION:
            raise ValueError(f"plan version {self.version}, expected {PLAN_VERSION}")
        for b in self.boxes:
            b.validate()
            if pages is not None and b.page > pages:
                raise ValueError(f"box on page {b.page} of a {pages}-page document")

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict) -> Plan:
        boxes = [Box(**b) for b in data.get("boxes", [])]
        return cls(
            doc=data["doc"],
            pdf=data["pdf"],
            identity=dict(data.get("identity", {})),
            boxes=boxes,
            reviewed=bool(data.get("reviewed", False)),
            notes=str(data.get("notes", "")),
            version=int(data.get("version", PLAN_VERSION)),
        )


def plan_path(work: Path, doc: str) -> Path:
    return work / "plans" / f"{doc}.json"


def load_plan(work: Path, doc: str) -> Plan | None:
    p = plan_path(work, doc)
    if not p.exists():
        return None
    return Plan.from_json(json.loads(p.read_text(encoding="utf-8")))


def save_plan(work: Path, plan: Plan, pages: int | None = None) -> Path:
    plan.validate(pages)
    p = plan_path(work, plan.doc)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(plan.to_json(), ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)  # a crash never leaves half a plan
    return p
