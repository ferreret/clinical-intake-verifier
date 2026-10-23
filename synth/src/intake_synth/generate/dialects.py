"""How each insurer writes the lab's tests on its forms.

Every insurer has a style (abbreviations or full names, how it writes the specimen, capitals,
truncated words) and, within that style, its own pick of names for each test. It also has its
own name and composition for each profile, so the same profile name can mean different codes
for different insurers. Documents without an insurer use a generic dialect close to the lab's
own names.

Dialects depend on the dataset seed: another seed gives other insurers' habits, so nothing
downstream can be tuned to one set of wordings.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass
from functools import cache

from reportlab.pdfbase.pdfmetrics import stringWidth

from ..evaluate.compare import compare_key
from . import catalog
from .labcatalog import SPECIMENS, Catalog, LabTest, build_catalog

GENERIC = ""  # dialect key for documents without an insurer

# Widest a printed test name may be, in Helvetica 9 pt: the narrowest test column of any
# template (two columns of the lab form) less its checkbox.
MAX_WIDTH_PT = 225.0

# Names each issuer may give a profile, besides the lab's canonical one.
PROFILE_NAMES: dict[str, tuple[str, ...]] = {
    "PF01": ("Función hepática", "Pruebas hepáticas", "Perfil hepático básico", "P. hepático"),
    "PF02": ("Lípidos", "Perfil de lípidos", "Estudio lipídico", "P. lipídico"),
    "PF03": ("Función renal", "Pruebas renales", "P. renal", "Perfil renal básico"),
    "PF04": ("Función tiroidea", "Estudio tiroideo", "P. tiroideo", "Tiroides"),
    "PF05": ("Coagulación", "Coagulación básica", "Pruebas de coagulación", "Hemostasia"),
    "PF06": ("Perfil de anemia", "Perfil férrico", "Metabolismo del hierro", "Anemia"),
    "PF07": ("Ionograma", "Electrolitos", "Na, K, Cl", "Iones Na, K, Cl"),
    "PF08": ("Hormonas femeninas", "Estudio hormonal", "P. hormonal", "Perfil ginecológico"),
    "PF09": ("Inmunoglobulinas", "IgA, IgG, IgM", "Ig A, G, M", "Inmunoglobulinas séricas"),
    "PF10": ("C3 y C4", "Complemento", "C3, C4", "Complemento sérico"),
    "PF11": ("Celiaquía", "Estudio de celiaquía", "Despistaje celíaco", "Serología celíaca"),
    "PF12": ("Hepatitis B", "Marcadores VHB", "Serología VHB", "Marcadores hepatitis B"),
}

# Tests an insurer may add to a profile of its own, by profile: analyte names.
PROFILE_EXTRAS: dict[str, tuple[str, ...]] = {
    "PF01": ("Bilirrubina directa", "LDH", "Albúmina", "Proteínas totales"),
    "PF02": ("Colesterol no HDL", "Apolipoproteína B", "Lipoproteína (a)"),
    "PF03": ("Sodio", "Potasio", "Filtrado glomerular estimado"),
    "PF04": ("T3 libre", "Anticuerpos anti-TPO"),
    "PF05": ("Dímero D", "Tiempo de trombina"),
    "PF06": ("Índice de saturación de transferrina", "Recuento de reticulocitos"),
    "PF07": ("Calcio", "Magnesio", "Bicarbonato"),
    "PF08": ("Testosterona total", "Hormona antimülleriana", "TSH"),
    "PF09": ("IgE total",),
    "PF10": ("Complemento total (CH50)",),
    "PF11": ("Antigliadina deamidada IgG", "Antiendomisio IgA"),
    "PF12": ("Hepatitis B anti-HBc IgM", "Hepatitis C anti-VHC"),
}


@dataclass(frozen=True)
class Style:
    """An issuer's writing habits. Probabilities apply per test, so habits are not rules."""

    short_names: float  # prefers the shortest name over the canonical one
    omit_default_specimen: float  # leaves out the usual specimen ("Glucosa" for serum)
    specimen_form: str  # "en" | "paren" | "comma" | "prefix"
    truncate: float  # cuts a long word short ("Colest. total")
    upper: bool  # writes every test in capitals


@dataclass(frozen=True)
class IssuerProfile:
    id: str  # the lab profile it derives from
    name: str  # as this issuer prints it
    codes: tuple[str, ...]  # what it means for this issuer


@dataclass(frozen=True)
class Dialect:
    issuer: str
    style: Style
    names: dict[str, str]  # code -> printed name
    profiles: dict[str, IssuerProfile]  # lab profile id -> this issuer's version

    def name(self, code: str) -> str:
        return self.names[code]


def _fits(name: str) -> bool:
    return stringWidth(name, "Helvetica", 9) <= MAX_WIDTH_PT


def _truncate(name: str, rng: random.Random, p: float) -> str:
    def cut(m: re.Match[str]) -> str:
        word = m.group(0)
        if len(word) < 9 or rng.random() >= p:
            return word
        return word[: rng.choice((4, 5, 6))] + "."

    return re.sub(r"[^\W\d_]+", cut, name)


