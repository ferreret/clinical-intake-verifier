"""Catalan for the documents of Catalan-language insurers.

The lab's catalog stays in Spanish; only what a Catalan insurer prints is translated. Test
names go through a vocabulary of the terms the catalog uses, applied phrase by phrase, so a
name the vocabulary does not fully cover keeps a Spanish word, as forms in practice do.
Catalan elides "de" before a vowel ("d'orina") and writes the middle dot in "l·l"
("pol·len", "cèl·lules"), both of which the extractor has to read verbatim.
"""

from __future__ import annotations

import re
from functools import cache

from .labcatalog import Specimen

SPECIMENS_CA: dict[str, Specimen] = {
    "S": Specimen("sèrum", "sèrum", "S-"),
    "P": Specimen("plasma", "plasma", "P-"),
    "SG": Specimen("sang total", "sang", "SG-"),
    "O": Specimen("orina", "orina", "O-"),
    "O24": Specimen("orina de 24 h", "orina 24 h", "O24-"),
    "LCR": Specimen("líquid cefalorraquidi", "LCR", "LCR-"),
    "LP": Specimen("líquid pleural", "l. pleural", None),
    "LA": Specimen("líquid ascític", "l. ascític", None),
    "LS": Specimen("líquid sinovial", "l. sinovial", None),
    "H": Specimen("femta", "femta", "F-"),
    "SUD": Specimen("suor", "suor", None),
    "SAL": Specimen("saliva", "saliva", None),
    "SEM": Specimen("semen", "semen", None),
    "X": Specimen("", "", None),
}

PROFILE_NAMES_CA: dict[str, tuple[str, ...]] = {
    "PF01": ("Perfil hepàtic", "Funció hepàtica", "Proves hepàtiques", "P. hepàtic"),
    "PF02": ("Perfil lipídic", "Lípids", "Estudi lipídic", "P. lipídic"),
    "PF03": ("Perfil renal", "Funció renal", "Proves renals", "P. renal"),
    "PF04": ("Perfil tiroidal", "Funció tiroidal", "Estudi tiroidal", "Tiroide"),
    "PF05": ("Estudi de coagulació", "Coagulació", "Coagulació bàsica", "Hemostàsia"),
    "PF06": ("Estudi d'anèmia", "Perfil d'anèmia", "Perfil fèrric", "Metabolisme del ferro"),
    "PF07": ("Ions", "Ionograma", "Electròlits", "Ions Na, K, Cl"),
    "PF08": ("Perfil hormonal femení", "Hormones femenines", "Estudi hormonal", "P. hormonal"),
    "PF09": ("Immunoglobulines IgA, IgG, IgM", "Immunoglobulines", "IgA, IgG, IgM", "Ig A, G, M"),
    "PF10": ("Complement C3 i C4", "C3 i C4", "Complement", "C3, C4"),
    "PF11": ("Perfil celíac", "Celiaquia", "Estudi de celiaquia", "Serologia celíaca"),
    "PF12": ("Perfil d'hepatitis B", "Hepatitis B", "Marcadors VHB", "Serologia VHB"),
}

