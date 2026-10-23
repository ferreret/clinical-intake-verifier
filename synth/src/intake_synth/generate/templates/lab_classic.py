"""Template ``lab-classic``: private laboratory request with a coloured header band,
two-column patient data, checkbox test list and a Code128 barcode in the footer.

About a third of the documents use a pre-printed test list where only some boxes are
ticked; unticked tests are distractors and are not ground truth. Long lists continue on a
second page under a compact header that repeats the request number and the patient name.
"""

from __future__ import annotations

import math
import random

from reportlab.lib import colors

from ..model import DocData
from ..recorder import GREY, WHITE, Recorder
from .common import disclaimer, kv, section

BANDS = (
    colors.HexColor("#1F4E79"),
    colors.HexColor("#2E7D32"),
    colors.HexColor("#6A1B9A"),
    colors.HexColor("#37474F"),
    colors.HexColor("#00695C"),
)
ROW_H = 15
MARGIN = 42
FOOTER_TOP = 118  # distance from the page bottom to the barcode top
INSTRUCTIONS_H = 62


def _continuation_header(rec: Recorder, d: DocData, band: colors.Color) -> float:
    W, m = rec.W, MARGIN
    rec.rect(0, 0, W, 44, fill=band, stroke=None)
    rec.text(m, 28, d.center.name, font="Helvetica-Bold", size=12, color=WHITE)
    rec.text(W - m, 18, "Nº PETICIÓN", size=6.5, color=WHITE, align="right")
    rec.field_text(
        W - m,
        36,
        "NumeroPeticion",
        d.request_number,
        size=12,
        font="Helvetica-Bold",
        color=WHITE,
        align="right",
        primary=False,
        hand_ok=False,
    )
    y = 70
    kv(rec, m, y, "Paciente:", "Paciente", d.patient_printed_name, label_w=62, primary=False)
    rec.text(W - m, y, "continuación", size=8, color=GREY, align="right")
    return section(rec, m, y + 26, W - 2 * m, "PRUEBAS SOLICITADAS (continuación)", color=band)


