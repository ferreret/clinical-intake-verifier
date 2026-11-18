"""Fictitious values for one document, in the format of the values they replace.

Drawn from a generator seeded with the document's name, so the same document always gets the
same identity. Where the original value is known (read by the extractor), the replacement keeps
its shape: a DNI written with a hyphen gets a valid DNI with a hyphen, a name written as
"SURNAME SURNAME, NAME" in capitals gets one written the same way, a date keeps its separators
and stays within half a year of the original, so the patient's age, which tests depend on, barely
moves. Digits of reference numbers are replaced and their letters kept.
"""

from __future__ import annotations

import random
import re
import unicodedata
from datetime import date, timedelta

from faker import Faker

from ..generate.lis import DNI_LETTERS, make_colegiado_digits, make_phone_digits

_DATE_NUMERIC = re.compile(r"^\s*(\d{1,2})([/\-. ])(\d{1,2})\2(\d{4}|\d{2})\s*$")
_DATE_WORDS = re.compile(
    r"^\s*(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)\s+(?:de|del)\s+(\d{4})\s*$", re.IGNORECASE
)
_MONTHS = {
    "es": "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre",
    "ca": "gener febrer març abril maig juny juliol agost setembre octubre novembre desembre",
}
_HONORIFIC = re.compile(r"^\s*((?:Dra?|DRA?|dra?)\.?\s+)")


def _fold(name: str) -> str:
    """Upper case without accents, so "JOSÉ", "Jose" and "josé" compare equal."""
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()


def _faker(rng: random.Random) -> Faker:
    fake = Faker("es_ES")
    fake.seed_instance(rng.getrandbits(64))
    return fake


