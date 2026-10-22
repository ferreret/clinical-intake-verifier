"""Template ``insurer-form``: an insurer's authorisation form. Cells with the label above
the value, the request number printed twice (body cell and barcode label), and tests in a
table where profile headings visually group their components. Long tables continue on the
next page under a compact header.
"""

from __future__ import annotations

import random

from reportlab.lib import colors

from ..model import DocData
from ..recorder import GREY, Recorder
from .common import cell, disclaimer

NAVY = colors.HexColor("#0B2545")
SHADE = colors.HexColor("#E8ECF1")
HEADING_SHADE = colors.HexColor("#F3F5F8")
BORDER = colors.HexColor("#9E9E9E")
MARGIN = 36
ROW_H = 15


def _table_header(rec: Recorder, y: float, full: float) -> float:
    m = MARGIN
    rec.rect(m, y, full, ROW_H, stroke=BORDER, fill=SHADE, width=0.5)
    rec.text(m + 6, y + 11, "Prueba", font="Helvetica-Bold", size=8)
    rec.text(
        m + full - 6, y + 11, "Código autorización", font="Helvetica-Bold", size=8, align="right"
    )
    return y + ROW_H


def _continuation_header(rec: Recorder, d: DocData) -> float:
    W, m = rec.W, MARGIN
    assert d.insurance is not None
    rec.field_text(
        m,
        40,
        "NombreMutua",
        d.insurance.name,
        size=14,
        font="Helvetica-Bold",
        color=NAVY,
        primary=False,
        hand_ok=False,
    )
    rec.text(m, 54, "Solicitud de pruebas diagnósticas · continuación", size=9, color=GREY)
    rec.barcode(
        W - m - 160,
        22,
        d.request_number,
        height=26,
        bar_width=0.8,
        field="NumeroPeticion",
        primary=False,
    )
    rec.line(m, 70, W - m, 70, width=1.2, color=NAVY)
    y = 90
    rec.text(m, y, "PRUEBAS SOLICITADAS (continuación)", font="Helvetica-Bold", size=8, color=NAVY)
    return y + 6


