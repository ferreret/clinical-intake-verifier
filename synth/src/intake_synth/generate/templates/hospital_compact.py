"""Template ``hospital-compact``: monochrome, dense hospital request. A patient sticker with
a record number (NHC) and its own Code39 barcode acts as a distractor next to the real
request number barcode. Tests are a plain multi-column list.
"""

from __future__ import annotations

import math
import random

from reportlab.lib import colors

from ..model import DocData
from ..recorder import BLACK, GREY, Recorder
from .common import disclaimer


def render(rec: Recorder, d: DocData, rng: random.Random) -> None:
    W, H = rec.W, rec.H
    m = 34
    mono = rng.random() < 0.4
    body_font = "Courier" if mono else "Helvetica"
    body_bold = "Courier-Bold" if mono else "Helvetica-Bold"

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

    def label(x: float, yy: float, s: str) -> float:
        b = rec.text(x, yy, s, font=body_font, size=8.5, color=GREY)
        return b[2] + 4

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

    # ---- tests
    y += 34
    rec.text(m, y, "PRUEBAS SOLICITADAS", font="Helvetica-Bold", size=9)
    rec.line(m, y + 4, W - m, y + 4, width=0.8)
    y += 20
    names = list(d.tests)
    ncols = 3 if len(names) > 6 else 2
    per_col = max(1, math.ceil(len(names) / ncols))
    col_w = (W - 2 * m) / ncols
    row_h = 14
    for i, name in enumerate(names):
        col, row = divmod(i, per_col)
        x = m + col * col_w
        yy = y + row * row_h
        rec.text(x, yy, "-", font=body_font, size=8.5)
        rec.test_text(x + 8, yy, name, size=8.5, font=body_font)
    y += per_col * row_h + 14

    # ---- observations (decorative handwriting)
    rec.text(m, y, "Observaciones:", font=body_font, size=8.5, color=GREY)
    rec.line(m + 70, y + 2, W - m, y + 2, width=0.4, color=GREY)
    if d.observations:
        rec.scribble(m + 80, y - 1, d.observations, size=13)

    # ---- pre-printed notes block
    ny = H - 150
    rec.line(m, ny - 12, W - m, ny - 12, width=0.4, color=GREY)
    rec.text(m, ny, "INFORMACIÓN AL PACIENTE", font=body_bold, size=7.5, color=GREY)
    for k, line in enumerate(d.instructions):
        rec.text(m, ny + 12 + k * 10, line, font=body_font, size=7.5, color=GREY)

    # ---- footer
    fy = H - 80
    rec.text(m, fy, "Etiquetas de tubos:", font=body_font, size=8, color=GREY)
    for i in range(4):
        rec.rect(m + 90 + i * 60, fy - 10, 52, 14, stroke=GREY, width=0.4)
    rec.text(W - m, fy, "Firma:", font=body_font, size=8, color=GREY, align="right")
    rec.scribble(W - m - 120, fy + 22, d.physician.signature, size=15)
    disclaimer(rec)
