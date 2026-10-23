"""The compare modes of ``schema/fields.json``.

Mirrored in ``web/src/lib/schema/compare.ts``; both run the cases in
``schema/compare-cases.json``, so a change here needs the same change there.
"""

from __future__ import annotations

import re
import unicodedata

_WHITESPACE = re.compile(r"\s+")
_NOT_DIGIT = re.compile(r"[^0-9]")
_NOT_ALNUM = re.compile(r"[^0-9A-Z]")


def _casefold(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    unmarked = "".join(c for c in decomposed if not unicodedata.category(c).startswith("M"))
    # lower(), not casefold(): JavaScript has no casefold, and the two sides must agree.
    return _WHITESPACE.sub(" ", unmarked.lower()).strip()


def _phone(value: str) -> str:
    # Forms add the country prefix; the LIS keeps the national number.
    d = _NOT_DIGIT.sub("", value)
    if len(d) == 13 and d.startswith("0034"):
        return d[4:]
    if len(d) == 11 and d.startswith("34"):
        return d[2:]
    return d


def _person_name(value: str) -> str:
    # "SURNAMES, NAME" and "Name Surnames" are the same person.
    return " ".join(sorted(_casefold(value.replace(",", " ")).split()))


_KEYS = {
    "exact": str.strip,
    "casefold": _casefold,
    "digits": lambda v: _NOT_DIGIT.sub("", v),
    "alnum_upper": lambda v: _NOT_ALNUM.sub("", v.upper()),
    "phone": _phone,
    "person_name": _person_name,
}

MODES = frozenset(_KEYS)


def compare_key(value: str, mode: str) -> str:
    """The form of ``value`` that two values are compared on under ``mode``."""
    try:
        return _KEYS[mode](value)
    except KeyError:
        raise ValueError(f"unknown compare mode {mode!r}") from None


def values_match(a: str, b: str, mode: str) -> bool:
    """Whether two non-null values match under ``mode``.

    A value that normalises to nothing (no digits under ``digits``, say) only matches one that
    is identical after trimming: otherwise "sí" and "no" would be equal as digit sequences.
    """
    ka, kb = compare_key(a, mode), compare_key(b, mode)
    if ka == "" or kb == "":
        return a.strip() == b.strip()
    return ka == kb


def match_key(value: str, mode: str) -> str:
    """A hashable key with ``values_match(a, b) == (match_key(a) == match_key(b))``.

    Used to match lists as sets. Keys that normalise to nothing fall back to the trimmed value,
    behind a prefix no normalised key can produce.
    """
    key = compare_key(value, mode)
    return key if key else "\0" + value.strip()
