"""Static, entirely fictional vocabularies used by the generator.

Every centre, insurer and person here is invented. Nothing may be added that names a real
organisation, product or system (CLAUDE.md hard rule 2).
"""

from __future__ import annotations

from .model import Center

TEMPLATE_NAMES = ("lab-classic", "insurer-form", "hospital-compact")

# Fictional insurers. Deliberately not resembling any existing Spanish health insurer.
INSURERS: tuple[str, ...] = (
    "Meridional Salud",
    "Ibérica Asistencial",
    "Cantábrica Seguros Médicos",
    "Balear Salud Mutua",
    "Atlántida Seguros de Salud",
    "Nova Salud Aseguradora",
    "Unión Médica del Sur",
)

# Fictional centres.
CENTERS: tuple[Center, ...] = (
    Center(
        "Laboratorio Clínico Alborada",
        "Av. de los Almendros 42, 28045 Madrid",
        "915 555 214",
        "lab",
    ),
    Center(
        "Centro Diagnóstico Meridiano",
        "C/ Doctor Ferrán 8, 46010 Valencia",
        "963 555 870",
        "clinic",
    ),
    Center("Clínica Vistalegre", "Paseo de la Ribera 15, 41010 Sevilla", "954 555 331", "clinic"),
    Center(
        "Laboratorios Analíticos del Norte",
        "C/ Iparraguirre 21, 48009 Bilbao",
        "944 555 672",
        "lab",
    ),
    Center(
        "Hospital Comarcal Sierra Blanca",
        "Ctra. de la Sierra km 3, 29600 Marbella",
        "952 555 100",
        "hospital",
    ),
    Center(
        "Hospital Universitario del Ebro",
        "Av. del Ebro 120, 50015 Zaragoza",
        "976 555 400",
        "hospital",
    ),
    Center(
        "Hospital General de la Marina", "C/ del Puerto 3, 03700 Dénia", "965 555 220", "hospital"
    ),
)

SERVICES: tuple[str, ...] = (
    "Medicina Interna",
    "Endocrinología",
    "Medicina de Familia",
    "Ginecología",
    "Cardiología",
    "Aparato Digestivo",
    "Hematología",
    "Nefrología",
    "Urología",
    "Reumatología",
    "Pediatría",
    "Medicina del Trabajo",
)

# Two-digit province codes used to build medical college registration numbers.
PROVINCE_CODES: tuple[str, ...] = (
    "28",
    "08",
    "46",
    "41",
    "29",
    "48",
    "50",
    "03",
    "30",
    "15",
    "36",
    "07",
)

OBSERVATIONS: tuple[str, ...] = (
    "Ayunas 12 h",
    "Urgente",
    "Paciente anticoagulado",
    "Repetir en 3 meses",
    "Control post-tratamiento",
    "Extracción a domicilio",
    "Avisar resultados por tfno.",
    "Preoperatorio",
)

# Free-text reason for the request. Distractor content: never a field.
DIAGNOSES: tuple[str, ...] = (
    "Control de hipotiroidismo",
    "Revisión anual",
    "Estudio de anemia",
    "Preoperatorio",
    "Control de dislipemia",
    "Seguimiento diabetes tipo 2",
    "Astenia de larga evolución",
    "Control de hipertensión arterial",
    "Estudio de fertilidad",
    "Dolor abdominal inespecífico",
    "Control de tratamiento anticoagulante",
    "Seguimiento de insuficiencia renal crónica",
)

# Pre-printed patient instructions (three lines) used to fill the page realistically.
INSTRUCTIONS: tuple[tuple[str, str, str], ...] = (
    (
        "Acuda en ayunas de 8-12 horas salvo indicación contraria de su médico.",
        "Puede beber agua. Tome su medicación habitual salvo que se le indique lo contrario.",
        "Presente este documento junto con su documento de identidad en el punto de extracción.",
    ),
    (
        "Horario de extracciones: de lunes a viernes de 8:00 a 10:30 h.",
        "Para muestras de orina utilice el recipiente estéril que se le entregará en recepción.",
        "Los resultados estarán disponibles en el plazo indicado por el laboratorio.",
    ),
    (
        "Es imprescindible ayuno de 12 horas para el perfil lipídico y la glucosa.",
        "No realice ejercicio intenso en las 24 horas previas a la extracción.",
        "Conserve este volante: su número identifica la petición en el laboratorio.",
    ),
)

MONTHS_ES: tuple[str, ...] = (
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
)

# Printed representations of sex, as (hombre, mujer) pairs.
SEX_LABEL_PAIRS: tuple[tuple[str, str], ...] = (
    ("H", "M"),
    ("Hombre", "Mujer"),
    ("Varón", "Mujer"),
    ("V", "M"),
    ("Masculino", "Femenino"),
)
