"""Deterministic synthetic identities and request content.

All randomness flows through the ``random.Random`` and ``Faker`` instances handed in, which the
pipeline seeds per document, so any document can be regenerated in isolation.
"""

from __future__ import annotations

import random
from datetime import date, timedelta

from faker import Faker

from . import catalog
from .model import DocData, Insurance, Patient, Physician, RequestedItem

DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"


# --------------------------------------------------------------------------- identifiers


def make_dni(rng: random.Random) -> str:
    n = rng.randint(10_000_000, 99_999_999)
    return f"{n}{DNI_LETTERS[n % 23]}"


def make_nie(rng: random.Random) -> str:
    prefix = rng.choice("XYZ")
    n = rng.randint(1_000_000, 9_999_999)
    numeric = int(f"{'XYZ'.index(prefix)}{n:07d}")
    return f"{prefix}{n:07d}{DNI_LETTERS[numeric % 23]}"


def format_doc_id(rng: random.Random, raw: str) -> str:
    if raw[0] in "XYZ":
        return rng.choice([raw, f"{raw[:-1]}-{raw[-1]}"])
    return rng.choice(
        [raw, raw, f"{raw[:8]}-{raw[8]}", f"{raw[:2]}.{raw[2:5]}.{raw[5:8]}-{raw[8]}"]
    )


