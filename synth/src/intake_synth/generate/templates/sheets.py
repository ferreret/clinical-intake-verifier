"""Companion sheets that travel with a request in a real multipage scan.

Every sheet belongs to the *same* patient and request, so any value it prints is a further
occurrence of a field already defined by the data (recorded with ``primary=False``) or a
distractor that is not a field at all. A sheet never introduces a conflicting value: that
would make the golden ambiguous.
"""

from __future__ import annotations

import random

from reportlab.lib import colors

from ..model import DocData
from ..recorder import GREY, LIGHT_GREY, WHITE, Recorder
from .common import disclaimer

NAVY = colors.HexColor("#0B2545")
GREEN = colors.HexColor("#2E7D32")
CARD_BG = colors.HexColor("#E9EEF5")
CARD_BG_ID = colors.HexColor("#F1EDE4")
MARGIN = 48

LEGAL_TEXT = (
    (
        "Esta autorización ampara exclusivamente las prestaciones relacionadas y carece de validez "
        "para pruebas distintas de las indicadas. El centro prestador deberá conservar este documento "
        "junto con la solicitud del médico prescriptor y adjuntarlo a la facturación correspondiente."
    ),
    (
        "Los datos personales se tratan con la única finalidad de gestionar la prestación sanitaria "
        "autorizada. El asegurado puede ejercer sus derechos de acceso, rectificación y supresión "
        "dirigiéndose al departamento de atención al asegurado de la entidad."
    ),
)

CONSENT_TEXT = (
    (
        "He sido informado/a de que la extracción de muestras biológicas (sangre venosa, orina u "
        "otras) tiene como finalidad la realización de las pruebas analíticas solicitadas por mi "
        "médico, y de que se trata de un procedimiento habitual con riesgos mínimos, tales como "
        "hematoma, dolor local o, excepcionalmente, mareo o lipotimia."
    ),
    (
        "He podido formular las preguntas que he considerado oportunas y comprendo que puedo revocar "
        "este consentimiento en cualquier momento antes de la extracción sin necesidad de justificarlo."
    ),
    (
        "Autorizo asimismo la conservación de las muestras durante el tiempo necesario para completar "
        "las determinaciones solicitadas y las repeticiones que el laboratorio estime necesarias por "
        "control de calidad."
    ),
)

BACK_TEXT = (
    (
        "Información sobre protección de datos. El responsable del tratamiento es el centro emisor de "
        "este documento. Los datos se tratan para la gestión asistencial y administrativa de la "
        "petición y se conservan durante los plazos legalmente establecidos."
    ),
)


def _kv(
    rec: Recorder,
    x: float,
    y: float,
    label: str,
    value: str | None,
    *,
    field: str | None = None,
    golden_value: str | None = None,
    label_w: float = 120,
    size: float = 10,
    bold: bool = False,
) -> None:
    rec.text(x, y, label, font="Helvetica", size=8.5, color=GREY)
    if value is None:
        return
    font = "Helvetica-Bold" if bold else "Helvetica"
    if field is not None:
        rec.field_text(
            x + label_w,
            y,
            field,
            value,
            golden_value,
            size=size,
            font=font,
            primary=False,
            hand_ok=False,
        )
    else:
        rec.text(x + label_w, y, value, font=font, size=size)


# --------------------------------------------------------------------------- authorization