def render(rec: Recorder, d: DocData, rng: random.Random) -> None:
    W, H = rec.W, rec.H
    m = MARGIN
    band = rng.choice(BANDS)

    # ---- header band
    rec.rect(0, 0, W, 78, fill=band, stroke=None)
    rec.circle(m + 16, 39, 15, fill=WHITE)
    rec.text(
        m + 16, 45, d.center.name[0], font="Helvetica-Bold", size=17, color=band, align="center"
    )
    rec.text(m + 42, 34, d.center.name, font="Helvetica-Bold", size=15, color=WHITE)
    rec.text(m + 42, 50, d.center.address, size=8, color=WHITE)
    rec.text(m + 42, 61, f"Tel. {d.center.phone}", size=8, color=WHITE)
    rec.text(W - m, 30, "Nº PETICIÓN", size=7, color=WHITE, align="right")
    rec.field_text(
        W - m,
        50,
        "NumeroPeticion",
        d.request_number,
        size=15,
        font="Helvetica-Bold",
        color=WHITE,
        align="right",
        hand_ok=False,
    )
    rec.text(W - m, 64, f"Fecha: {d.issue_date:%d/%m/%Y}", size=8, color=WHITE, align="right")

    y = 104
    rec.text(m, y, "SOLICITUD DE ANÁLISIS CLÍNICOS", font="Helvetica-Bold", size=12)
    rec.text(W - m, y, f"Servicio: {d.service}", size=9, align="right")
    if d.urgent:
        rec.text(
            W - m - 120,
            y,
            "URGENTE",
            font="Helvetica-Bold",
            size=9,
            color=colors.HexColor("#B71C1C"),
            align="right",
        )

    # ---- patient
    col2 = m + (W - 2 * m) / 2 + 12
    y = section(rec, m, y + 28, W - 2 * m, "DATOS DEL PACIENTE", color=band)
    kv(rec, m, y, "Paciente:", "Paciente", d.patient_printed_name, label_w=62)
    kv(rec, col2, y, "DNI / NIE:", "DocumentoIdentidad", d.patient.doc_id, label_w=62)
    y += 19
    kv(
        rec,
        m,
        y,
        "Fecha nacimiento:",
        "FechaNacimiento",
        d.birth_printed,
        d.birth_value,
        label_w=88,
    )
    kv(rec, col2, y, "Edad:", "Edad", d.age_printed, label_w=62)
    y += 19
    rec.text(m, y, "Sexo:", font="Helvetica-Bold", size=8, color=GREY)
    if d.show_sex:
        if rng.random() < 0.5:
            labels = rng.choice([("Hombre", "Mujer"), ("H", "M"), ("Varón", "Mujer")])
            rec.sex_boxes(m + 88, y, d.patient.sex, labels=labels)
        else:
            rec.field_text(m + 88, y, "Sexo", d.sex_printed, d.patient.sex, size=10)
    kv(rec, col2, y, "Teléfono:", "Telefono", d.patient.phone, label_w=62)

    # ---- physician
    y = section(rec, m, y + 30, W - 2 * m, "MÉDICO SOLICITANTE", color=band)
    kv(rec, m, y, "Médico:", "NombreMedico", d.physician.name, d.physician.full_name, label_w=62)
    kv(rec, col2, y, "Nº Colegiado:", "NumeroColegiado", d.physician.colegiado, label_w=70)
    y += 19
    rec.text(m, y, "Diagnóstico / motivo:", font="Helvetica-Bold", size=8, color=GREY)
    if d.diagnosis:
        rec.text(m + 100, y, d.diagnosis, size=10)

    # ---- insurer
    if d.insurance is not None:
        ins = d.insurance
        y = section(rec, m, y + 30, W - 2 * m, "ASEGURADORA / MUTUA", color=band)
        kv(rec, m, y, "Mutua:", "NombreMutua", ins.name, label_w=62)
        kv(rec, col2, y, "Nº Solicitud:", "NumeroSolicitudMutua", ins.solicitud, label_w=70)
        y += 19
        kv(rec, m, y, "Nº Autorización:", "NumeroAutorizacion", ins.autorizacion, label_w=88)
        kv(rec, col2, y, "Nº Tarjeta:", "NumeroTarjeta", ins.tarjeta, label_w=70)

    # ---- tests (two columns, may continue on further pages)
    y = section(rec, m, y + 30, W - 2 * m, "PRUEBAS SOLICITADAS", color=band)
    requested = list(d.tests)
    preprinted = rng.random() < 0.35
    if preprinted:
        pool = [t for t in d.preprinted if t not in requested]
        rng.shuffle(pool)
        # Pre-printed catalogues come in several lengths; the long ones span two pages.
        target = max(rng.choice([26, 26, 44, 60]), len(requested) + 6)
        listed = requested + pool[: max(0, target - len(requested))]
        rng.shuffle(listed)
    else:
        listed = requested
    mark = rng.choice(["x", "tick"])
    col_w = (W - 2 * m) / 2
    limit = H - FOOTER_TOP - INSTRUCTIONS_H - 46  # keep clear of the instructions box
    i = 0
    while i < len(listed):
        rows_avail = int((limit - y) // ROW_H)
        if rows_avail < 2:
            rec.text(
                W - m,
                H - 40,
                "continúa en la página siguiente →",
                size=7.5,
                color=GREY,
                align="right",
            )
            rec.new_page("request")
            y = _continuation_header(rec, d, band)
            continue
        chunk = listed[i : i + 2 * rows_avail]
        per_col = max(1, math.ceil(len(chunk) / 2))
        for k, name in enumerate(chunk):
            col, row = divmod(k, per_col)
            x = m + col * col_w
            yy = y + row * ROW_H
            checked = name in requested
            rec.checkbox(x, yy - 7.5, 8, checked, mark=mark)
            if checked:
                rec.test_text(x + 13, yy, name, size=9)
            else:
                rec.text(x + 13, yy, name, size=9, color=GREY)
        i += len(chunk)
        y += per_col * ROW_H + 6

    # ---- observations (decorative handwriting, never a field)
    rec.text(m, y + 8, "Observaciones:", font="Helvetica-Bold", size=8, color=GREY)
    rec.line(m + 78, y + 10, W - m, y + 10, width=0.4, color=GREY)
    if d.observations:
        rec.scribble(m + 84, y + 7, d.observations, size=13)

    # ---- pre-printed instructions box, anchored above the footer
    fy = H - FOOTER_TOP
    iy = fy - INSTRUCTIONS_H - 22
    rec.rect(
        m, iy, W - 2 * m, INSTRUCTIONS_H, stroke=GREY, width=0.5, fill=colors.HexColor("#F7F7F7")
    )
    rec.text(
        m + 8,
        iy + 14,
        "INSTRUCCIONES PARA EL PACIENTE",
        font="Helvetica-Bold",
        size=7.5,
        color=GREY,
    )
    for k, line in enumerate(d.instructions):
        rec.text(m + 8, iy + 28 + k * 11, line, size=7.5, color=GREY)

    # ---- footer: barcode + signature box
    rec.barcode(m, fy, d.request_number, height=34, field="NumeroPeticion", primary=False)
    rec.rect(W - m - 175, fy - 12, 175, 64, stroke=GREY, width=0.6)
    rec.text(W - m - 170, fy - 2, "Firma y sello del médico", size=7, color=GREY)
    rec.scribble(W - m - 150, fy + 34, d.physician.signature, size=16)
    disclaimer(rec)