def _case_like(text: str, model: str | None) -> str:
    if not model:
        return text.upper()
    letters = [c for c in model if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        return text.upper()
    if letters and all(c.islower() for c in letters):
        return text.lower()
    return text.title()


def guess_sex(fake: Faker, name: str | None) -> str | None:
    """H or M from a first name found in Faker's Spanish lists, else None."""
    if not name:
        return None
    first = name.split(",")[-1].strip().split() if "," in name else name.strip().split()
    if not first:
        return None
    token = _fold(first[0].strip("."))
    person = next(p for p in fake.providers if hasattr(p, "first_names_male"))
    males = {_fold(n) for n in person.first_names_male}
    females = {_fold(n) for n in person.first_names_female}
    if token in males and token not in females:
        return "H"
    if token in females and token not in males:
        return "M"
    return None


def person_name(rng: random.Random, fake: Faker, sex: str | None, original: str | None) -> str:
    """A fictitious full name written the way ``original`` is (order, comma, case, honorific)."""
    sex = sex if sex in ("H", "M") else rng.choice("HM")
    first = fake.first_name_male() if sex == "H" else fake.first_name_female()
    first = first.split()[0]  # one given name, as most forms print
    surnames = [fake.last_name(), fake.last_name()]
    honorific = ""
    body = original or ""
    if m := _HONORIFIC.match(body):
        honorific, body = m.group(1), body[m.end() :]
    if "," in body:
        n_surnames = max(1, min(2, len(body.split(",")[0].split())))
        text = f"{' '.join(surnames[:n_surnames])}, {first}"
    else:
        tokens = body.split()
        n_surnames = max(1, min(2, len(tokens) - 1)) if tokens else 2
        text = f"{first} {' '.join(surnames[:n_surnames])}"
    return honorific + _case_like(text, body or None)


def shifted_date(rng: random.Random, original: str | None) -> str:
    """A birth date within about half a year of ``original``, written like it."""
    shift = timedelta(days=rng.choice((-1, 1)) * rng.randint(20, 170))
    if original and (m := _DATE_NUMERIC.match(original)):
        d, sep, mo, y = m.groups()
        year = int(y) if len(y) == 4 else (1900 + int(y) if int(y) > 30 else 2000 + int(y))
        try:
            new = date(year, int(mo), int(d)) + shift
        except ValueError:
            new = None
        if new:
            yy = f"{new.year:04d}" if len(y) == 4 else f"{new.year % 100:02d}"
            dd = f"{new.day:0{len(d)}d}" if len(d) == 2 else str(new.day)
            mm = f"{new.month:0{len(mo)}d}" if len(mo) == 2 else str(new.month)
            return f"{dd}{sep}{mm}{sep}{yy}"
    if original and (m := _DATE_WORDS.match(original)):
        d, month, y = m.groups()
        for names in _MONTHS.values():
            months = names.split()
            if month.lower() in months:
                try:
                    new = date(int(y), months.index(month.lower()) + 1, int(d)) + shift
                except ValueError:
                    break
                word = months[new.month - 1]
                word = word.capitalize() if month[0].isupper() else word
                joiner = " de "
                return f"{new.day}{joiner}{word}{joiner}{new.year}"
    born = date(2026, 1, 1) - timedelta(days=rng.randint(18 * 365, 85 * 365))
    return f"{born:%d/%m/%Y}"


def _reshape(original: str, raw: str) -> str:
    """``raw``'s characters laid into ``original``'s alphanumeric positions, separators kept."""
    out, it = [], iter(raw)
    for c in original:
        out.append(next(it, c) if c.isalnum() else c)
    return "".join(out)


def doc_id(rng: random.Random, original: str | None) -> str:
    """A valid DNI or NIE (as the original was), formatted like it."""
    raw = re.sub(r"[^0-9A-Za-z]", "", original or "").upper()
    if re.fullmatch(r"[XYZ]\d{7}[A-Z]", raw):
        prefix = raw[0]
        n = rng.randint(0, 9_999_999)
        numeric = int(f"{'XYZ'.index(prefix)}{n:07d}")
        new = f"{prefix}{n:07d}{DNI_LETTERS[numeric % 23]}"
    elif re.fullmatch(r"\d{8}", raw):  # written without its letter
        new = f"{rng.randint(10_000_000, 99_999_999)}"
    else:
        n = rng.randint(10_000_000, 99_999_999)
        new = f"{n}{DNI_LETTERS[n % 23]}"
        if not re.fullmatch(r"\d{8}[A-Z]", raw):
            return new
    shaped = _reshape(original or new, new)
    return shaped.lower() if original and original.islower() else shaped


def digits_like(
    rng: random.Random, original: str | None, keep_first: int = 0, fallback_len: int = 8
) -> str:
    """``original`` with its digits replaced (the first ``keep_first`` kept), letters and separators kept."""
    if not original or not any(c.isdigit() for c in original):
        n = "".join(str(rng.randint(0, 9)) for _ in range(fallback_len))
        return str(rng.randint(1, 9)) + n[1:]
    out, seen = [], 0
    for c in original:
        if c.isdigit():
            if seen < keep_first:
                out.append(c)
            elif seen == 0 and c != "0":
                out.append(str(rng.randint(1, 9)))
            else:
                out.append(str(rng.randint(0, 9)))
            seen += 1
        else:
            out.append(c)
    return "".join(out)


def make_identity(doc: str, original: dict[str, str | None] | None = None) -> dict[str, str]:
    """Fictitious values for every personal field of ``doc``, shaped like ``original``'s."""
    original = original or {}
    rng = random.Random(f"anon:{doc}")
    fake = _faker(rng)
    patient_sex = original.get("Sexo") if original.get("Sexo") in ("H", "M") else None
    patient_sex = patient_sex or guess_sex(fake, original.get("Paciente"))
    phone = original.get("Telefono")
    return {
        "Paciente": person_name(rng, fake, patient_sex, original.get("Paciente")),
        "FechaNacimiento": shifted_date(rng, original.get("FechaNacimiento")),
        "DocumentoIdentidad": doc_id(rng, original.get("DocumentoIdentidad")),
        "Telefono": digits_like(rng, phone, keep_first=1) if phone else make_phone_digits(rng),
        "NumeroTarjeta": digits_like(rng, original.get("NumeroTarjeta"), fallback_len=16),
        "NombreMedico": person_name(
            rng, fake, guess_sex(fake, original.get("NombreMedico")), original.get("NombreMedico")
        ),
        "NumeroColegiado": digits_like(rng, original.get("NumeroColegiado"))
        if original.get("NumeroColegiado")
        else make_colegiado_digits(rng),
        "NumeroPeticion": digits_like(rng, original.get("NumeroPeticion"), keep_first=0),
        "NumeroSolicitudMutua": digits_like(rng, original.get("NumeroSolicitudMutua")),
        "NumeroAutorizacion": digits_like(rng, original.get("NumeroAutorizacion")),
    }