# Spanish term -> Catalan, as the catalog writes it. Longer entries win over shorter ones.
_TERMS = """
y = i; con = amb; para = per a; del ácido = de l'àcid; del aliento = de l'alè; tras = després de
Ácido = Àcid; Ácidos = Àcids; úrico = úric; fólico = fòlic; láctico = làctic
ascórbico = ascòrbic; vanilmandélico = vanil·lilmandèlic; 5-hidroxiindolacético = 5-hidroxiindolacètic
biliares = biliars; totales = totals; valproico = valproic; glutámico = glutàmic
Glucemia = Glucèmia; sérica = sèrica; Aclaramiento = Aclariment; Filtrado = Filtrat; estimado = estimat
Urato = Urat; Sodio = Sodi; Potasio = Potassi; Cloro = Clor; Cloruro = Clorur; Calcio = Calci
iónico = iònic; Fósforo = Fòsfor; Fosfato = Fosfat; inorgánico = inorgànic; Magnesio = Magnesi
Hierro = Ferro; Sideremia = Siderèmia; Índice = Índex; saturación = saturació; Capacidad = Capacitat
fijación = fixació; Triglicéridos = Triglicèrids; Apolipoproteína = Apolipoproteïna
Lipoproteína = Lipoproteïna; Aspartato = Aspartat; Bilirrubina = Bilirubina; Proteínas = Proteïnes
Proteína = Proteïna; Cociente = Quocient; Microalbuminuria = Microalbuminúria; Lactato = Lactat
quinasa = cinasa; masa = massa; Amonio = Amoni; Amoniaco = Amoníac; Osmolalidad = Osmolalitat
Osmolaridad = Osmolaritat; Bicarbonato = Bicarbonat; Gasometría = Gasometria; Gases = Gasos
arteriales = arterials; sensibilidad = sensibilitat; Homocisteína = Homocisteïna; Cobre = Coure
Electroforesis = Electroforesi; Inmunofijación = Immunofixació; electroforética = electroforètica
Cadenas = Cadenes; ligeras = lleugeres; libres = lliures; libre = lliure; Oxalato = Oxalat
Oxaluria = Oxalúria; Citrato = Citrat; Citraturia = Citratúria; Catecolaminas = Catecolamines
fraccionadas = fraccionades; Metanefrinas = Metanefrines; Porfirinas = Porfirines
pancreática = pancreàtica; Sangre = Sang; heces = femta; Grasas = Greixos; Recuento = Recompte
celular = cel·lular; células = cèl·lules; Estudio = Estudi; cristales = cristalls; Cristales = Cristalls
Cálculo = Càlcul; cálculo = càlcul; urinario = urinari; Análisis = Anàlisi; Litiasis = Litiasi
completo = complet; Plaquetas = Plaquetes; reticulocitos = reticulòcits; Reticulocitos = Reticulòcits
Velocidad = Velocitat; sedimentación = sedimentació; periférica = perifèrica; Extensión = Extensió
Hematocrito = Hematòcrit; leucocitaria = leucocitària; Grupo = Grup; grupo = grup
sanguíneo = sanguini; directo = directe; indirecto = indirecte; Prueba = Prova; Pruebas = Proves
Escrutinio = Escrutini; anticuerpos = anticossos; Anticuerpos = Anticossos; irregulares = irregulars
hemoglobinas = hemoglobines; hemoglobinopatías = hemoglobinopaties; fosfato = fosfat
Fragilidad = Fragilitat; osmótica = osmòtica; eritrocitaria = eritrocitària
Inmunofenotipo = Immunofenotip; Subpoblaciones = Subpoblacions; Poblaciones = Poblacions
linfocitarias = limfocitàries; Eritropoyetina = Eritropoetina; Tiempo = Temps; Actividad = Activitat
Fibrinógeno = Fibrinogen; derivado = derivat; Dímero = Dímer; dímero = dímer
Resistencia = Resistència; Anticoagulante = Anticoagulant; lúpico = lúpic; coagulante = coagulant
antígeno = antigen; Antígeno = Antigen; Agregación = Agregació; agregación = agregació
plaquetaria = plaquetària; Triyodotironina = Triiodotironina; Cortisolemia = Cortisolèmia
foliculoestimulante = fol·liculostimulant; luteinizante = luteïnitzant; hormonas = hormones
sexuales = sexuals; sulfato = sulfat; coriónica = coriònica; crecimiento = creixement
Péptido = Pèptid; plasmática = plasmàtica; Folato = Folat; intraeritrocitario = intraeritrocitari
eritrocitario = eritrocitari; Selenio = Seleni; Plomo = Plom; Mercurio = Mercuri
Arsénico = Arsènic; Cadmio = Cadmi; Aluminio = Alumini; Cromo = Crom; Manganeso = Manganès
Cobalto = Cobalt; Yodo = Iode; Yoduria = Iodúria; prostático = prostàtic; específico = específic
carcinoembrionario = carcinoembrionari; escamoso = escatós; Mutación = Mutació
Polimorfismo = Polimorfisme; Tipaje = Tipatge; celiaquía = celiaquia; Fibrosis = Fibrosi
genético = genètic; genética = genètica; Hemocromatosis = Hemocromatosi; Cariotipo = Cariotip
frágil = fràgil; Reordenamiento = Reordenament; Talasemia = Talassèmia; talasemia = talassèmia
Intolerancia = Intolerància; Genotipo = Genotip; Genotipado = Genotipatge; Carga = Càrrega
cuantitativo = quantitatiu; papiloma = papil·loma; humano = humà; alto riesgo = alt risc
Sistemático = Sistemàtic; Anormales = Anormals; sedimento = sediment; Sedimento = Sediment
embarazo = embaràs; gestación = gestació; Serología = Serologia; Rubéola = Rubèola
rubéola = rubèola; tipo = tipus; Varicela = Varicel·la; zóster = zòster; Sarampión = Xarampió
aglutinación = aglutinació; galactomanano = galactomanà; treponémicos = treponèmics
superficie = superfície; Mononucleosis = Mononucleosi; rápido = ràpid; tuberculosis = tuberculosi
Interferón = Interferó; interferón = interferó; liberación = alliberament
antinucleares = antinuclears; nativo = natiu; Anticentrómero = Anticentròmer
anticentrómero = anticentròmer; tiroidea = tiroidal; neutrófilo = neutròfil
Antimitocondriales = Antimitocondrials; antimitocondriales = antimitocondrials
Antimúsculo liso = Antimuscle llis; antimúsculo liso = antimuscle llis
Anticélulas = Anticèl·lules; anticélulas = anticèl·lules; parietales = parietals
intrínseco = intrínsec; deamidada = desamidada; Antiendomisio = Antiendomisi
antiendomisio = antiendomisi; antipéptido = antipèptid; péptido = pèptid; cíclico = cíclic
citrulinado = citrul·linat; reumatoideo = reumatoide; glicoproteína = glicoproteïna
antirreceptor = antireceptor; Antigangliósidos = Antigangliòsids; antigangliósidos = antigangliòsids
antiacuaporina = antiaquaporina; Inmunoglobulina = Immunoglobulina; Subclases = Subclasses
subclases = subclasses; Complemento = Complement; Fracción = Fracció; Crioglobulinas = Crioglobulines
Crioglobulinemia = Crioglobulinèmia; Epitelio = Epiteli; gato = gat; perro = gos; caballo = cavall
conejo = conill; hámster = hàmster; Plumas de ave = Plomes d'au; Polen = Pol·len; olivo = olivera
gramíneas = gramínies; Plátano de sombra = Plàtan d'ombra; Ciprés = Xiprer; Pino = Pi
Abedul = Bedoll; Avellano = Avellaner; Aliso = Vern; Fresno = Freixe; Encina = Alzina
Leche de vaca = Llet de vaca; Caseína = Caseïna; Clara de huevo = Clara d'ou
Yema de huevo = Rovell d'ou; Trigo = Blat; Cebada = Ordi; Centeno = Sègol; Maíz = Blat de moro
Arroz = Arròs; Cacahuete = Cacauet; Nuez = Nou; Almendra = Ametlla; Anacardo = Anacard
Pistacho = Pistatxo; Castaña = Castanya; Sésamo = Sèsam; Mostaza = Mostassa; Altramuz = Tramús
Garbanzo = Cigró; Lenteja = Llentia; Guisante = Pèsol; Judía blanca = Mongeta blanca
Melocotón = Préssec; Manzana = Poma; Plátano = Plàtan; Fresa = Maduixa; Naranja = Taronja
Tomate = Tomàquet; Melón = Meló; Sandía = Síndria; Apio = Api; Zanahoria = Pastanaga; Ajo = All
Cebolla = Ceba; Bacalao = Bacallà; Merluza = Lluç; Atún = Tonyina; Salmón = Salmó
Langostino = Llagostí; Cangrejo = Cranc; Mejillón = Musclo; Almeja = Cloïssa; Pulpo = Pop
Ternera = Vedella; Cerdo = Porc; Pollo = Pollastre; Cordero = Xai; Cacao = Cacau; Café = Cafè
Veneno = Verí; abeja = abella; avispa = vespa; Látex = Làtex; Cucaracha = Panerola
Cultivo = Cultiu; Tinción = Tinció; hongos = fongs; Hongos = Fongs; micológico = micològic
micobacterias = micobacteris; Micobacterias = Micobacteris; exudado = exsudat; faríngeo = faringi
ótico = òtic; herida = ferida; vaginorrectal = vaginorectal; esputo = esput; aspirado = aspirat
lavado = rentat; líquido = líquid; cefalorraquídeo = cefalorraquidi; ascítico = ascític
diálisis = diàlisi; absceso = abscés; catéter = catèter; biopsia = biòpsia; uña = ungla; piel = pell
pelo = cabell; Urocultivo = Urinocultiu; Coprocultivo = Coprocultiu; Hemocultivo = Hemocultiu
Hemocultivos = Hemocultius; Parásitos = Paràsits; parásitos = paràsits; neumococo = pneumococ
Neumococo = Pneumococ; Estreptococo = Estreptococ; Gota gruesa = Gota grossa
paludismo = paludisme; Oxiuros = Oxiürs; Detección = Detecció; gripe = grip
respiratorio = respiratori; sincitial = sincicial; Niveles = Nivells; niveles = nivells
Fenitoína = Fenitoïna; Topiramato = Topiramat; Litio = Liti; Metotrexato = Metotrexat
Teofilina = Teofil·lina; Salicilatos = Salicilats; Cocaína = Cocaïna; cocaína = cocaïna
Metabolitos = Metabòlits; Opiáceos = Opiacis; Anfetaminas = Amfetamines
Benzodiacepinas = Benzodiazepines; Barbitúricos = Barbitúrics; Éxtasis = Èxtasi
valle = vall; predosis = predosi; pico = pic; postdosis = postdosi; sobrecarga = sobrecàrrega
vespertino = vespertí; estímulo = estímul; reposo = repòs; bipedestación = bipedestació
de pie = dempeus; Fólico = Fòlic; Fenitoína = Fenitoïna
"""