def authorization(rec: Recorder, d: DocData, rng: random.Random, total_pages: int) -> None:
    """Insurer authorisation letter. Repeats insurer numbers, patient and often the tests."""
    ins = d.insurance
    assert ins is not None, "authorization sheet requires insurance data"
    W, H, m = rec.W, rec.H, MARGIN

    rec.field_text(
        m,
        60,
        "NombreMutua",
        ins.name,
        size=16,
        font="Helvetica-Bold",
        color=NAVY,
        primary=False,
        hand_ok=False,
    )
    rec.text(
        m, 74, "Departamento de Autorizaciones · Prestaciones ambulatorias", size=8.5, color=GREY
    )
    rec.text(W - m, 60, f"Fecha: {d.issue_date:%d/%m/%Y}", size=9, align="right")
    ref = ins.solicitud or ins.autorizacion or d.request_number
    rec.text(W - m, 74, f"Ref.: {ref}", size=8.5, color=GREY, align="right")
    rec.line(m, 86, W - m, 86, width=1.2, color=NAVY)

    y = 120
    rec.text(
        m, y, "AUTORIZACIÓN DE PRESTACIONES SANITARIAS", font="Helvetica-Bold", size=13, color=NAVY
    )
    y = rec.paragraph(
        m,
        y + 22,
        "Se autoriza la realización de las pruebas relacionadas a continuación a la persona "
        "asegurada que se indica, en el centro concertado señalado y dentro del periodo de validez.",
        W - 2 * m,
        size=9,
    )

    y += 14
    _kv(rec, m, y, "Asegurado/a:", d.patient_printed_name, field="Paciente", bold=True)
    y += 18
    _kv(rec, m, y, "DNI / NIE:", d.patient.doc_id, field="DocumentoIdentidad")
    y += 18
    _kv(rec, m, y, "Nº de tarjeta:", ins.tarjeta, field="NumeroTarjeta")
    y += 18
    _kv(rec, m, y, "Nº de solicitud:", ins.solicitud, field="NumeroSolicitudMutua")
    y += 18
    _kv(
        rec,
        m,
        y,
        "Nº de autorización:",
        ins.autorizacion,
        field="NumeroAutorizacion",
        bold=True,
        size=12,
    )
    y += 22
    _kv(rec, m, y, "Centro concertado:", d.center.name)
    y += 18
    _kv(rec, m, y, "Médico prescriptor:", d.physician.name, field="NombreMedico")
    y += 18
    if rng.random() < 0.5:
        _kv(rec, m, y, "Nº petición centro:", d.request_number, field="NumeroPeticion")
        y += 18

    y += 12
    rec.text(m, y, "PRUEBAS AUTORIZADAS", font="Helvetica-Bold", size=9, color=NAVY)
    rec.line(m, y + 4, W - m, y + 4, width=0.6, color=NAVY)
    y += 20
    if rng.random() < 0.6:
        for name in d.tests:
            rec.text(m + 4, y, "•", size=9)
            rec.test_text(m + 14, y, name, size=9.5, primary=False)
            y += 15
    else:
        rec.text(
            m,
            y,
            f"{len(d.tests)} determinación(es) según solicitud adjunta del médico prescriptor.",
            size=9.5,
        )
        y += 15

    y += 20
    rec.text(m, y, f"Validez: 30 días desde el {d.issue_date:%d/%m/%Y}.", size=9)
    rec.stamp(W - m - 90, y + 30, "AUTORIZADO", color=GREEN, rotation=rng.uniform(-14, -4))
    rec.text(W - m - 140, y + 62, f"{d.issue_date:%d/%m/%Y}", size=7.5, color=GREEN)

    fy = H - 110
    for text in LEGAL_TEXT:
        fy = rec.paragraph(m, fy, text, W - 2 * m, size=6.8, color=GREY)
        fy += 4
    disclaimer(rec)


# --------------------------------------------------------------------------- id copy