def render(rec: Recorder, d: DocData, rng: random.Random) -> None:
    W, H = rec.W, rec.H
    m = MARGIN
    ins = d.insurance
    assert ins is not None, "insurer-form requires insurance data"

    # ---- header
    rec.field_text(
        m, 42, "NombreMutua", ins.name, size=17, font="Helvetica-Bold", color=NAVY, hand_ok=False
    )
    rec.text(m, 57, "Solicitud de pruebas diagnósticas · Análisis clínicos", size=9, color=GREY)
    bw = rec.barcode(
        W - m - 160,
        22,
        d.request_number,
        height=26,
        bar_width=0.8,
        field="NumeroPeticion",
        primary=False,
    )
    rec.text(W - m - 160 + bw / 2, 18, "Nº PETICIÓN CENTRO", size=6, color=GREY, align="center")
    rec.line(m, 70, W - m, 70, width=1.2, color=NAVY)

    full = W - 2 * m
    h = 34

    # ---- authorisation block
    y = 82
    rec.text(m, y, "DATOS DE LA AUTORIZACIÓN", font="Helvetica-Bold", size=8, color=NAVY)
    y += 6
    w1 = 170
    cell(rec, m, y, w1, h, "Nº SOLICITUD", "NumeroSolicitudMutua", ins.solicitud)
    cell(rec, m + w1, y, w1, h, "Nº AUTORIZACIÓN", "NumeroAutorizacion", ins.autorizacion)
    cell(rec, m + 2 * w1, y, full - 2 * w1, h, "Nº TARJETA", "NumeroTarjeta", ins.tarjeta)
    y += h

    # ---- patient block
    y += 16
    rec.text(m, y, "ASEGURADO / PACIENTE", font="Helvetica-Bold", size=8, color=NAVY)
    y += 6
    wn = 320
    cell(rec, m, y, wn, h, "NOMBRE Y APELLIDOS", "Paciente", d.patient_printed_name)
    cell(rec, m + wn, y, full - wn, h, "DNI / NIE", "DocumentoIdentidad", d.patient.doc_id)
    y += h
    wb, wa, ws = 140, 70, 160
    cell(rec, m, y, wb, h, "FECHA DE NACIMIENTO", "FechaNacimiento", d.birth_printed, d.birth_value)
    cell(rec, m + wb, y, wa, h, "EDAD", "Edad", d.age_printed)
    cell(rec, m + wb + wa, y, ws, h, "SEXO")
    if d.show_sex:
        labels = rng.choice([("Hombre", "Mujer"), ("H", "M"), ("Masculino", "Femenino")])
        if rng.random() < 0.7:
            rec.sex_boxes(m + wb + wa + 6, y + h - 8, d.patient.sex, labels=labels, size=8, gap=14)
        else:
            rec.field_text(
                m + wb + wa + 5, y + h - 7, "Sexo", d.sex_printed, d.patient.sex, size=10
            )
    cell(rec, m + wb + wa + ws, y, full - wb - wa - ws, h, "TELÉFONO", "Telefono", d.patient.phone)
    y += h

    # ---- centre / physician block
    y += 16
    rec.text(m, y, "CENTRO Y MÉDICO PRESCRIPTOR", font="Helvetica-Bold", size=8, color=NAVY)
    y += 6
    cell(rec, m, y, wn, h, "CENTRO", None, d.center.name)
    cell(rec, m + wn, y, full - wn, h, "Nº PETICIÓN DEL CENTRO", "NumeroPeticion", d.request_number)
    y += h
    cell(
        rec,
        m,
        y,
        wn,
        h,
        "MÉDICO PRESCRIPTOR",
        "NombreMedico",
        d.physician.name,
        d.physician.full_name,
    )
    cell(rec, m + wn, y, full - wn, h, "Nº COLEGIADO", "NumeroColegiado", d.physician.colegiado)
    y += h
    cell(rec, m, y, wn, h, "SERVICIO", None, d.service)
    cell(rec, m + wn, y, full - wn, h, "FECHA DE PRESCRIPCIÓN", None, f"{d.issue_date:%d/%m/%Y}")
    y += h
    cell(rec, m, y, full, h, "DIAGNÓSTICO / MOTIVO DE LA SOLICITUD", None, d.diagnosis)
    y += h

    # ---- tests table (may continue on further pages)
    y += 16
    rec.text(m, y, "PRUEBAS SOLICITADAS", font="Helvetica-Bold", size=8, color=NAVY)
    y += 6
    y = _table_header(rec, y, full)
    limit = H - 196  # keep clear of the conditions paragraph and the footer

    def ensure_room(y: float) -> float:
        if y + ROW_H > limit:
            rec.text(
                W - m,
                H - 40,
                "continúa en la página siguiente →",
                size=7.5,
                color=GREY,
                align="right",
            )
            rec.new_page("request")
            return _table_header(rec, _continuation_header(rec, d), full)
        return y

    current_profile: str | None = None
    for item in d.items:
        if item.profile != current_profile:
            current_profile = item.profile
            if current_profile is not None:
                y = ensure_room(y)
                rec.rect(m, y, full, ROW_H, stroke=BORDER, fill=HEADING_SHADE, width=0.5)
                rec.text(
                    m + 6,
                    y + 11,
                    current_profile.upper(),
                    font="Helvetica-Bold",
                    size=8,
                    color=NAVY,
                )
                y += ROW_H
        y = ensure_room(y)
        rec.rect(m, y, full, ROW_H, stroke=BORDER, width=0.5)
        indent = 18 if item.profile else 6
        if item.profile:
            rec.text(m + 8, y + 11, "•", size=8)
        rec.test_text(m + indent, y + 11, item.name, size=9)
        if rng.random() < 0.5:
            rec.text(
                m + full - 6,
                y + 11,
                f"{rng.randint(1000, 9999)}",
                size=8,
                font="Courier",
                color=GREY,
                align="right",
            )
        y += ROW_H

    # ---- conditions + footer (always on the last page)
    fy = H - 96
    cy = fy - 66
    rec.text(m, cy, "CONDICIONES", font="Helvetica-Bold", size=7, color=NAVY)
    rec.paragraph(
        m,
        cy + 11,
        "La presente solicitud tiene una validez de 30 días desde su emisión y ampara únicamente "
        "las pruebas relacionadas. El centro prestador adjuntará esta hoja a la factura. Cualquier "
        "prueba adicional requerirá una nueva autorización expresa de la entidad.",
        full,
        size=6.5,
        color=GREY,
    )
    rec.text(
        m,
        fy + 9,
        "Los datos se tratan conforme a la normativa de protección de datos vigente.",
        size=6.5,
        color=GREY,
    )
    rec.rect(W - m - 160, fy - 6, 160, 50, stroke=BORDER, width=0.5)
    rec.text(W - m - 155, fy + 2, "Firma del prescriptor", size=6.5, color=GREY)
    rec.scribble(W - m - 135, fy + 34, d.physician.signature, size=15)
    disclaimer(rec)