_ELISION = re.compile(r"\b([Dd])e (?=[aeiouàèéíïòóúüAEIOUÀÈÉÍÒÓÚ]|[hH][aeiouàèéíòóú])")


def _same_case(ca: str):
    """Replace with ``ca``, its first letter in the case of the matched one."""

    def sub(m: re.Match[str]) -> str:
        first = m.group(0)[0]
        return (ca[0].upper() if first.isupper() else ca[0].lower()) + ca[1:]

    return sub


@cache
def _terms() -> list[tuple[re.Pattern[str], str]]:
    pairs: dict[str, str] = {}
    for chunk in _TERMS.replace("\n", ";").split(";"):
        if chunk.strip():
            es, ca = (p.strip() for p in chunk.split("="))
            pairs.setdefault(es[0].lower() + es[1:], ca)
    ordered = sorted(pairs.items(), key=lambda p: len(p[0]), reverse=True)
    # The first letter matches in either case; the rest as written.
    return [
        (re.compile(rf"(?<!\w)[{re.escape(es[0].upper() + es[0])}]{re.escape(es[1:])}(?!\w)"), ca)
        for es, ca in ordered
    ]


@cache
def test_name(spanish: str) -> str:
    """A catalog name (or a piece of one) as a Catalan form would print it."""
    out = spanish
    for pattern, ca in _terms():
        out = pattern.sub(_same_case(ca), out)
    return _ELISION.sub(r"\1'", out)