def id_copy(rec: Recorder, d: DocData, rng: random.Random, total_pages: int) -> None:
    """Photocopy of the insurance card and/or an identity card."""
    _W, H, m = rec.W, rec.H, MARGIN
    ins = d.insurance
    drew_any = False

    if ins is not None and rng.random() < 0.85:
        cx, cy, cw, ch = m + rng.uniform(0, 120), 90 + rng.uniform(0, 60), 250, 156
        rec.rect(cx, cy, cw, ch, stroke=LIGHT_GREY, fill=CARD_BG, width=0.8, radius=10)
        rec.rect(cx, cy, cw, 34, stroke=None, fill=NAVY, radius=10)
        rec.rect(cx, cy + 20, cw, 14, stroke=None, fill=NAVY)
        rec.field_text(
            cx + 14,
            cy + 23,
            "NombreMutua",
            ins.name,
            size=13,
            font="Helvetica-Bold",
            color=WHITE,
            primary=False,
            hand_ok=False,
        )
        rec.text(cx + 14, cy + 52, "TARJETA SANITARIA", size=7, color=GREY)
        if ins.tarjeta is not None:
            rec.field_text(
                cx + 14,
                cy + 78,
                "NumeroTarjeta",
                ins.tarjeta,
                size=14,
                font="Courier-Bold",
                primary=False,
                hand_ok=False,
            )
        rec.text(cx + 14, cy + 100, "TITULAR", size=7, color=GREY)
        rec.field_text(
            cx + 14,
            cy + 114,
            "Paciente",
            d.patient_printed_name,
            size=9.5,
            font="Helvetica-Bold",
            primary=False,
            hand_ok=False,
        )
        rec.text(cx + 14, cy + 132, "VÁLIDA HASTA", size=7, color=GREY)
        rec.text(
            cx + 80,
            cy + 132,
            f"{rng.randint(1, 12):02d}/{d.issue_date.year + rng.randint(1, 4)}",
            size=9,
        )
        rec.text(
            cx + cw - 14,
            cy + 145,
            "Asistencia 24 h · 900 555 000",
            size=6.5,
            color=GREY,
            align="right",
        )
        drew_any = True

    if d.patient.doc_id is not None and rng.random() < 0.85:
        cx, cy, cw, ch = m + rng.uniform(0, 120), 330 + rng.uniform(0, 80), 258, 162
        rec.rect(cx, cy, cw, ch, stroke=LIGHT_GREY, fill=CARD_BG_ID, width=0.8, radius=10)
        rec.text(
            cx + 12, cy + 18, "DOCUMENTO DE IDENTIDAD", font="Helvetica-Bold", size=8.5, color=NAVY
        )
        rec.rect(
            cx + 12, cy + 30, 62, 78, stroke=LIGHT_GREY, fill=colors.HexColor("#D5D5D5"), width=0.5
        )
        rec.text(cx + 43, cy + 74, "FOTO", size=7, color=GREY, align="center")
        tx = cx + 86
        rec.text(tx, cy + 40, "APELLIDOS", size=6, color=GREY)
        rec.text(
            tx,
            cy + 51,
            f"{d.patient.last_name1} {d.patient.last_name2}".upper(),
            font="Helvetica-Bold",
            size=8.5,
        )
        rec.text(tx, cy + 64, "NOMBRE", size=6, color=GREY)
        rec.text(tx, cy + 75, d.patient.first_name.upper(), font="Helvetica-Bold", size=8.5)
        rec.text(tx, cy + 88, "SEXO", size=6, color=GREY)
        card_sex = "F" if d.patient.sex == "M" else "M"
        rec.field_text(
            tx, cy + 99, "Sexo", card_sex, d.patient.sex, size=8.5, primary=False, hand_ok=False
        )
        rec.text(tx + 50, cy + 88, "NACIONALIDAD", size=6, color=GREY)
        rec.text(tx + 50, cy + 99, "ESP", size=8.5)
        rec.text(tx, cy + 112, "FECHA DE NACIMIENTO", size=6, color=GREY)
        rec.field_text(
            tx,
            cy + 123,
            "FechaNacimiento",
            f"{d.patient.birth_date:%d %m %Y}",
            d.birth_value,
            size=8.5,
            primary=False,
            hand_ok=False,
        )
        rec.text(cx + 12, cy + 128, "DNI", size=6, color=GREY)
        rec.field_text(
            cx + 12,
            cy + 141,
            "DocumentoIdentidad",
            d.patient.doc_id,
            size=10,
            font="Courier-Bold",
            primary=False,
            hand_ok=False,
        )
        rec.text(
            tx + 90,
            cy + 141,
            f"VALIDEZ {rng.randint(1, 28):02d} {rng.randint(1, 12):02d} {d.issue_date.year + rng.randint(1, 9)}",
            size=6.5,
            color=GREY,
        )
        drew_any = True

    if not drew_any:
        rec.text(m, 120, "Copia de documentación del paciente", size=10, color=GREY)
    rec.text(m, H - 60, f"Copia adjunta a la petición {d.request_number}", size=7, color=GREY)
    disclaimer(rec)


# --------------------------------------------------------------------------- consent


def consent(rec: Recorder, d: DocData, rng: random.Random, total_pages: int) -> None:
    """Informed consent form filled in by hand: patient name and ID handwritten."""
    W, _H, m = rec.W, rec.H, MARGIN
    rec.text(W / 2, 64, d.center.name, font="Helvetica-Bold", size=11, align="center")
    rec.text(
        W / 2,
        96,
        "CONSENTIMIENTO INFORMADO PARA LA EXTRACCIÓN DE MUESTRAS BIOLÓGICAS",
        font="Helvetica-Bold",
        size=10.5,
        align="center",
    )
    rec.line(m, 108, W - m, 108, width=0.8)

    y = 140
    rec.text(m, y, "D./Dña.", size=10)
    rec.line(m + 42, y + 2, m + 330, y + 2, width=0.5)
    rec.hand(m + 50, y - 1, d.patient_printed_name, field="Paciente", size=11, primary=False)
    rec.text(m + 340, y, "con DNI/NIE nº", size=10)
    rec.line(m + 412, y + 2, W - m, y + 2, width=0.5)
    if d.patient.doc_id is not None:
        rec.hand(
            m + 420, y - 1, d.patient.doc_id, field="DocumentoIdentidad", size=11, primary=False
        )
    y += 26
    rec.text(m, y, "DECLARO que:", font="Helvetica-Bold", size=10)
    y += 18
    for text in CONSENT_TEXT:
        y = rec.paragraph(m, y, text, W - 2 * m, size=9.5)
        y += 8

    y += 10
    rec.text(m, y, "Médico responsable:", size=9.5, color=GREY)
    rec.field_text(
        m + 100, y, "NombreMedico", d.physician.name, size=10, primary=False, hand_ok=False
    )
    y += 30
    rec.text(
        m,
        y,
        f"En {d.center.address.split(',')[-1].strip().split(' ', 1)[-1]}, a {d.issue_date.day} de {_month_name(d.issue_date.month)} de {d.issue_date.year}",
        size=9.5,
    )

    y += 60
    rec.text(m, y, "Firma del paciente", size=8, color=GREY)
    rec.line(m, y - 12, m + 200, y - 12, width=0.5)
    rec.scribble(
        m + 30,
        y - 18,
        f"{d.patient.first_name[0]}. {d.patient.last_name1}",
        size=17,
        max_rotation=12,
    )
    rec.text(W - m - 200, y, "Firma del médico", size=8, color=GREY)
    rec.line(W - m - 200, y - 12, W - m, y - 12, width=0.5)
    rec.scribble(W - m - 170, y - 18, d.physician.signature, size=15)
    if rng.random() < 0.5:
        rec.stamp(
            W - m - 100, y + 40, "RECIBIDO", color=NAVY, size=11, rotation=rng.uniform(-10, 10)
        )
    disclaimer(rec)


