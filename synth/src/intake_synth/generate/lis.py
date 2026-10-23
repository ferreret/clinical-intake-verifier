"""The mock LIS: the lab's own records of patients, physicians and insurers.

Generated once per dataset seed, independent of the documents, so ``generate_document(i)``
stays reproducible on its own. Documents then draw their patient and physician from it, and
each document is given a scenario that says how what it prints relates to these records:
the same, a value that changed since, a typo on the form, a patient the lab has never seen,
or a patient with a namesake in the records. The scenario goes into the golden, so the
fusion engine's traffic light can be scored against it.

Every person and insurer here is invented (CLAUDE.md hard rules 2 and 4).
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date
from functools import cache

from faker import Faker

from . import catalog

LIS_VERSION = 1

N_PATIENTS = 400
N_HOMONYM_PAIRS = 15  # pairs of patients with the same name and surnames
N_PHYSICIANS = 60

DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"

# Per document: how what it prints relates to the records.
SCENARIOS: dict[str, float] = {
    "match": 0.45,  # the patient is in the LIS and every value agrees
    "drift": 0.15,  # in the LIS, but the phone changed since: the document is right
    "form_typo": 0.10,  # in the LIS, but the form has a typo: the LIS is right
    "new_patient": 0.20,  # never seen by the lab
    "homonym": 0.10,  # in the LIS, and another LIS patient has the same name
}
UNKNOWN_PHYSICIAN = 0.15  # share of documents whose physician the LIS does not know


@dataclass(frozen=True)
class LisPatient:
    id: str
    first_name: str
    last_name1: str
    last_name2: str
    sex: str  # "H" | "M"
    birth_date: date
    doc_id: str  # DNI or NIE, unformatted ("12345678Z")
    phone: str  # nine digits


@dataclass(frozen=True)
class LisPhysician:
    id: str
    first_name: str
    last_name1: str
    last_name2: str
    sex: str
    colegiado: str  # nine digits


@dataclass(frozen=True)
class LisInsurer:
    id: str
    name: str
    aliases: tuple[str, ...]  # other names the lab has it under


@dataclass(frozen=True)
class Population:
    seed: int
    patients: tuple[LisPatient, ...]
    physicians: tuple[LisPhysician, ...]
    insurers: tuple[LisInsurer, ...]
    homonyms: tuple[str, ...]  # ids of patients who share their full name with another
    unregistered_insurer: str  # an insurer the lab has no agreement with yet

    def insurer(self, name: str) -> LisInsurer | None:
        return next((i for i in self.insurers if i.name == name), None)

    def to_json(self) -> dict:
        return {
            "lis_version": LIS_VERSION,
            "seed": self.seed,
            "patients": [
                {
                    "id": p.id,
                    "first_name": p.first_name,
                    "last_name1": p.last_name1,
                    "last_name2": p.last_name2,
                    "sex": p.sex,
                    "birth_date": p.birth_date.strftime("%d/%m/%Y"),
                    "doc_id": p.doc_id,
                    "phone": p.phone,
                }
                for p in self.patients
            ],
            "physicians": [
                {
                    "id": m.id,
                    "first_name": m.first_name,
                    "last_name1": m.last_name1,
                    "last_name2": m.last_name2,
                    "sex": m.sex,
                    "colegiado": m.colegiado,
                }
                for m in self.physicians
            ],
            "insurers": [
                {"id": i.id, "name": i.name, "aliases": list(i.aliases)} for i in self.insurers
            ],
        }


# --------------------------------------------------------------------------- identifiers


def make_dni(rng: random.Random) -> str:
    n = rng.randint(10_000_000, 99_999_999)
    return f"{n}{DNI_LETTERS[n % 23]}"


def make_nie(rng: random.Random) -> str:
    prefix = rng.choice("XYZ")
    n = rng.randint(1_000_000, 9_999_999)
    numeric = int(f"{'XYZ'.index(prefix)}{n:07d}")
    return f"{prefix}{n:07d}{DNI_LETTERS[numeric % 23]}"


def make_phone_digits(rng: random.Random) -> str:
    return rng.choice("6667799") + "".join(str(rng.randint(0, 9)) for _ in range(8))


def make_colegiado_digits(rng: random.Random) -> str:
    prov = rng.choice(catalog.PROVINCE_CODES)
    return f"{prov}{prov}{rng.randint(1000, 99999):05d}"


def sample_birth_date(rng: random.Random, on: date) -> date:
    """A birth date for someone aged ``on`` that day, with a realistic age mix."""
    bucket = rng.random()
    if bucket < 0.10:
        age = rng.randint(1, 17)
    elif bucket < 0.70:
        age = rng.randint(18, 64)
    else:
        age = rng.randint(65, 94)
    # The day `age` years back, at most a year earlier, so the age that day is exact.
    try:
        anchor = on.replace(year=on.year - age)
    except ValueError:  # 29 Feb
        anchor = on.replace(year=on.year - age, day=28)
    return date.fromordinal(anchor.toordinal() - rng.randint(0, 364))


def new_patient(rng: random.Random, fake: Faker, pid: str, on: date) -> LisPatient:
    sex = rng.choice("HM")
    first = fake.first_name_male() if sex == "H" else fake.first_name_female()
    return LisPatient(
        id=pid,
        first_name=first,
        last_name1=fake.last_name(),
        last_name2=fake.last_name(),
        sex=sex,
        birth_date=sample_birth_date(rng, on),
        doc_id=make_nie(rng) if rng.random() < 0.10 else make_dni(rng),
        phone=make_phone_digits(rng),
    )


def new_physician(rng: random.Random, fake: Faker, mid: str) -> LisPhysician:
    sex = rng.choice("HM")
    first = fake.first_name_male() if sex == "H" else fake.first_name_female()
    return LisPhysician(
        mid, first, fake.last_name(), fake.last_name(), sex, make_colegiado_digits(rng)
    )


# --------------------------------------------------------------------------- population

REFERENCE_DATE = date(2026, 1, 1)


@cache
def population(seed: int) -> Population:
    """The LIS of a dataset. Depends on the seed only, never on which documents are made."""
    rng = random.Random(f"lis:{seed}")
    fake = Faker("es_ES")
    fake.seed_instance(rng.getrandbits(64))

    patients = [new_patient(rng, fake, f"P{k:05d}", REFERENCE_DATE) for k in range(N_PATIENTS)]
    homonyms: list[str] = []
    for k in rng.sample(range(N_PATIENTS), N_HOMONYM_PAIRS):
        twin = new_patient(rng, fake, f"P{len(patients):05d}", REFERENCE_DATE)
        base = patients[k]
        twin = LisPatient(
            twin.id,
            base.first_name,
            base.last_name1,
            base.last_name2,
            base.sex,
            twin.birth_date,
            twin.doc_id,
            twin.phone,
        )
        patients.append(twin)
        homonyms += [base.id, twin.id]

    physicians = [new_physician(rng, fake, f"M{k:04d}") for k in range(N_PHYSICIANS)]

    unregistered = rng.choice(catalog.INSURERS)
    insurers = []
    for k, name in enumerate(n for n in catalog.INSURERS if n != unregistered):
        # The lab often keeps an insurer under a shorter or capitalised name as well.
        aliases = (name.upper(), " ".join(name.split()[:2]))
        insurers.append(LisInsurer(f"A{k + 1:02d}", name, tuple(dict.fromkeys(aliases))))

    return Population(
        seed, tuple(patients), tuple(physicians), tuple(insurers), tuple(homonyms), unregistered
    )


# --------------------------------------------------------------------------- documents


@dataclass(frozen=True)
class Draw:
    """Who a document is about and how it relates to the LIS."""

    scenario: str
    patient: LisPatient  # the person the document is about, as they really are
    patient_id: str | None  # their LIS record, None for a new patient
    physician: LisPhysician
    physician_id: str | None
    differs: str | None = None  # the field where the document and the LIS disagree
    correct: str | None = None  # which one is right there: "document" | "lis"


def draw(rng: random.Random, fake: Faker, pop: Population, on: date) -> Draw:
    scenario = rng.choices(list(SCENARIOS), weights=list(SCENARIOS.values()), k=1)[0]

    if rng.random() < UNKNOWN_PHYSICIAN:
        physician, physician_id = new_physician(rng, fake, "M-new"), None
    else:
        physician = rng.choice(pop.physicians)
        physician_id = physician.id

    if scenario == "new_patient":
        patient = new_patient(rng, fake, "P-new", on)
        return Draw(scenario, patient, None, physician, physician_id)
    if scenario == "homonym":
        pid = rng.choice(pop.homonyms)
        patient = next(p for p in pop.patients if p.id == pid)
        return Draw(scenario, patient, patient.id, physician, physician_id)

    # Regular patients come back with a skewed frequency, as in a real practice.
    homonyms = set(pop.homonyms)
    regular = [p for p in pop.patients if p.id not in homonyms]
    weights = [1 / (k + 10) for k in range(len(regular))]
    patient = rng.choices(regular, weights=weights, k=1)[0]
    if scenario == "drift":
        return Draw(scenario, patient, patient.id, physician, physician_id, "Telefono", "document")
    if scenario == "form_typo":
        field = rng.choice(("DocumentoIdentidad", "FechaNacimiento"))
        return Draw(scenario, patient, patient.id, physician, physician_id, field, "lis")
    return Draw(scenario, patient, patient.id, physician, physician_id)


def typo_doc_id(rng: random.Random, raw: str) -> str:
    """One digit of a DNI or NIE written wrong; the letter is left, so it no longer checks."""
    positions = [i for i, c in enumerate(raw) if c.isdigit()]
    i = rng.choice(positions)
    wrong = rng.choice([d for d in "0123456789" if d != raw[i]])
    return raw[:i] + wrong + raw[i + 1 :]


def typo_birth_date(rng: random.Random, b: date) -> date:
    """A birth date with the day or the year written slightly wrong."""
    for _ in range(20):
        if rng.random() < 0.5:
            day = b.day + rng.choice((-2, -1, 1, 2))
            candidate = (b.year, b.month, day)
        else:
            candidate = (b.year + rng.choice((-10, -1, 1, 10)), b.month, b.day)
        try:
            wrong = date(*candidate)
        except ValueError:
            continue
        if wrong != b:
            return wrong
    raise ValueError(f"no typo found for {b}")
