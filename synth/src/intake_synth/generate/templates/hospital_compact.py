"""Template ``hospital-compact``: monochrome, dense hospital request. A patient sticker with
a record number (NHC) and its own Code39 barcode acts as a distractor next to the real
request number barcode. Tests are a plain multi-column list that continues on the next page
when needed.
"""

from __future__ import annotations

import math
import random

from reportlab.lib import colors

from ..model import DocData
from ..recorder import BLACK, GREY, Recorder
from .common import disclaimer

MARGIN = 34
ROW_H = 14
NOTES_TOP = 150  # distance from the page bottom to the notes block heading
SAMPLE_TYPES = ("Suero", "Sangre EDTA", "Plasma citrato", "Orina", "Heces", "Sangre total")


def _label(rec: Recorder, x: float, y: float, s: str, font: str) -> float:
    b = rec.text(x, y, s, font=font, size=8.5, color=GREY)
    return b[2] + 4


def _continuation_header(rec: Recorder, d: DocData, body_font: str, body_bold: str) -> float:
    W, m = rec.W, MARGIN
    rec.text(W - m, m + 12, d.center.name, font="Helvetica-Bold", size=11, align="right")
    rec.text(W - m, m + 24, "continuación", size=8, color=GREY, align="right")
    x = _label(rec, m, m + 12, "Petición:", body_font)
    rec.field_text(
        x,
        m + 12,
        "NumeroPeticion",
        d.request_number,
        size=10,
        font=body_bold,
        primary=False,
        hand_ok=False,
    )
    x = _label(rec, m, m + 30, "Paciente:", body_font)
    rec.field_text(
        x,
        m + 30,
        "Paciente",
        d.patient_printed_name,
        size=10,
        font=body_bold,
        primary=False,
        hand_ok=False,
    )
    rec.line(m, m + 42, W - m, m + 42, width=0.8)
    y = m + 66
    rec.text(m, y, "PRUEBAS SOLICITADAS (continuación)", font="Helvetica-Bold", size=9)
    rec.line(m, y + 4, W - m, y + 4, width=0.8)
    return y + 20


