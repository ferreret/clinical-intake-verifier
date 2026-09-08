"""Layout helpers shared by the templates."""

from __future__ import annotations

from reportlab.lib import colors

from ..recorder import GREY, Recorder

SECTION_COLOR = colors.HexColor("#1F4E79")
CELL_BORDER = colors.HexColor("#9E9E9E")

DISCLAIMER = "Documento sintético generado para pruebas. No corresponde a ningún paciente real."


def section(
    rec: Recorder,
    x: float,
    y: float,
    w: float,
    title: str,
    *,
    color: colors.Color = SECTION_COLOR,
    size: float = 9,
    rule: bool = True,
) -> float:
    """Bold uppercase heading with a rule; returns the baseline y for the first row below."""
    rec.text(x, y, title, font="Helvetica-Bold", size=size, color=color)
    if rule:
        rec.line(x, y + 4, x + w, y + 4, width=0.8, color=color)
    return y + 20


def kv(
    rec: Recorder,
    x: float,
    y: float,
    label: str,
    field: str,
    printed: str | None,
    value: str | None = None,
    *,
    label_w: float = 90,
    size: float = 10,
    label_size: float = 8,
    value_font: str = "Helvetica",
    primary: bool = True,
) -> None:
    """Label followed by a recorded value. Absent values leave the slot blank, like a real form."""
    rec.text(x, y, label, font="Helvetica-Bold", size=label_size, color=GREY)
    rec.field_text(
        x + label_w, y, field, printed, value, size=size, font=value_font, primary=primary
    )


def cell(
    rec: Recorder,
    x: float,
    y: float,
    w: float,
    h: float,
    label: str,
    field: str | None = None,
    printed: str | None = None,
    value: str | None = None,
    *,
    size: float = 10,
    border: colors.Color = CELL_BORDER,
) -> None:
    """Form cell: border, small label at the top, value at the bottom."""
    rec.rect(x, y, w, h, stroke=border, width=0.5)
    rec.text(x + 4, y + 9, label, size=6.2, color=GREY)
    if printed is None:
        return
    if field is not None:
        rec.field_text(x + 5, y + h - 7, field, printed, value, size=size)
    else:
        rec.text(x + 5, y + h - 7, printed, size=size)


def disclaimer(rec: Recorder) -> None:
    rec.text(rec.W / 2, rec.H - 22, DISCLAIMER, size=6.5, color=GREY, align="center")
