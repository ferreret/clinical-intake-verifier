"""Data model of one synthetic request, independent of how it is laid out on the page."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Center:
    name: str
    address: str
    phone: str
    kind: str  # "lab" | "clinic" | "hospital"


@dataclass(frozen=True)
class Patient:
    first_name: str
    last_name1: str
    last_name2: str
    sex: str  # "H" | "M"
    birth_date: date
    doc_id: str | None  # DNI/NIE as printed, None when absent from the document
    phone: str | None


@dataclass(frozen=True)
class Physician:
    name: str  # exactly as printed, honorific included when present
    full_name: str  # name and surnames without the honorific: the golden value
    colegiado: str | None
    signature: str  # decorative scribble text, never recorded


@dataclass(frozen=True)
class Insurance:
    name: str
    solicitud: str | None
    autorizacion: str | None
    tarjeta: str | None


@dataclass(frozen=True)
class RequestedItem:
    """One requested line, as printed. ``profile`` is the group heading it is printed under,
    if any; ``codes`` are the lab codes it means (several for a profile requested as one line).
    """

    name: str
    codes: tuple[str, ...]
    profile: str | None = None


@dataclass
class DocData:
    index: int
    lang: str  # "es" | "ca": the language the issuer prints in
    lis: dict  # how the document relates to the mock LIS (golden "lis")
    center: Center
    service: str
    issue_date: date
    request_number: str
    patient: Patient
    patient_printed_name: str
    birth_printed: str
    birth_value: str  # dd/mm/yyyy
    age_printed: str | None  # None: age not shown on the document
    show_sex: bool
    sex_printed: str  # textual representation used when not drawn as checkboxes
    physician: Physician
    insurance: Insurance | None
    items: list[RequestedItem]
    preprinted: tuple[str, ...]  # tests a pre-printed form may list, in this form's wording
    nhc: str  # hospital record number, a distractor
    observations: str | None
    diagnosis: str | None  # free-text reason, a distractor
    instructions: tuple[str, str, str]  # pre-printed patient instructions
    urgent: bool

    @property
    def tests(self) -> list[str]:
        return [i.name for i in self.items]

    @property
    def test_codes(self) -> dict[str, tuple[str, ...]]:
        return {i.name: i.codes for i in self.items}