def _month_name(month: int) -> str:
    return (
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    )[month - 1]


# --------------------------------------------------------------------------- fax cover


def fax_cover(rec: Recorder, d: DocData, rng: random.Random, total_pages: int) -> None:
    """Fax transmittal sheet. Distractor numbers everywhere; repeats the request number."""
    W, H, m = rec.W, rec.H, MARGIN
    rec.text(m, 110, "FAX", font="Helvetica-Bold", size=42)
    rec.text(m, 128, "Hoja de transmisión", size=10, color=GREY)
    rec.line(m, 140, W - m, 140, width=2)

    y = 175
    rows = [
        ("De:", d.center.name),
        ("Fax remitente:", f"9{rng.randint(10, 99)} 555 {rng.randint(100, 999)}"),
        (
            "Para:",
            rng.choice(["Laboratorio de referencia", "Unidad de Admisión", "Autorizaciones"]),
        ),
        ("Fax destino:", f"9{rng.randint(10, 99)} 555 {rng.randint(100, 999)}"),
        ("Fecha:", f"{d.issue_date:%d/%m/%Y}  {rng.randint(8, 19):02d}:{rng.randint(0, 59):02d}"),
        ("Nº de páginas:", f"{total_pages} (incluida esta portada)"),
    ]
    for label, value in rows:
        rec.text(m, y, label, font="Helvetica-Bold", size=10)
        rec.text(m + 120, y, value, size=10)
        y += 24
    rec.text(m, y, "Asunto:", font="Helvetica-Bold", size=10)
    rec.text(m + 120, y, "Petición de analítica nº", size=10)
    rec.field_text(
        m + 232,
        y,
        "NumeroPeticion",
        d.request_number,
        size=10,
        font="Helvetica-Bold",
        primary=False,
        hand_ok=False,
    )
    y += 40
    rec.line(m, y, W - m, y, width=0.8)
    y += 24
    rec.text(m, y, "Comentarios:", font="Helvetica-Bold", size=10)
    if rng.random() < 0.6:
        rec.scribble(
            m + 100,
            y + 2,
            rng.choice(
                ["Adjunto volante y autorización", "Urgente, gracias", "Para su tramitación"]
            ),
            size=15,
        )
    for k in range(4):
        rec.line(m, y + 20 + k * 22, W - m, y + 20 + k * 22, width=0.4, color=LIGHT_GREY)
    rec.paragraph(
        m,
        H - 90,
        "Este fax contiene información confidencial dirigida exclusivamente a su destinatario. "
        "Si lo ha recibido por error, comuníquelo al remitente y destrúyalo.",
        W - 2 * m,
        size=7,
        color=GREY,
    )
    disclaimer(rec)


# --------------------------------------------------------------------------- blank back


def blank_back(rec: Recorder, d: DocData, rng: random.Random, total_pages: int) -> None:
    """Back side of a duplex scan: nearly empty, faint pre-printed text."""
    W, H, m = rec.W, rec.H, MARGIN
    if rng.random() < 0.7:
        y = 80 + rng.uniform(0, 300)
        for text in BACK_TEXT:
            y = rec.paragraph(m, y, text, W - 2 * m, size=7, color=LIGHT_GREY)
    if rng.random() < 0.3:
        rec.text(W / 2, H - 40, "Reverso", size=7, color=LIGHT_GREY, align="center")
    disclaimer(rec)


SHEETS = {
    "authorization": authorization,
    "id-copy": id_copy,
    "consent": consent,
    "fax-cover": fax_cover,
    "blank": blank_back,
}