def make_phone(rng: random.Random) -> str:
    first = rng.choice("6667799")
    digits = first + "".join(str(rng.randint(0, 9)) for _ in range(8))
    grouped = f"{digits[:3]} {digits[3:6]} {digits[6:]}"
    return rng.choice(
        [digits, digits, grouped, f"+34 {grouped}", f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"]
    )


def make_colegiado(rng: random.Random) -> str:
    prov = rng.choice(catalog.PROVINCE_CODES)
    seq = rng.randint(1000, 99999)
    raw = f"{prov}{prov}{seq:05d}"
    return rng.choice([raw, raw, f"{prov}/{prov}/{seq:05d}", f"{prov}-{prov}{seq:05d}"])


def make_request_number(rng: random.Random, issue: date) -> str:
    kind = rng.random()
    if kind < 0.5:
        return f"{issue:%y%m%d}{rng.randint(0, 9999):04d}"
    if kind < 0.8:
        return f"P{rng.randint(10_000_000, 99_999_999)}"
    return f"{issue.year}/{rng.randint(1, 999_999):06d}"


def make_insurance(rng: random.Random, issue: date) -> Insurance:
    name = rng.choice(catalog.INSURERS)
    solicitud = None
    if rng.random() > 0.30:
        solicitud = rng.choice(
            [
                f"SOL-{issue.year}-{rng.randint(0, 9_999_999):07d}",
                f"{rng.randint(10**9, 10**10 - 1)}",
            ]
        )
    autorizacion = None
    if rng.random() > 0.35:
        autorizacion = rng.choice(
            [f"AUT{rng.randint(10_000_000, 99_999_999)}", f"{rng.randint(10**8, 10**9 - 1)}"]
        )
    tarjeta = None
    if rng.random() > 0.25:
        n = rng.randint(12, 16)
        digits = "".join(str(rng.randint(0, 9)) for _ in range(n))
        if n == 16 and rng.random() < 0.5:
            digits = " ".join(digits[i : i + 4] for i in range(0, 16, 4))
        tarjeta = digits
    return Insurance(name, solicitud, autorizacion, tarjeta)


# --------------------------------------------------------------------------- dates


def compute_age(birth: date, on: date) -> int:
    return on.year - birth.year - ((on.month, on.day) < (birth.month, birth.day))


def sample_birth_date(rng: random.Random, issue: date) -> date:
    bucket = rng.random()
    if bucket < 0.10:
        age = rng.randint(1, 17)
    elif bucket < 0.70:
        age = rng.randint(18, 64)
    else:
        age = rng.randint(65, 94)
    anchor_year = issue.year - age
    # Same calendar day `age` years back, then push back up to a year so the age is exact.
    try:
        anchor = issue.replace(year=anchor_year)
    except ValueError:  # 29 Feb
        anchor = issue.replace(year=anchor_year, day=28)
    return anchor - timedelta(days=rng.randint(0, 364))


def format_birth(rng: random.Random, b: date) -> str:
    choice = rng.choices(["slash", "dash", "dot", "iso", "mon"], weights=[5, 2, 1, 1, 1], k=1)[0]
    if choice == "slash":
        return b.strftime("%d/%m/%Y")
    if choice == "dash":
        return b.strftime("%d-%m-%Y")
    if choice == "dot":
        return b.strftime("%d.%m.%Y")
    if choice == "iso":
        return b.strftime("%Y-%m-%d")
    return f"{b.day:02d}-{catalog.MONTHS_ES[b.month - 1]}-{b.year}"


# --------------------------------------------------------------------------- tests


def sample_items(rng: random.Random) -> list[RequestedItem]:
    items: list[RequestedItem] = []
    seen: set[str] = set()

    def add(name: str, profile: str | None = None) -> None:
        if name not in seen:
            seen.add(name)
            items.append(RequestedItem(name, profile))

    roll = rng.random()
    if roll < 0.45:
        # One profile expanded: heading + components (adversarial for grouping).
        profile = rng.choice(list(catalog.PROFILES))
        for comp in catalog.PROFILES[profile]:
            add(comp, profile)
    elif roll < 0.60:
        # Profile requested as a single line item.
        add(rng.choice(list(catalog.PROFILES)))

    n_single = rng.choices([1, 2, 3, 4, 5, 6, 8], weights=[2, 4, 5, 4, 3, 2, 1], k=1)[0]
    pool = list(catalog.TESTS)
    rng.shuffle(pool)
    for name in pool[:n_single]:
        add(name)

    # Keep within what every template can lay out on one page.
    return items[:14]


# --------------------------------------------------------------------------- document


def make_doc_data(
    rng: random.Random,
    fake: Faker,
    index: int,
    *,
    template: str,
) -> DocData:
    issue = date(2026, 1, 1) + timedelta(days=rng.randint(0, 240))

    if template == "hospital-compact":
        centers = [c for c in catalog.CENTERS if c.kind == "hospital"]
    else:
        centers = [c for c in catalog.CENTERS if c.kind != "hospital"]
    center = rng.choice(centers)

    sex = rng.choice("HM")
    first = fake.first_name_male() if sex == "H" else fake.first_name_female()
    last1, last2 = fake.last_name(), fake.last_name()
    birth = sample_birth_date(rng, issue)
    raw_doc = make_nie(rng) if rng.random() < 0.10 else make_dni(rng)
    doc_id = None if rng.random() < 0.08 else format_doc_id(rng, raw_doc)
    phone = None if rng.random() < 0.25 else make_phone(rng)
    patient = Patient(first, last1, last2, sex, birth, doc_id, phone)

    name_style = rng.random()
    if name_style < 0.45:
        printed_name = f"{first} {last1} {last2}"
    elif name_style < 0.80:
        printed_name = f"{last1} {last2}, {first}".upper()
    else:
        printed_name = f"{last1} {last2}, {first}"

    age = compute_age(birth, issue)
    age_printed = None
    if rng.random() > 0.35:
        age_printed = rng.choice([str(age), str(age), f"{age} años", f"{age} a."])

    pair = rng.choice(catalog.SEX_LABEL_PAIRS)
    sex_printed = pair[0] if sex == "H" else pair[1]

    doc_sex = rng.choice("HM")
    doc_first = fake.first_name_male() if doc_sex == "H" else fake.first_name_female()
    doc_last1, doc_last2 = fake.last_name(), fake.last_name()
    honorific = (
        rng.choice(["Dr. ", "Dra. ", "", ""])
        if doc_sex == "H"
        else rng.choice(["Dra. ", "Dra. ", "", ""])
    )
    if honorific == "Dr. " and doc_sex == "M":
        honorific = "Dra. "
    physician = Physician(
        name=f"{honorific}{doc_first} {doc_last1} {doc_last2}",
        colegiado=None if rng.random() < 0.15 else make_colegiado(rng),
        signature=f"{doc_first[0]}. {doc_last1}",
    )

    needs_insurance = template == "insurer-form"
    if needs_insurance or rng.random() > (0.55 if template == "hospital-compact" else 0.25):
        insurance = make_insurance(rng, issue)
    else:
        insurance = None

    return DocData(
        index=index,
        center=center,
        service=rng.choice(catalog.SERVICES),
        issue_date=issue,
        request_number=make_request_number(rng, issue),
        patient=patient,
        patient_printed_name=printed_name,
        birth_printed=format_birth(rng, birth),
        birth_value=birth.strftime("%d/%m/%Y"),
        age_printed=age_printed,
        show_sex=rng.random() > 0.12,
        sex_printed=sex_printed,
        physician=physician,
        insurance=insurance,
        items=sample_items(rng),
        nhc=f"{rng.randint(1, 9_999_999):07d}",
        observations=rng.choice(catalog.OBSERVATIONS) if rng.random() < 0.30 else None,
        diagnosis=rng.choice(catalog.DIAGNOSES) if rng.random() < 0.70 else None,
        instructions=rng.choice(catalog.INSTRUCTIONS),
        urgent=rng.random() < 0.15,
    )