def render(rec: Recorder, d: DocData, rng: random.Random) -> None:
    W, H = rec.W, rec.H
    m = MARGIN
    mono = rng.random() < 0.4
    body_font = "Courier" if mono else "Helvetica"
    body_bold = "Courier-Bold" if mono else "Helvetica-Bold"

    def label(x: float, yy: float, s: str) -> float:
        return _label(rec, x, yy, s, body_font)

    # ---- patient sticker (top-left)
    sx, sy, sw, sh = m, m, 250, 92
    rec.rect(sx, sy, sw, sh, stroke=BLACK, width=0.9)
    rec.text(sx + 6, sy + 12, f"NHC: {d.nhc}", font=body_bold, size=9)
    rec.text(
        sx + sw - 6, sy + 12, f"{d.issue_date:%d/%m/%Y}", font=body_font, size=8, align="right"
    )
    rec.field_text(
        sx + 6, sy + 27, "Paciente", d.patient_printed_name, size=9.5, font=body_bold, hand_ok=False
    )
    rec.text(sx + 6, sy + 41, "DNI:", font=body_font, size=8, color=GREY)
    rec.field_text(sx + 30, sy + 41, "DocumentoIdentidad", d.patient.doc_id, size=9, font=body_font)
    rec.text(sx + 6, sy + 55, "F.Nac:", font=body_font, size=8, color=GREY)
    rec.field_text(
        sx + 38, sy + 55, "FechaNacimiento", d.birth_printed, d.birth_value, size=9, font=body_font
    )
    if d.show_sex:
        rec.text(sx + 140, sy + 55, "Sexo:", font=body_font, size=8, color=GREY)
        rec.field_text(
            sx + 168, sy + 55, "Sexo", d.sex_printed, d.patient.sex, size=9, font=body_font
        )
    rec.barcode39(sx + 6, sy + 64, d.nhc, height=18, bar_width=0.55)
    rec.text(sx + 6, sy + 89, d.nhc, font="Courier", size=6.5, color=GREY)

    # ---- centre and request barcode (top-right)
    rx = W - m
    rec.text(rx, m + 12, d.center.name, font="Helvetica-Bold", size=11, align="right")
    rec.text(rx, m + 24, d.center.address, size=7.5, color=GREY, align="right")
    rec.text(rx, m + 35, f"Servicio de {d.service}", size=8, align="right")
    bw = 0.9
    # Code128 width is not known before drawing; estimate to right-align the barcode.
    est_w = (len(d.request_number) * 11 + 35) * bw
    bx = rx - est_w
    rec.text(bx, m + 52, "PETICIÓN Nº", font="Helvetica-Bold", size=7, color=GREY)
    rec.barcode(
        bx,
        m + 56,
        d.request_number,
        height=30,
        bar_width=bw,
        field="NumeroPeticion",
        primary=False,
        text_font="Courier-Bold",
        text_size=9,
    )

    # ---- body lines
    y = sy + sh + 30
    rec.line(m, y - 16, W - m, y - 16, width=0.8)

    x = label(m, y, "Petición:")
    rec.field_text(x, y, "NumeroPeticion", d.request_number, size=10, font=body_bold, hand_ok=False)
    x = label(m + 220, y, "Fecha extracción:")
    rec.text(x, y, f"{d.issue_date:%d/%m/%Y}", font=body_font, size=9.5)
    x = label(m + 380, y, "Prioridad:")
    if d.urgent:
        rec.text(x, y, "URGENTE", font=body_bold, size=9.5, color=colors.HexColor("#B71C1C"))
    else:
        rec.text(x, y, "Normal", font=body_font, size=9.5)
    y += 18
    x = label(m, y, "Médico solicitante:")
    rec.field_text(x, y, "NombreMedico", d.physician.name, size=10, font=body_font)
    x = label(m + 330, y, "Nº Col.:")
    rec.field_text(x, y, "NumeroColegiado", d.physician.colegiado, size=10, font=body_font)
    y += 18
    x = label(m, y, "Teléfono contacto:")
    rec.field_text(x, y, "Telefono", d.patient.phone, size=10, font=body_font)
    if d.age_printed is not None and rng.random() < 0.75:
        x = label(m + 330, y, "Edad:")
        rec.field_text(x, y, "Edad", d.age_printed, size=10, font=body_font)
    if d.insurance is not None:
        ins = d.insurance
        y += 18
        x = label(m, y, "Financiador:")
        b = rec.field_text(x, y, "NombreMutua", ins.name, size=10, font=body_font)
        x = (b[2] if b else x) + 14
        if ins.autorizacion is not None:
            x = label(x, y, "Autorización:")
            b = rec.field_text(
                x, y, "NumeroAutorizacion", ins.autorizacion, size=10, font=body_font
            )
            x = (b[2] if b else x) + 14
        if ins.tarjeta is not None and x < W - m - 150:
            x = label(x, y, "Tarjeta:")
            rec.field_text(x, y, "NumeroTarjeta", ins.tarjeta, size=10, font=body_font)

    y += 18
    x = label(m, y, "Diagnóstico:")
    if d.diagnosis:
        rec.text(x, y, d.diagnosis, font=body_font, size=10)

    # ---- tests (multi-column, may continue on further pages)
    y += 34
    rec.text(m, y, "PRUEBAS SOLICITADAS", font="Helvetica-Bold", size=9)
    rec.line(m, y + 4, W - m, y + 4, width=0.8)
    y += 20
    names = list(d.tests)
    # Long requests are listed one per line with the sample type alongside (a distractor
    # column, never part of the test text); they usually continue on a second page.
    long_list = len(names) > 12
    ncols = 1 if long_list else (3 if len(names) > 6 else 2)
    row_h = 21 if long_list else ROW_H
    col_w = (W - 2 * m) / ncols
    limit = H - NOTES_TOP - 40
    if long_list:
        rec.text(m + 8, y - 4, "Determinación", font=body_bold, size=7.5, color=GREY)
        rec.text(m + 320, y - 4, "Muestra", font=body_bold, size=7.5, color=GREY)
        y += 10
    i = 0
    while i < len(names):
        rows_avail = int((limit - y) // row_h)
        if rows_avail < 2:
            rec.text(
                W - m,
                H - 40,
                "continúa en la página siguiente →",
                font=body_font,
                size=7.5,
                color=GREY,
                align="right",
            )
            rec.new_page("request")
            y = _continuation_header(rec, d, body_font, body_bold)
            continue
        chunk = names[i : i + ncols * rows_avail]
        per_col = max(1, math.ceil(len(chunk) / ncols))
        for k, name in enumerate(chunk):
            col, row = divmod(k, per_col)
            x = m + col * col_w
            yy = y + row * row_h
            rec.text(x, yy, "-", font=body_font, size=8.5)
            rec.test_text(x + 8, yy, name, size=8.5, font=body_font)
            if long_list:
                rec.text(m + 320, yy, rng.choice(SAMPLE_TYPES), font=body_font, size=8, color=GREY)
        i += len(chunk)
        y += per_col * row_h + 14

    # ---- observations (decorative handwriting)
    rec.text(m, y, "Observaciones:", font=body_font, size=8.5, color=GREY)
    rec.line(m + 70, y + 2, W - m, y + 2, width=0.4, color=GREY)
    if d.observations:
        rec.scribble(m + 80, y - 1, d.observations, size=13)

    # ---- pre-printed notes block
    ny = H - NOTES_TOP
    rec.line(m, ny - 12, W - m, ny - 12, width=0.4, color=GREY)
    rec.text(m, ny, "INFORMACIÓN AL PACIENTE", font=body_bold, size=7.5, color=GREY)
    for k, line in enumerate(d.instructions):
        rec.text(m, ny + 12 + k * 10, line, font=body_font, size=7.5, color=GREY)

    # ---- footer
    fy = H - 80
    rec.text(m, fy, "Etiquetas de tubos:", font=body_font, size=8, color=GREY)
    for k in range(4):
        rec.rect(m + 90 + k * 60, fy - 10, 52, 14, stroke=GREY, width=0.4)
    rec.text(W - m, fy, "Firma:", font=body_font, size=8, color=GREY, align="right")
    rec.scribble(W - m - 120, fy + 22, d.physician.signature, size=15)
    disclaimer(rec)