# --------------------------------------------------------------------------- forms

MONTHS = (
    "gener", "febrer", "març", "abril", "maig", "juny",
    "juliol", "agost", "setembre", "octubre", "novembre", "desembre",
)  # fmt: skip
MONTHS_SHORT = (
    "gen", "febr", "març", "abr", "maig", "juny", "jul", "ag", "set", "oct", "nov", "des",
)  # fmt: skip

# Sex as Catalan forms print it, by the Spanish label a template chose.
SEX_LABELS: dict[str, str] = {
    "Hombre": "Home",
    "Varón": "Home",
    "Mujer": "Dona",
    "Masculino": "Masculí",
    "Femenino": "Femení",
    "H": "H",
    "V": "H",
    "M": "D",
}

# Every fixed text the templates and the generator's vocabularies print, in Catalan. The
# identity card is a state document and stays in Spanish; it never goes through this.
LABELS: dict[str, str] = {
    # headings and labels
    "ASEGURADO / PACIENTE": "ASSEGURAT / PACIENT",
    "ASEGURADORA / MUTUA": "ASSEGURADORA / MÚTUA",
    "AUTORIZACIÓN DE PRESTACIONES SANITARIAS": "AUTORITZACIÓ DE PRESTACIONS SANITÀRIES",
    "AUTORIZADO": "AUTORITZAT",
    "Asegurado/a:": "Assegurat/da:",
    "Asistencia 24 h · 900 555 000": "Assistència 24 h · 900 555 000",
    "Asunto:": "Assumpte:",
    "Autorizaciones": "Autoritzacions",
    "Autorización:": "Autorització:",
    "CENTRO": "CENTRE",
    "CENTRO Y MÉDICO PRESCRIPTOR": "CENTRE I METGE PRESCRIPTOR",
    "CONDICIONES": "CONDICIONS",
    "CONSENTIMIENTO INFORMADO PARA LA EXTRACCIÓN DE MUESTRAS BIOLÓGICAS": (
        "CONSENTIMENT INFORMAT PER A L'EXTRACCIÓ DE MOSTRES BIOLÒGIQUES"
    ),
    "Centro concertado:": "Centre concertat:",
    "Comentarios:": "Comentaris:",
    "Copia de documentación del paciente": "Còpia de documentació del pacient",
    "Código autorización": "Codi autorització",
    "D./Dña.": "En/Na",
    "DATOS DE LA AUTORIZACIÓN": "DADES DE L'AUTORITZACIÓ",
    "DATOS DEL PACIENTE": "DADES DEL PACIENT",
    "DIAGNÓSTICO / MOTIVO DE LA SOLICITUD": "DIAGNÒSTIC / MOTIU DE LA SOL·LICITUD",
    "Departamento de Autorizaciones · Prestaciones ambulatorias": (
        "Departament d'Autoritzacions · Prestacions ambulatòries"
    ),
    "Determinación": "Determinació",
    "Diagnóstico / motivo:": "Diagnòstic / motiu:",
    "Diagnóstico:": "Diagnòstic:",
    "Documento sintético generado para pruebas. No corresponde a ningún paciente real.": (
        "Document sintètic generat per a proves. No correspon a cap pacient real."
    ),
    "EDAD": "EDAT",
    "Edad:": "Edat:",
    "Etiquetas de tubos:": "Etiquetes de tubs:",
    "F.Nac:": "D.Naix:",
    "FECHA DE NACIMIENTO": "DATA DE NAIXEMENT",
    "FECHA DE PRESCRIPCIÓN": "DATA DE PRESCRIPCIÓ",
    "Fax destino:": "Fax destinació:",
    "Fax remitente:": "Fax remitent:",
    "Fecha extracción:": "Data extracció:",
    "Fecha nacimiento:": "Data naixement:",
    "Fecha:": "Data:",
    "Financiador:": "Finançador:",
    "Firma del médico": "Signatura del metge",
    "Firma del paciente": "Signatura del pacient",
    "Firma del prescriptor": "Signatura del prescriptor",
    "Firma y sello del médico": "Signatura i segell del metge",
    "Firma:": "Signatura:",
    "Heces": "Femta",
    "Hoja de transmisión": "Full de transmissió",
    "INFORMACIÓN AL PACIENTE": "INFORMACIÓ AL PACIENT",
    "INSTRUCCIONES PARA EL PACIENTE": "INSTRUCCIONS PER AL PACIENT",
    "Laboratorio de referencia": "Laboratori de referència",
    "MÉDICO PRESCRIPTOR": "METGE PRESCRIPTOR",
    "MÉDICO SOLICITANTE": "METGE SOL·LICITANT",
    "Muestra": "Mostra",
    "Mutua:": "Mútua:",
    "Médico prescriptor:": "Metge prescriptor:",
    "Médico responsable:": "Metge responsable:",
    "Médico solicitante:": "Metge sol·licitant:",
    "Médico:": "Metge:",
    "NOMBRE Y APELLIDOS": "NOM I COGNOMS",
    "Nº AUTORIZACIÓN": "Nº AUTORITZACIÓ",
    "Nº Autorización:": "Nº Autorització:",
    "Nº COLEGIADO": "Nº COL·LEGIAT",
    "Nº Colegiado:": "Nº Col·legiat:",
    "Nº PETICIÓN": "Nº PETICIÓ",
    "Nº PETICIÓN CENTRO": "Nº PETICIÓ CENTRE",
    "Nº PETICIÓN DEL CENTRO": "Nº PETICIÓ DEL CENTRE",
    "Nº SOLICITUD": "Nº SOL·LICITUD",
    "Nº Solicitud:": "Nº Sol·licitud:",
    "Nº TARJETA": "Nº TARGETA",
    "Nº Tarjeta:": "Nº Targeta:",
    "Nº de autorización:": "Nº d'autorització:",
    "Nº de páginas:": "Nº de pàgines:",
    "Nº de solicitud:": "Nº de sol·licitud:",
    "Nº de tarjeta:": "Nº de targeta:",
    "Nº petición centro:": "Nº petició centre:",
    "Observaciones:": "Observacions:",
    "PETICIÓN Nº": "PETICIÓ Nº",
    "PRUEBAS AUTORIZADAS": "PROVES AUTORITZADES",
    "PRUEBAS SOLICITADAS": "PROVES SOL·LICITADES",
    "PRUEBAS SOLICITADAS (continuación)": "PROVES SOL·LICITADES (continuació)",
    "Paciente:": "Pacient:",
    "Para:": "Per a:",
    "Petición de analítica nº": "Petició d'analítica núm.",
    "Petición:": "Petició:",
    "Plasma citrato": "Plasma citrat",
    "Prioridad:": "Prioritat:",
    "Prueba": "Prova",
    "RECIBIDO": "REBUT",
    "Reverso": "Revers",
    "SERVICIO": "SERVEI",
    "SEXO": "SEXE",
    "SOLICITUD DE ANÁLISIS CLÍNICOS": "SOL·LICITUD D'ANÀLISIS CLÍNIQUES",
    "Sangre EDTA": "Sang EDTA",
    "Sangre total": "Sang total",
    "Sexo:": "Sexe:",
    "Solicitud de pruebas diagnósticas · Análisis clínicos": (
        "Sol·licitud de proves diagnòstiques · Anàlisis clíniques"
    ),
    "Solicitud de pruebas diagnósticas · continuación": (
        "Sol·licitud de proves diagnòstiques · continuació"
    ),
    "Suero": "Sèrum",
    "TARJETA SANITARIA": "TARGETA SANITÀRIA",
    "TELÉFONO": "TELÈFON",
    "Tarjeta:": "Targeta:",
    "Teléfono contacto:": "Telèfon contacte:",
    "Teléfono:": "Telèfon:",
    "URGENTE": "URGENT",
    "Unidad de Admisión": "Unitat d'Admissió",
    "VÁLIDA HASTA": "VÀLIDA FINS A",
    "con DNI/NIE nº": "amb DNI/NIE núm.",
    "continuación": "continuació",
    "continúa en la página siguiente →": "continua a la pàgina següent →",
    "Hombre": "Home",
    "Mujer": "Dona",
    "Varón": "Home",
    "Masculino": "Masculí",
    "Femenino": "Femení",
    # paragraphs
    "Autorizo asimismo la conservación de las muestras durante el tiempo necesario para "
    "completar las determinaciones solicitadas y las repeticiones que el laboratorio estime "
    "necesarias por control de calidad.": (
        "Autoritzo així mateix la conservació de les mostres durant el temps necessari per "
        "completar les determinacions sol·licitades i les repeticions que el laboratori "
        "consideri necessàries per control de qualitat."
    ),
    "Este fax contiene información confidencial dirigida exclusivamente a su destinatario. "
    "Si lo ha recibido por error, comuníquelo al remitente y destrúyalo.": (
        "Aquest fax conté informació confidencial adreçada exclusivament al seu destinatari. "
        "Si l'ha rebut per error, comuniqueu-ho al remitent i destruïu-lo."
    ),
    "Esta autorización ampara exclusivamente las prestaciones relacionadas y carece de "
    "validez para pruebas distintas de las indicadas. El centro prestador deberá conservar "
    "este documento junto con la solicitud del médico prescriptor y adjuntarlo a la "
    "facturación correspondiente.": (
        "Aquesta autorització empara exclusivament les prestacions relacionades i no té "
        "validesa per a proves diferents de les indicades. El centre prestador haurà de "
        "conservar aquest document juntament amb la sol·licitud del metge prescriptor i "
        "adjuntar-lo a la facturació corresponent."
    ),
    "He podido formular las preguntas que he considerado oportunas y comprendo que puedo "
    "revocar este consentimiento en cualquier momento antes de la extracción sin necesidad "
    "de justificarlo.": (
        "He pogut formular les preguntes que he considerat oportunes i entenc que puc revocar "
        "aquest consentiment en qualsevol moment abans de l'extracció sense necessitat de "
        "justificar-ho."
    ),
    "He sido informado/a de que la extracción de muestras biológicas (sangre venosa, orina u "
    "otras) tiene como finalidad la realización de las pruebas analíticas solicitadas por mi "
    "médico, y de que se trata de un procedimiento habitual con riesgos mínimos, tales como "
    "hematoma, dolor local o, excepcionalmente, mareo o lipotimia.": (
        "He estat informat/ada que l'extracció de mostres biològiques (sang venosa, orina o "
        "altres) té com a finalitat la realització de les proves analítiques sol·licitades pel "
        "meu metge, i que es tracta d'un procediment habitual amb riscos mínims, com ara "
        "hematoma, dolor local o, excepcionalment, mareig o lipotímia."
    ),
    "Información sobre protección de datos. El responsable del tratamiento es el centro "
    "emisor de este documento. Los datos se tratan para la gestión asistencial y "
    "administrativa de la petición y se conservan durante los plazos legalmente "
    "establecidos.": (
        "Informació sobre protecció de dades. El responsable del tractament és el centre "
        "emissor d'aquest document. Les dades es tracten per a la gestió assistencial i "
        "administrativa de la petició i es conserven durant els terminis legalment establerts."
    ),
    "La presente solicitud tiene una validez de 30 días desde su emisión y ampara únicamente "
    "las pruebas relacionadas. El centro prestador adjuntará esta hoja a la factura. "
    "Cualquier prueba adicional requerirá una nueva autorización expresa de la entidad.": (
        "Aquesta sol·licitud té una validesa de 30 dies des de la seva emissió i empara "
        "únicament les proves relacionades. El centre prestador adjuntarà aquest full a la "
        "factura. Qualsevol prova addicional requerirà una nova autorització expressa de "
        "l'entitat."
    ),
    "Los datos personales se tratan con la única finalidad de gestionar la prestación "
    "sanitaria autorizada. El asegurado puede ejercer sus derechos de acceso, rectificación y "
    "supresión dirigiéndose al departamento de atención al asegurado de la entidad.": (
        "Les dades personals es tracten amb l'única finalitat de gestionar la prestació "
        "sanitària autoritzada. L'assegurat pot exercir els seus drets d'accés, rectificació i "
        "supressió adreçant-se al departament d'atenció a l'assegurat de l'entitat."
    ),
    "Los datos se tratan conforme a la normativa de protección de datos vigente.": (
        "Les dades es tracten d'acord amb la normativa de protecció de dades vigent."
    ),
    "Se autoriza la realización de las pruebas relacionadas a continuación a la persona "
    "asegurada que se indica, en el centro concertado señalado y dentro del periodo de "
    "validez.": (
        "S'autoritza la realització de les proves relacionades a continuació a la persona "
        "assegurada que s'indica, al centre concertat assenyalat i dins del període de validesa."
    ),
    # patient instructions
    "Acuda en ayunas de 8-12 horas salvo indicación contraria de su médico.": (
        "Vingui en dejú de 8-12 hores llevat d'indicació contrària del seu metge."
    ),
    "Puede beber agua. Tome su medicación habitual salvo que se le indique lo contrario.": (
        "Pot beure aigua. Prengui la seva medicació habitual llevat que se li indiqui el contrari."
    ),
    "Presente este documento junto con su documento de identidad en el punto de extracción.": (
        "Presenti aquest document juntament amb el seu document d'identitat al punt d'extracció."
    ),
    "Horario de extracciones: de lunes a viernes de 8:00 a 10:30 h.": (
        "Horari d'extraccions: de dilluns a divendres de 8:00 a 10:30 h."
    ),
    "Para muestras de orina utilice el recipiente estéril que se le entregará en recepción.": (
        "Per a mostres d'orina utilitzi el recipient estèril que se li lliurarà a recepció."
    ),
    "Los resultados estarán disponibles en el plazo indicado por el laboratorio.": (
        "Els resultats estaran disponibles en el termini indicat pel laboratori."
    ),
    "Es imprescindible ayuno de 12 horas para el perfil lipídico y la glucosa.": (
        "Cal dejuni de 12 hores per al perfil lipídic i la glucosa."
    ),
    "No realice ejercicio intenso en las 24 horas previas a la extracción.": (
        "No faci exercici intens les 24 hores prèvies a l'extracció."
    ),
    "Conserve este volante: su número identifica la petición en el laboratorio.": (
        "Conservi aquest volant: el seu número identifica la petició al laboratori."
    ),
    # services
    "Medicina Interna": "Medicina Interna",
    "Endocrinología": "Endocrinologia",
    "Medicina de Familia": "Medicina de Família",
    "Ginecología": "Ginecologia",
    "Cardiología": "Cardiologia",
    "Aparato Digestivo": "Aparell Digestiu",
    "Hematología": "Hematologia",
    "Nefrología": "Nefrologia",
    "Urología": "Urologia",
    "Reumatología": "Reumatologia",
    "Pediatría": "Pediatria",
    "Medicina del Trabajo": "Medicina del Treball",
    # observations
    "Ayunas 12 h": "Dejú 12 h",
    "Urgente": "Urgent",
    "Paciente anticoagulado": "Pacient anticoagulat",
    "Repetir en 3 meses": "Repetir d'aquí a 3 mesos",
    "Control post-tratamiento": "Control post-tractament",
    "Extracción a domicilio": "Extracció a domicili",
    "Avisar resultados por tfno.": "Avisar resultats per tel.",
    "Preoperatorio": "Preoperatori",
    # diagnoses
    "Control de hipotiroidismo": "Control d'hipotiroïdisme",
    "Revisión anual": "Revisió anual",
    "Estudio de anemia": "Estudi d'anèmia",
    "Control de dislipemia": "Control de dislipèmia",
    "Seguimiento diabetes tipo 2": "Seguiment diabetis tipus 2",
    "Astenia de larga evolución": "Astènia de llarga evolució",
    "Control de hipertensión arterial": "Control d'hipertensió arterial",
    "Estudio de fertilidad": "Estudi de fertilitat",
    "Dolor abdominal inespecífico": "Dolor abdominal inespecífic",
    "Control de tratamiento anticoagulante": "Control de tractament anticoagulant",
    "Seguimiento de insuficiencia renal crónica": "Seguiment d'insuficiència renal crònica",
}