def _with_specimen(name: str, t: LabTest, style: Style, rng: random.Random, force: bool) -> str:
    spec = SPECIMENS[t.specimen]
    if not spec.label:
        return name
    if not force and t.default_specimen and rng.random() < style.omit_default_specimen:
        return name
    form = style.specimen_form
    if form == "prefix" and spec.prefix is None:
        form = "paren"
    if form == "prefix":
        return f"{spec.prefix}{name}"
    if form == "paren":
        return f"{name} ({spec.short})"
    if form == "comma":
        return f"{name}, {spec.short}"
    return f"{name} en {spec.label}"


def _candidates(t: LabTest, style: Style, rng: random.Random, base: str):
    """Printed names for ``t`` in this style, the preferred one first."""
    variant = t.variant[rng.randrange(len(t.variant))] if t.variant else ""

    def compose(name: str, force_specimen: bool, truncate: bool) -> str:
        text = f"{name} {variant}" if variant else name
        text = _with_specimen(text, t, style, rng, force_specimen)
        if truncate:
            text = _truncate(text, rng, style.truncate)
        return text.upper() if style.upper else text

    yield compose(base, False, True)
    for name in sorted(t.names, key=len):
        yield compose(name, False, False)
        yield compose(name, True, False)
    yield compose(t.analyte, True, False)
    # Last resort, unique by construction: the lab's own name.
    yield t.name.upper() if style.upper else t.name
    spec = SPECIMENS[t.specimen].short
    text = f"{t.analyte} {t.variant[0]}" if t.variant else t.analyte
    for name in sorted(t.names, key=len)[:2]:
        text = f"{name} {t.variant[0]}" if t.variant else name
        text = _truncate(f"{text} ({spec})" if spec else text, rng, 1.0)
        yield text.upper() if style.upper else text


def _make_style(rng: random.Random, generic: bool) -> Style:
    if generic:
        return Style(0.2, 0.9, "paren", 0.0, False)
    return Style(
        short_names=rng.choice((0.15, 0.5, 0.85)),
        omit_default_specimen=rng.choice((0.6, 0.85, 0.97)),
        specimen_form=rng.choice(("en", "paren", "comma", "prefix")),
        truncate=rng.choice((0.0, 0.0, 0.25, 0.5)),
        upper=rng.random() < 0.3,
    )


def _build(issuer: str, seed: int, cat: Catalog) -> Dialect:
    rng = random.Random(f"dialect:{seed}:{issuer}")
    style = _make_style(rng, issuer == GENERIC)

    # One name per analyte, shared by its specimens and variants: a form is consistent.
    analyte_name: dict[str, str] = {}
    for t in cat.tests:
        if t.analyte not in analyte_name:
            if rng.random() < style.short_names:
                analyte_name[t.analyte] = rng.choice(sorted(t.names, key=len)[:2])
            elif rng.random() < 0.7:
                analyte_name[t.analyte] = t.names[0]
            else:
                analyte_name[t.analyte] = rng.choice(t.names)

    taken: set[str] = set()
    names: dict[str, str] = {}

    def claim(candidates, what: str) -> str:
        tried = []
        for c in candidates:
            key = compare_key(c, "casefold")
            if key not in taken and _fits(c):
                taken.add(key)
                return c
            tried.append(c)
        raise ValueError(f"dialect {issuer!r}: no free name for {what}; tried {tried}")

    # Common tests choose first, so the long tail yields when two names collide.
    common_codes = [c for c in cat.common if c in {t.code for t in cat.tests}]
    order = common_codes + [t.code for t in cat.tests if t.code not in set(common_codes)]
    for code in order:
        t = cat.by_code(code)
        names[code] = claim(_candidates(t, style, rng, analyte_name[t.analyte]), t.name)

    profiles: dict[str, IssuerProfile] = {}
    for p in cat.profiles:
        if issuer == GENERIC:
            pname, codes = p.names[0], p.components
        else:
            options = (p.names[0], *PROFILE_NAMES[p.id])
            pname = rng.choice(options)
            codes = list(p.components)
            if len(codes) > 3 and rng.random() < 0.35:
                codes.pop(rng.randrange(len(codes)))
            if rng.random() < 0.3:
                extra = cat.find(rng.choice(PROFILE_EXTRAS[p.id])).code
                if extra not in codes:
                    codes.append(extra)
            codes = tuple(codes)
        pname = pname.upper() if style.upper else pname
        canonical = p.names[0].upper() if style.upper else p.names[0]
        pname = claim([pname, canonical, f"{canonical} (perfil)"], p.id)
        profiles[p.id] = IssuerProfile(p.id, pname, tuple(codes))
    return Dialect(issuer, style, names, profiles)


@cache
def dialects(seed: int) -> dict[str, Dialect]:
    """Every issuer's dialect for this dataset seed, keyed by insurer name or ``GENERIC``."""
    cat = build_catalog()
    return {issuer: _build(issuer, seed, cat) for issuer in (GENERIC, *catalog.INSURERS)}
