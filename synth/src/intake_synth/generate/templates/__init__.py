"""Page layouts. Each template is ``render(rec, data, rng)`` and draws one whole document."""

from __future__ import annotations

import random
from collections.abc import Callable

from ..model import DocData
from ..recorder import Recorder
from . import hospital_compact, insurer_form, lab_classic

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
