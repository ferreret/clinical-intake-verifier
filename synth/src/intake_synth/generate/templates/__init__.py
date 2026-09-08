"""Page layouts.

``TEMPLATES`` render the main request form (``render(rec, data, rng)``, possibly over several
pages). ``SHEETS`` render companion sheets (``render(rec, data, rng, total_pages)``) that
accompany the request in a multipage scan.
"""

from __future__ import annotations

import random
from collections.abc import Callable

from ..model import DocData
from ..recorder import Recorder
from . import hospital_compact, insurer_form, lab_classic
from .sheets import SHEETS

Template = Callable[[Recorder, DocData, random.Random], None]

TEMPLATES: dict[str, Template] = {
    "lab-classic": lab_classic.render,
    "insurer-form": insurer_form.render,
    "hospital-compact": hospital_compact.render,
}

# Fields that a template may hand-write when the document carries handwriting.
HANDWRITING_CANDIDATES: dict[str, tuple[str, ...]] = {
    "lab-classic": ("Telefono", "NumeroAutorizacion", "Edad", "NumeroTarjeta"),
    "insurer-form": (
        "Telefono",
        "NumeroAutorizacion",
        "NumeroColegiado",
        "FechaNacimiento",
        "Edad",
        "NumeroSolicitudMutua",
    ),
    "hospital-compact": ("Telefono", "NumeroAutorizacion"),
}

__all__ = ["HANDWRITING_CANDIDATES", "SHEETS", "TEMPLATES", "Template"]
