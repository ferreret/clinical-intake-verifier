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