_MONTHS_ES = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)  # fmt: skip


def _place_date(m: re.Match[str]) -> str:
    city, day, month, year = m.groups()
    ca = MONTHS[_MONTHS_ES.index(month)]
    of = "d'" if ca[0] in "aeiou" else "de "
    return f"A {city}, {day} {of}{ca} de {year}"


def _service(m: re.Match[str]) -> str:
    name = LABELS.get(m.group(2), m.group(2))
    if m.group(1) == ":":
        return f"Servei: {name}"
    return _ELISION.sub(r"\1'", f"Servei de {name}")


# Texts with data inside, by pattern.
_PATTERNS: tuple[tuple[re.Pattern[str], object], ...] = (
    (
        re.compile(r"^(\d+) determinación\(es\) según solicitud adjunta del médico prescriptor\.$"),
        r"\1 determinació(ns) segons la sol·licitud adjunta del metge prescriptor.",
    ),
    (re.compile(r"^(\d+) \(incluida esta portada\)$"), r"\1 (inclosa aquesta portada)"),
    (re.compile(r"^Copia adjunta a la petición (.+)$"), r"Còpia adjunta a la petició \1"),
    (re.compile(r"^En (.+), a (\d+) de (\w+) de (\d{4})$"), _place_date),
    (re.compile(r"^Fecha: (.+)$"), r"Data: \1"),
    (re.compile(r"^Validez: 30 días desde el (.+)\.$"), r"Validesa: 30 dies des del \1."),
    (re.compile(r"^Servicio( de|:) (.+)$"), _service),
)


def label(spanish: str) -> str:
    """Fixed text from a template or vocabulary, in Catalan; unknown text comes back as is."""
    if spanish in LABELS:
        return LABELS[spanish]
    for pattern, repl in _PATTERNS:
        if pattern.match(spanish):
            return pattern.sub(repl, spanish)
    return spanish
