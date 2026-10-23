"""The lab's own test catalog: invented codes over generic medical terminology.

The catalog is the target of test mapping (F4): every requested line on a form means one or
more of these codes. It is fixed for a generator version, independent of the dataset seed,
the way a lab's catalog does not change from one request to the next.

It is built by combination, the way real catalogs grow: one analyte measured in several
specimens, one organism with several antibody classes, one culture per sample site. That
produces the near-duplicates that make mapping hard ("Glucosa" in serum, in urine, after a
load). Names are generic terminology; codes are invented (section prefix and four digits) and
resemble no existing system (CLAUDE.md hard rule 2).
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from functools import cache

CATALOG_VERSION = 2
# Seeds the code numbers. Kept apart from the format version so codes stay put across formats.
CODE_SEED = "lab-catalog:1"

SECTIONS: dict[str, str] = {
    "BQ": "Bioquímica",
    "HE": "Hematología",
    "CO": "Coagulación",
    "HO": "Hormonas",
    "VI": "Vitaminas y elementos traza",
    "MT": "Marcadores tumorales",
    "FA": "Fármacos y tóxicos",
    "SE": "Serología",
    "AI": "Autoinmunidad",
    "AL": "Alergia",
    "MI": "Microbiología",
    "BM": "Biología molecular",
    "OR": "Orina y otros líquidos",
}


@dataclass(frozen=True)
class Specimen:
    label: str  # as the lab writes it
    short: str  # compact form used by forms in brackets
    prefix: str | None  # form prefix such as "S-", when forms use one


# "X": the specimen is part of the test itself (a culture site, a blood count); never printed.
SPECIMENS: dict[str, Specimen] = {
    "S": Specimen("suero", "suero", "S-"),
    "P": Specimen("plasma", "plasma", "P-"),
    "SG": Specimen("sangre total", "sangre", "SG-"),
    "O": Specimen("orina", "orina", "O-"),
    "O24": Specimen("orina de 24 h", "orina 24 h", "O24-"),
    "LCR": Specimen("líquido cefalorraquídeo", "LCR", "LCR-"),
    "LP": Specimen("líquido pleural", "l. pleural", None),
    "LA": Specimen("líquido ascítico", "l. ascítico", None),
    "LS": Specimen("líquido sinovial", "l. sinovial", None),
    "H": Specimen("heces", "heces", "H-"),
    "SUD": Specimen("sudor", "sudor", None),
    "SAL": Specimen("saliva", "saliva", None),
    "SEM": Specimen("semen", "semen", None),
    "X": Specimen("", "", None),
}


@dataclass(frozen=True)
class LabTest:
    code: str
    name: str  # the lab's canonical name, unique in the catalog
    section: str
    analyte: str  # canonical analyte name, shared by every specimen and variant
    names: tuple[str, ...]  # the analyte's names: canonical first, then synonyms
    specimen: str  # key of SPECIMENS
    default_specimen: bool  # the analyte's usual specimen, often left unwritten on forms
    variant: tuple[str, ...]  # forms of the variant ("tras sobrecarga 2 h"), empty if none


@dataclass(frozen=True)
class LabProfile:
    """A named group of tests. Requesting it means requesting each component code."""

    id: str
    names: tuple[str, ...]  # canonical first
    components: tuple[str, ...]  # codes
    expandable: bool  # printed on forms as a heading with its components underneath


@dataclass(frozen=True)
class Catalog:
    tests: tuple[LabTest, ...]
    profiles: tuple[LabProfile, ...]
    common: tuple[str, ...]  # codes or profile ids most requests draw from, most frequent first

    def by_code(self, code: str) -> LabTest:
        return _index(self)[0][code]

    def profile(self, pid: str) -> LabProfile:
        return _index(self)[1][pid]

    def find(self, analyte: str, specimen: str | None = None) -> LabTest:
        """The plain test (no variant) of ``analyte`` in ``specimen``, its default if None."""
        for t in self.tests:
            wanted = t.default_specimen if specimen is None else t.specimen == specimen
            if t.analyte == analyte and not t.variant and wanted:
                return t
        raise KeyError(f"no catalog test {analyte!r} in {specimen or 'default specimen'}")

    def to_json(self) -> dict:
        return {
            "catalog_version": CATALOG_VERSION,
            "sections": SECTIONS,
            "specimens": {k: s.label for k, s in SPECIMENS.items() if k != "X"},
            "tests": [
                {
                    "code": t.code,
                    "name": t.name,
                    "section": t.section,
                    "analyte": t.analyte,
                    "synonyms": list(t.names[1:]),
                    "specimen": None if t.specimen == "X" else t.specimen,
                    "default_specimen": t.default_specimen,
                    "variant": t.variant[0] if t.variant else None,
                }
                for t in self.tests
            ],
            "profiles": [
                {"id": p.id, "name": p.names[0], "codes": list(p.components)} for p in self.profiles
            ],
        }


@cache
def _index(cat: Catalog) -> tuple[dict[str, LabTest], dict[str, LabProfile]]:
    return {t.code: t for t in cat.tests}, {p.id: p for p in cat.profiles}


# --------------------------------------------------------------------------- analytes
#
# One line per analyte: section | names (canonical first, "; ") | specimens (default first) |
# variants ("; ", each with its forms separated by "~"). A variant is an extra test on the
# default specimen, besides the plain one.

_ANALYTES = """
BQ | Glucosa; Glucemia; GLU | S O O24 LCR LP LA LS | tras sobrecarga oral 2 h~post-SOG 2 h~SOG 2 h; postprandial~postingesta
BQ | Urea; Urea sérica | S O O24 LA
BQ | Creatinina; CREA; Creat | S O O24 LA
BQ | Aclaramiento de creatinina; Aclaramiento creatinina; ClCr | O24
BQ | Filtrado glomerular estimado; FGe; eGFR | S
BQ | Ácido úrico; Urato; AU | S O O24 LS
BQ | Sodio; Na | S O O24 SUD
BQ | Potasio; K | S O O24
BQ | Cloro; Cloruro; Cl | S O O24 SUD
BQ | Calcio; Calcio total; Ca | S O O24
BQ | Calcio iónico; Ca iónico; Ca++ | SG
BQ | Fósforo; Fosfato; P inorgánico | S O O24
BQ | Magnesio; Mg | S O O24
BQ | Hierro; Fe; Sideremia | S
BQ | Ferritina; Ferritina sérica | S
BQ | Transferrina; Tf | S
BQ | Índice de saturación de transferrina; IST; Sat. transferrina | S
BQ | Capacidad total de fijación del hierro; CTFH; TIBC | S
BQ | Receptor soluble de transferrina; RsTf | S
BQ | Colesterol total; Colesterol; CT | S LP
BQ | Colesterol HDL; HDL colesterol; HDL; HDL-c | S
BQ | Colesterol LDL; LDL colesterol; LDL; LDL-c | S
BQ | Colesterol no HDL; No-HDL colesterol | S
BQ | Triglicéridos; TG; TGC | S LP LA
BQ | Apolipoproteína A1; Apo A1; Apo A-I | S
BQ | Apolipoproteína B; Apo B | S
BQ | Lipoproteína (a); Lp(a) | S
BQ | GOT (AST); GOT; AST; ASAT; Aspartato aminotransferasa | S
BQ | GPT (ALT); GPT; ALT; ALAT; Alanina aminotransferasa | S
BQ | GGT; Gamma GT; γ-GT; Gamma-glutamil transferasa | S
BQ | Fosfatasa alcalina; FA; FAL; ALP | S
BQ | Bilirrubina total; Bilirrubina; BT | S LA
BQ | Bilirrubina directa; Bilirrubina conjugada; BD | S
BQ | Bilirrubina indirecta; BI | S
BQ | Proteínas totales; Proteínas; PT | S O O24 LCR LP LA LS
BQ | Albúmina; ALB | S O LCR LA
BQ | Cociente albúmina/creatinina; Albúmina/creatinina; CAC | O
BQ | Microalbuminuria; Microalbúmina | O O24
BQ | Cociente proteínas/creatinina; Proteínas/creatinina | O
BQ | LDH; Lactato deshidrogenasa; LD | S LCR LP LA LS
BQ | CK; CPK; Creatina quinasa | S
BQ | CK-MB; CK-MB masa | S
BQ | Troponina I; TnI; Troponina I ultrasensible | S
BQ | Troponina T; TnT; Troponina T ultrasensible | S
BQ | NT-proBNP; Pro-BNP; NTproBNP | S
BQ | Mioglobina; Mb | S O
BQ | Amilasa; AMS; Alfa-amilasa | S O O24 LP LA
BQ | Lipasa; Lipasa sérica | S
BQ | Colinesterasa; Pseudocolinesterasa | S
BQ | Aldolasa | S
BQ | Lactato; Ácido láctico | P LCR
BQ | Amonio; Amoniaco | P
BQ | Osmolalidad; Osmolaridad | S O
BQ | Bicarbonato; HCO3; CO2 total | S
BQ | Gasometría venosa; Gases venosos | SG
BQ | Gasometría arterial; Gases arteriales | SG
BQ | Proteína C reactiva (PCR); PCR; Proteína C reactiva | S
BQ | PCR ultrasensible; PCR-us; PCR alta sensibilidad | S
BQ | Procalcitonina; PCT | S
BQ | Homocisteína; Hcy | P
BQ | Ácidos biliares; Ácidos biliares totales | S
BQ | Cobre; Cu | S O24
BQ | Zinc; Zn | S
BQ | Ceruloplasmina | S
BQ | Haptoglobina | S
BQ | Alfa-1 antitripsina; A1AT; Alfa1-antitripsina | S H
BQ | Beta-2 microglobulina; B2M; Beta2-microglobulina | S O
BQ | Prealbúmina; Transtiretina | S
BQ | Proteinograma; Electroforesis de proteínas; EEF | S O24
BQ | Inmunofijación; Inmunofijación electroforética | S O
BQ | Cadenas ligeras libres kappa; Kappa libre; CLL kappa | S O
BQ | Cadenas ligeras libres lambda; Lambda libre; CLL lambda | S O
BQ | Fructosamina | S
BQ | Hemoglobina glicosilada (HbA1c); HbA1c; Hb glicada; Hemoglobina A1c | SG
BQ | Oxalato; Oxaluria | O24
BQ | Citrato; Citraturia | O24
BQ | Ácido 5-hidroxiindolacético; 5-HIAA | O24
BQ | Catecolaminas; Catecolaminas fraccionadas | O24 P
BQ | Metanefrinas; Metanefrinas fraccionadas | O24 P
BQ | Ácido vanilmandélico; VMA | O24
BQ | Porfirinas; Porfirinas totales | O24 H
BQ | Calprotectina; Calprotectina fecal | H
BQ | Elastasa pancreática; Elastasa fecal | H
BQ | Sangre oculta en heces; SOH; Test de sangre oculta | H
BQ | Grasas en heces; Esteatorrea | H
BQ | Adenosina desaminasa (ADA); ADA | LP LA LCR LS
BQ | pH | LP O
BQ | Recuento celular; Recuento de células | LCR LP LA LS
BQ | Estudio de cristales; Cristales | LS
BQ | Cálculo urinario; Análisis de cálculo; Litiasis | X
HE | Hemograma completo; Hemograma; Hemograma y fórmula; HG | X
HE | Recuento de plaquetas; Plaquetas | X
HE | Recuento de reticulocitos; Reticulocitos | X
HE | Velocidad de sedimentación (VSG); VSG; Velocidad de sedimentación globular | X
HE | Frotis de sangre periférica; Frotis; Extensión de sangre periférica | X
HE | Hemoglobina; Hb | X
HE | Hematocrito; Hto | X
HE | Fórmula leucocitaria; Fórmula | X
HE | Grupo sanguíneo y Rh; Grupo y Rh; Grupo ABO y Rh | X
HE | Coombs directo; Prueba de antiglobulina directa | X
HE | Escrutinio de anticuerpos irregulares; Coombs indirecto; EAI | X
HE | Electroforesis de hemoglobinas; Estudio de hemoglobinopatías | X
HE | Hemoglobina A2; HbA2 | X
HE | Hemoglobina fetal; HbF | X
HE | Glucosa-6-fosfato deshidrogenasa; G6PD | X
HE | Fragilidad osmótica eritrocitaria; Fragilidad osmótica | X
HE | Inmunofenotipo de sangre periférica; Inmunofenotipo | X
HE | Subpoblaciones linfocitarias; CD4/CD8; Poblaciones linfocitarias | X
HE | Carboxihemoglobina; COHb | X
HE | Metahemoglobina; MetHb | X
HE | Eritropoyetina; EPO | S
CO | Tiempo de protrombina; TP; Tiempo de Quick; Actividad de protrombina | X
CO | INR | X
CO | TTPA; TTPa; Tiempo de tromboplastina parcial activada; APTT | X
CO | Fibrinógeno; Fibrinógeno derivado | X
CO | Dímero D; D-dímero | X
CO | Tiempo de trombina; TT | X
CO | Antitrombina; Antitrombina III; AT III | X
CO | Proteína C; Proteína C funcional | X
CO | Proteína S libre; Proteína S | X
CO | Resistencia a la proteína C activada; RPCA | X
CO | Anticoagulante lúpico; AL | X
CO | Factor II; F II | X
CO | Factor V; F V | X
CO | Factor VII; F VII | X
CO | Factor VIII; F VIII; Factor VIII coagulante | X
CO | Factor IX; F IX | X
CO | Factor X; F X | X
CO | Factor XI; F XI | X
CO | Factor XII; F XII | X
CO | Factor XIII; F XIII | X
CO | Factor von Willebrand antígeno; FvW antígeno; FvW Ag | X
CO | Factor von Willebrand actividad; FvW actividad | X
CO | Actividad anti-Xa; Anti-Xa; Heparina anti-Xa | X
CO | Agregación plaquetaria; Estudio de agregación | X
HO | TSH; Tirotropina | S
HO | T4 libre; FT4; Tiroxina libre | S
HO | T3 libre; FT3; Triyodotironina libre | S
HO | T4 total; Tiroxina total | S
HO | T3 total; Triyodotironina total | S
HO | Tiroglobulina; Tg | S
HO | Cortisol; Cortisol basal; Cortisolemia | S O24 SAL | matinal~8 h; vespertino~23 h; tras estímulo con ACTH~post-ACTH
HO | ACTH; Corticotropina | P
HO | Prolactina; PRL | S | tras reposo~en reposo
HO | Macroprolactina | S
HO | FSH; Hormona foliculoestimulante | S
HO | LH; Hormona luteinizante | S
HO | Estradiol; E2 | S
HO | Progesterona | S
HO | 17-hidroxiprogesterona; 17-OH progesterona | S
HO | Testosterona total; Testosterona | S
HO | Testosterona libre | S
HO | SHBG; Globulina transportadora de hormonas sexuales | S
HO | DHEA-S; DHEA sulfato | S
HO | Androstenodiona | S
HO | Hormona antimülleriana; AMH | S
HO | Beta-HCG; β-HCG; Gonadotropina coriónica | S O
HO | Hormona de crecimiento; GH | S | tras estímulo~post-estímulo
HO | IGF-1; Somatomedina C | S
HO | Insulina; Insulina basal | S | tras sobrecarga oral 2 h~post-SOG 2 h
HO | Péptido C | S O24
HO | Parathormona (PTH); PTH; PTH intacta | S
HO | Calcitonina | S
HO | Aldosterona | S O24 | en bipedestación~de pie
HO | Renina; Actividad de renina plasmática; ARP | P
HO | Gastrina | S
HO | Osteocalcina | S
VI | Vitamina B12; Cobalamina; B12 | S
VI | Ácido fólico; Folato; Fólico | S
VI | Folato intraeritrocitario; Fólico eritrocitario | SG
VI | Vitamina D (25-OH); 25-OH vitamina D; Vitamina D; Calcidiol | S
VI | 1,25-dihidroxivitamina D; Calcitriol | S
VI | Vitamina A; Retinol | S
VI | Vitamina E; Tocoferol | S
VI | Vitamina B1; Tiamina | SG
VI | Vitamina B6; Piridoxal fosfato | P
VI | Vitamina C; Ácido ascórbico | P
VI | Selenio; Se | S
VI | Plomo; Pb | SG
VI | Mercurio; Hg | SG O
VI | Arsénico; As | O
VI | Cadmio; Cd | SG O
VI | Aluminio; Al | S
VI | Cromo; Cr | S
VI | Manganeso; Mn | SG
VI | Cobalto; Co | SG
VI | Yodo; Yoduria | O
MT | PSA total; PSA; Antígeno prostático específico | S
MT | PSA libre; Cociente PSA libre/total | S
MT | CEA; Antígeno carcinoembrionario | S LP LA
MT | CA 125; CA-125 | S LP LA
MT | CA 19.9; CA 19-9; CA19.9 | S LP LA
MT | CA 15.3; CA 15-3 | S
MT | CA 72.4; CA 72-4 | S
MT | Alfa-fetoproteína; AFP | S
MT | Enolasa neuroespecífica; NSE | S
MT | Antígeno de carcinoma escamoso; SCC | S
MT | HE4; Proteína epididimal humana 4 | S
MT | Cromogranina A; CgA | S
BM | Factor V Leiden; Mutación factor V Leiden | X
BM | Mutación G20210A de protrombina; Protrombina G20210A | X
BM | MTHFR; Polimorfismo MTHFR | X
BM | HLA-B27; Tipaje HLA-B27 | X
BM | HLA-DQ2/DQ8; HLA celiaquía | X
BM | Fibrosis quística (CFTR); Estudio genético CFTR | X
BM | Hemocromatosis (HFE); Estudio genético HFE | X
BM | Cariotipo en sangre periférica; Cariotipo | X
BM | Síndrome X frágil; X frágil (FMR1) | X
BM | Síndrome de Gilbert (UGT1A1); UGT1A1 | X
BM | JAK2 V617F; Mutación JAK2 | X
BM | BCR-ABL; Reordenamiento BCR-ABL | X
BM | Talasemia alfa, estudio genético; Alfa-talasemia genética | X
BM | Talasemia beta, estudio genético; Beta-talasemia genética | X
BM | Intolerancia a la lactosa, estudio genético; Lactasa genética | X
BM | Genotipo APOE; APOE | X
BM | Atrofia muscular espinal (SMN1); SMN1 | X
BM | Polimorfismo CYP2C19; CYP2C19 | X
BM | Genotipo TPMT; TPMT | X
BM | Genotipo DPYD; DPYD | X
BM | Carga viral VIH; ARN VIH cuantitativo | X
BM | Carga viral VHC; ARN VHC cuantitativo | X
BM | Carga viral VHB; ADN VHB cuantitativo | X
BM | Carga viral CMV; ADN CMV cuantitativo | X
BM | Carga viral VEB; ADN VEB cuantitativo | X
BM | Genotipo VHC; Genotipado VHC | X
BM | Genotipado VPH; Virus del papiloma humano (VPH); VPH alto riesgo | X
OR | Sistemático de orina; Orina elemental; Anormales y sedimento; Tira reactiva de orina | X
OR | Sedimento urinario; Sedimento | X
OR | Seminograma; Espermiograma | X
OR | Test de embarazo en orina; Test de gestación | X
"""

# Serology: organism | short name for "Ac anti-..." forms (or -) | markers ("; ").
_SEROLOGY = """
Toxoplasma | Toxoplasma | IgG; IgM; IgG avidez
Rubéola | rubéola | IgG; IgM
Citomegalovirus | CMV | IgG; IgM; IgG avidez
Virus de Epstein-Barr | VEB | VCA IgG; VCA IgM; EBNA IgG
Herpes simple tipo 1 | VHS-1 | IgG
Herpes simple tipo 2 | VHS-2 | IgG
Herpes simple | VHS | IgM
Varicela zóster | VVZ | IgG; IgM
Sarampión | sarampión | IgG; IgM
Parotiditis | parotiditis | IgG; IgM
Parvovirus B19 | parvovirus | IgG; IgM
Hepatitis A | VHA | IgM; Ac totales
Hepatitis E | VHE | IgG; IgM
Borrelia burgdorferi | Borrelia | IgG; IgM
Mycoplasma pneumoniae | Mycoplasma | IgG; IgM
Chlamydophila pneumoniae | Chlamydophila | IgG; IgM
Coxiella burnetii | Coxiella | IgG fase II; IgM fase II
Rickettsia conorii | Rickettsia | IgG; IgM
Brucella | Brucella | Rosa de Bengala; aglutinación
Leishmania | Leishmania | Ac totales
Echinococcus granulosus | Echinococcus | Ac totales
Strongyloides stercoralis | Strongyloides | IgG
Helicobacter pylori | H. pylori | IgG
Trypanosoma cruzi | T. cruzi | Ac totales
Bartonella henselae | Bartonella | IgG
Dengue | dengue | IgG; IgM; NS1
Leptospira | Leptospira | IgM
HTLV I/II | HTLV | Ac totales
Aspergillus | Aspergillus | IgG; galactomanano
Candida | Candida | Ac totales
Toxocara canis | Toxocara | IgG
Taenia solium | Taenia | IgG
Schistosoma | Schistosoma | Ac totales
SARS-CoV-2 | SARS-CoV-2 | IgG anti-S; IgG anti-N
Treponema pallidum | Treponema | Ac treponémicos; RPR
"""

# Serology markers that are tests of their own, with their usual names.
_SEROLOGY_SINGLE = """
SE | Hepatitis B HBsAg; HBsAg; Antígeno de superficie VHB; Serología hepatitis B (HBsAg) | S
SE | Hepatitis B anti-HBs; Anti-HBs; Ac anti-HBs | S
SE | Hepatitis B anti-HBc totales; Anti-HBc; Ac anti-HBc totales | S
SE | Hepatitis B anti-HBc IgM; Anti-HBc IgM | S
SE | Hepatitis B HBeAg; HBeAg | S
SE | Hepatitis B anti-HBe; Anti-HBe | S
SE | Hepatitis C anti-VHC; Anti-VHC; Ac anti-VHC; Serología hepatitis C (anti-VHC) | S
SE | VIH 1+2 Ac y Ag p24; Serología VIH 1+2; VIH 1/2; Ac anti-VIH 1+2 | S
SE | Paul-Bunnell; Mononucleosis, test rápido; Monotest | S
SE | Antiestreptolisina O (ASLO); ASLO; ASO | S
SE | IGRA tuberculosis; Interferón gamma (IGRA); Test de liberación de interferón | X
"""

_AUTOIMMUNITY = """
Anticuerpos antinucleares (ANA); ANA; AAN; Ac antinucleares
Anticuerpos anti-DNA nativo; Anti-DNA nativo; Anti-dsDNA; Ac anti-dsDNA
Anticuerpos anti-ENA; ENA; Anti-ENA screening
Anti-Ro (SSA); Anti-Ro; Anti-SSA
Anti-La (SSB); Anti-La; Anti-SSB
Anti-Sm; Ac anti-Sm
Anti-RNP; Ac anti-RNP; Anti-U1-RNP
Anti-Scl-70; Ac anti-Scl-70; Antitopoisomerasa I
Anti-Jo-1; Ac anti-Jo-1
Anticuerpos anticentrómero; Anticentrómero; ACA
Anticuerpos anti-TPO; Anti-TPO; Ac antiperoxidasa; Antiperoxidasa tiroidea
Anticuerpos antitiroglobulina; Anti-TG; Antitiroglobulina
Anticuerpos anti-receptor de TSH; TRAb; Ac anti-receptor TSH
ANCA; Ac anticitoplasma de neutrófilo
Anti-MPO; ANCA MPO; Antimieloperoxidasa
Anti-PR3; ANCA PR3; Antiproteinasa 3
Anticuerpos antimembrana basal glomerular; Anti-MBG
Anticuerpos antimitocondriales; AMA; Antimitocondriales
Anticuerpos antimúsculo liso; ASMA; Antimúsculo liso
Anti-LKM1; Ac anti-LKM
Anticuerpos anticélulas parietales; Anticélulas parietales
Anticuerpos antifactor intrínseco; Antifactor intrínseco
Antitransglutaminasa IgA; Anti-tTG IgA; Ac antitransglutaminasa IgA
Antitransglutaminasa IgG; Anti-tTG IgG
Antigliadina deamidada IgA; Anti-PGD IgA; Antigliadina IgA
Antigliadina deamidada IgG; Anti-PGD IgG; Antigliadina IgG
Antiendomisio IgA; EMA; Ac antiendomisio
Anti-CCP; Ac antipéptido citrulinado; Anti-péptido cíclico citrulinado
Factor reumatoide; FR; Factor reumatoideo
Anticardiolipina IgG; aCL IgG
Anticardiolipina IgM; aCL IgM
Anti-beta2 glicoproteína I IgG; Anti-β2GPI IgG
Anti-beta2 glicoproteína I IgM; Anti-β2GPI IgM
Anticuerpos antirreceptor de acetilcolina; Anti-AChR
Anticuerpos antigangliósidos; Antigangliósidos
Anticuerpos antiacuaporina 4; Anti-AQP4
Anti-GAD; Ac antidescarboxilasa del ácido glutámico
Anti-IA2; Ac antitirosina fosfatasa
Inmunoglobulina A; IgA; IgA sérica
Inmunoglobulina G; IgG; IgG sérica
Inmunoglobulina M; IgM; IgM sérica
IgE total; Inmunoglobulina E; IgE
Subclases de IgG; IgG subclases
Complemento C3; C3; Fracción C3
Complemento C4; C4; Fracción C4
Complemento total (CH50); CH50
Crioglobulinas; Crioglobulinemia
Triptasa; Triptasa sérica
"""

_ALLERGENS = """
Dermatophagoides pteronyssinus; Dermatophagoides farinae; Lepidoglyphus destructor;
Tyrophagus putrescentiae; Blomia tropicalis; Acarus siro; Epitelio de gato; Epitelio de perro;
Epitelio de caballo; Epitelio de conejo; Epitelio de hámster; Epitelio de cobaya;
Epitelio de vaca; Plumas de ave; Polen de olivo; Polen de gramíneas; Phleum pratense;
Lolium perenne; Cynodon dactylon; Parietaria judaica; Salsola kali; Chenopodium album;
Artemisia vulgaris; Plátano de sombra; Ciprés; Pino; Abedul; Avellano; Aliso; Fresno;
Encina; Ambrosia; Plantago lanceolata; Mercurialis annua; Alternaria alternata;
Aspergillus fumigatus; Cladosporium herbarum; Penicillium notatum; Candida albicans;
Leche de vaca; Alfa-lactoalbúmina; Beta-lactoglobulina; Caseína; Clara de huevo;
Yema de huevo; Ovoalbúmina; Ovomucoide; Trigo; Cebada; Centeno; Maíz; Arroz; Soja;
Cacahuete; Avellana; Nuez; Almendra; Anacardo; Pistacho; Castaña; Sésamo; Mostaza;
Altramuz; Garbanzo; Lenteja; Guisante; Judía blanca; Melocotón; Manzana; Pera; Plátano;
Kiwi; Fresa; Naranja; Tomate; Melón; Sandía; Apio; Zanahoria; Ajo; Cebolla; Bacalao;
Merluza; Atún; Salmón; Sardina; Anisakis simplex; Gamba; Langostino; Cangrejo; Mejillón;
Almeja; Calamar; Pulpo; Ternera; Cerdo; Pollo; Cordero; Cacao; Café; Veneno de abeja;
Veneno de avispa Vespula; Veneno de avispa Polistes; Látex; Cucaracha; Pru p 3; Pru p 7;
Ara h 1; Ara h 2; Ara h 3; Ara h 8; Ara h 9; Cor a 8; Cor a 9; Cor a 14; Jug r 1; Gly m 4;
Tri a 14; Tri a 19; Gal d 1; Gal d 2; Bos d 4; Bos d 5; Bos d 8; Bet v 1; Bet v 2; Ole e 1;
Ole e 7; Ole e 9; Phl p 1; Phl p 5; Phl p 7; Phl p 12; Pla a 1; Pla a 3; Par j 2; Sal k 1;
Che a 1; Art v 1; Art v 3; Cup a 1; Der p 1; Der p 2; Der p 23; Fel d 1; Can f 1; Can f 5;
Alt a 1; Asp f 1; Ani s 1; Pen m 1; Hev b 6; Api m 1; Ves v 5; Pol d 5; Mal d 1; Act d 1
"""

# Culture sites and which kinds of study each one is sent for.
_MICRO_SITES = """
exudado faríngeo | C G H
exudado nasal | C
exudado ótico | C G H
exudado conjuntival | C G
exudado vaginal | C G H
exudado endocervical | C G
exudado uretral | C G
exudado de herida | C G
exudado rectal | C
exudado vaginorrectal | C
esputo | C G H M
aspirado bronquial | C G H M
lavado broncoalveolar | C G H M
líquido cefalorraquídeo | C G H M
líquido pleural | C G M
líquido articular | C G M
líquido ascítico | C G M
líquido peritoneal de diálisis | C G
semen | C
absceso | C G
punta de catéter | C
biopsia | C G H M
úlcera | C G
uña | H
piel | H
pelo | H
orina para micobacterias | M
"""

_MICRO_KINDS = {
    "C": ("Cultivo de {site}", "Cultivo {site}", "Cult. {site}"),
    "G": ("Tinción de Gram de {site}", "Gram {site}", "Gram de {site}"),
    "H": ("Cultivo de hongos de {site}", "Hongos {site}", "Cultivo micológico {site}"),
    "M": ("Cultivo de micobacterias de {site}", "Micobacterias {site}", "BK {site}"),
}

_MICRO_SINGLE = """
MI | Urocultivo; Cultivo de orina; Cultivo orina | X
MI | Coprocultivo; Cultivo de heces; Cultivo heces | X
MI | Hemocultivo; Hemocultivos; Cultivo de sangre | X
MI | Parásitos en heces; Estudio de parásitos; Parásitos | X
MI | Antígeno de H. pylori en heces; H. pylori en heces; Antígeno H. pylori | X
MI | Test del aliento con urea; Test del aliento; Urea espirada | X
MI | Toxina de Clostridioides difficile; Toxina C. difficile; C. difficile | X
MI | Antígeno de rotavirus; Rotavirus | X
MI | Antígeno de adenovirus en heces; Adenovirus heces | X
MI | Antígeno de Legionella en orina; Legionella orina | X
MI | Antígeno de neumococo en orina; Neumococo orina | X
MI | Antígeno rápido de Streptococcus pyogenes; Strep A rápido; Estreptococo grupo A | X
MI | Gota gruesa; Estudio de paludismo; Plasmodium | X
MI | Test de Graham; Oxiuros; Cinta adhesiva perianal | X
MI | Cultivo de Streptococcus agalactiae; Estreptococo grupo B; SGB | X
"""

_MOLECULAR_PCR = (
    "Chlamydia trachomatis",
    "Neisseria gonorrhoeae",
    "Mycoplasma genitalium",
    "Trichomonas vaginalis",
    "virus herpes simple",
    "enterovirus",
    "SARS-CoV-2",
    "gripe A y B",
    "virus respiratorio sincitial",
    "Bordetella pertussis",
    "Mycobacterium tuberculosis",
)

# Therapeutic drugs: name | specimen | variants. Drugs of abuse go in urine.
_DRUGS = """
Digoxina | S |
Vancomicina | S | valle~predosis; pico~postdosis
Gentamicina | S | valle~predosis; pico~postdosis
Amikacina | S | valle~predosis; pico~postdosis
Tobramicina | S | valle~predosis
Ácido valproico | S |
Carbamazepina | S |
Fenitoína | S |
Fenobarbital | S |
Levetiracetam | S |
Lamotrigina | S |
Topiramato | S |
Litio | S |
Ciclosporina | SG | valle~C0
Tacrolimus | SG |
Sirolimus | SG |
Everolimus | SG |
Metotrexato | S |
Teofilina | S |
Paracetamol | S |
Salicilatos | S |
Etanol | S |
Clozapina | S |
Amiodarona | S |
Voriconazol | S |
"""

_DRUGS_OF_ABUSE = (
    ("Cannabis", "Cannabinoides", "THC"),
    ("Cocaína", "Metabolitos de cocaína", "Benzoilecgonina"),
    ("Opiáceos", "Opiáceos en orina"),
    ("Anfetaminas", "Anfetaminas en orina"),
    ("Benzodiacepinas", "BZD"),
    ("Metadona", "Metadona en orina"),
    ("Barbitúricos", "Barbitúricos en orina"),
    ("Éxtasis (MDMA)", "MDMA", "Éxtasis"),
)

# Profiles: id | names (canonical first) | components as "analyte" or "analyte@specimen" |
# expandable (printed as a heading over its components).
_PROFILES = """
PF01 | Perfil hepático | GOT (AST); GPT (ALT); GGT; Fosfatasa alcalina; Bilirrubina total | yes
PF02 | Perfil lipídico | Colesterol total; Colesterol HDL; Colesterol LDL; Triglicéridos | yes
PF03 | Perfil renal | Urea; Creatinina; Ácido úrico | yes
PF04 | Perfil tiroideo | TSH; T4 libre | yes
PF05 | Estudio de coagulación | Tiempo de protrombina; INR; TTPA; Fibrinógeno | yes
PF06 | Estudio de anemia | Hierro; Ferritina; Transferrina; Vitamina B12; Ácido fólico | yes
PF07 | Iones | Sodio; Potasio; Cloro | yes
PF08 | Perfil hormonal femenino | FSH; LH; Estradiol; Progesterona; Prolactina | yes
PF09 | Inmunoglobulinas IgA, IgG, IgM | Inmunoglobulina A; Inmunoglobulina G; Inmunoglobulina M | no
PF10 | Complemento C3 y C4 | Complemento C3; Complemento C4 | no
PF11 | Perfil celíaco | Antitransglutaminasa IgA; Inmunoglobulina A | no
PF12 | Perfil de hepatitis B | Hepatitis B HBsAg; Hepatitis B anti-HBs; Hepatitis B anti-HBc totales | no
"""

# The tests most requests draw from, most frequent first: analyte names (default specimen)
# or profile ids.
_COMMON = (
    "Hemograma completo",
    "Glucosa",
    "Creatinina",
    "Colesterol total",
    "Triglicéridos",
    "GOT (AST)",
    "GPT (ALT)",
    "TSH",
    "Sistemático de orina",
    "Hemoglobina glicosilada (HbA1c)",
    "Velocidad de sedimentación (VSG)",
    "Urea",
    "Ácido úrico",
    "Colesterol HDL",
    "Colesterol LDL",
    "GGT",
    "Sodio",
    "Potasio",
    "Proteína C reactiva (PCR)",
    "Hierro",
    "Ferritina",
    "Vitamina B12",
    "Ácido fólico",
    "Vitamina D (25-OH)",
    "T4 libre",
    "Fosfatasa alcalina",
    "Bilirrubina total",
    "PSA total",
    "Sedimento urinario",
    "Urocultivo",
    "Calcio",
    "Albúmina",
    "Proteínas totales",
    "Tiempo de protrombina",
    "INR",
    "Fibrinógeno",
    "Cloro",
    "Fósforo",
    "Magnesio",
    "Transferrina",
    "Índice de saturación de transferrina",
    "Bilirrubina directa",
    "LDH",
    "CK",
    "Amilasa",
    "Lipasa",
    "T3 libre",
    "Anticuerpos anti-TPO",
    "Factor reumatoide",
    "Anticuerpos antinucleares (ANA)",
    "PF09",
    "PF10",
    "Cortisol",
    "Insulina",
    "Prolactina",
    "FSH",
    "LH",
    "Estradiol",
    "Progesterona",
    "Testosterona total",
    "PSA libre",
    "CEA",
    "CA 125",
    "CA 19.9",
    "Alfa-fetoproteína",
    "TTPA",
    "Grupo sanguíneo y Rh",
    "Hepatitis B HBsAg",
    "Hepatitis C anti-VHC",
    "VIH 1+2 Ac y Ag p24",
    "Treponema pallidum Ac treponémicos",
    "Rubéola IgG",
    "Toxoplasma IgG",
    "Microalbuminuria",
    "Coprocultivo",
    "Sangre oculta en heces",
    "Homocisteína",
    "Lactato",
    "Gasometría venosa",
    "Dímero D",
    "Antitransglutaminasa IgA",
    "Parathormona (PTH)",
    "NT-proBNP",
    "Troponina I",
)


# --------------------------------------------------------------------------- builder


@dataclass(frozen=True)
class _Analyte:
    section: str
    names: tuple[str, ...]
    specimens: tuple[str, ...]
    variants: tuple[tuple[str, ...], ...]


def _split(s: str, sep: str) -> tuple[str, ...]:
    return tuple(p.strip() for p in s.split(sep) if p.strip())


def _parse_analytes(block: str) -> list[_Analyte]:
    out = []
    for line in block.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        section, names, specs = parts[0], _split(parts[1], ";"), _split(parts[2], " ")
        variants = tuple(_split(v, "~") for v in _split(parts[3], ";")) if len(parts) > 3 else ()
        out.append(_Analyte(section, names, specs, variants))
    return out


def _families() -> list[_Analyte]:
    out = _parse_analytes(_ANALYTES)
    for line in _SEROLOGY.strip().splitlines():
        org, short, markers = (p.strip() for p in line.split("|"))
        for marker in _split(markers, ";"):
            names = [f"{org} {marker}", f"Serología {org[0].lower() + org[1:]} {marker}"]
            if short != org:
                names.append(f"{short[0].upper() + short[1:]} {marker}")
            if marker.startswith(("Ig", "VCA", "EBNA")):
                names.append(f"Ac anti-{short} {marker}")
            out.append(_Analyte("SE", tuple(dict.fromkeys(names)), ("S",), ()))
    out += _parse_analytes(_SEROLOGY_SINGLE)
    for line in _AUTOIMMUNITY.strip().splitlines():
        out.append(_Analyte("AI", _split(line, ";"), ("S",), ()))
    for allergen in _split(_ALLERGENS.replace("\n", " "), ";"):
        names = (
            f"IgE específica {allergen}",
            f"IgE {allergen}",
            f"{allergen} IgE",
            f"IgE esp. {allergen}",
        )
        out.append(_Analyte("AL", names, ("S",), ()))
    for line in _MICRO_SITES.strip().splitlines():
        site, kinds = (p.strip() for p in line.split("|"))
        for k in kinds.split():
            names = tuple(f.format(site=site) for f in _MICRO_KINDS[k])
            out.append(_Analyte("MI", names, ("X",), ()))
    out += _parse_analytes(_MICRO_SINGLE)
    for org in _MOLECULAR_PCR:
        names = (f"PCR de {org}", f"PCR {org}", f"Detección molecular de {org}")
        out.append(_Analyte("BM", names, ("X",), ()))
    for line in _DRUGS.strip().splitlines():
        drug, spec, variants = (p.strip() for p in line.split("|"))
        names = (drug, f"Niveles de {drug[0].lower() + drug[1:]}", f"{drug} niveles")
        var = tuple(_split(v, "~") for v in _split(variants, ";"))
        out.append(_Analyte("FA", names, (spec,), var))
    for names in _DRUGS_OF_ABUSE:
        out.append(_Analyte("FA", names, ("O",), ()))
    return out


def _lab_name(analyte: str, specimen: str, variant: tuple[str, ...]) -> str:
    name = f"{analyte} {variant[0]}" if variant else analyte
    label = SPECIMENS[specimen].label
    return f"{name}, {label}" if label else name


@cache
def build_catalog() -> Catalog:
    """The catalog. Deterministic: codes come from a fixed seed, not the dataset's."""
    rows: list[tuple[str, _Analyte, str, tuple[str, ...]]] = []
    for a in _families():
        for i, spec in enumerate(a.specimens):
            rows.append((a.section, a, spec, ()))
            if i == 0:
                rows += [(a.section, a, spec, v) for v in a.variants]

    by_section: dict[str, list[int]] = {}
    for k, (section, *_rest) in enumerate(rows):
        by_section.setdefault(section, []).append(k)
    codes: dict[int, str] = {}
    for section, ks in by_section.items():
        numbers = random.Random(f"{CODE_SEED}:{section}").sample(
            range(1, 10_000), len(ks)
        )
        for k, n in zip(ks, numbers, strict=True):
            codes[k] = f"{section}{n:04d}"

    tests = []
    seen: set[str] = set()
    for k, (section, a, spec, variant) in enumerate(rows):
        name = _lab_name(a.names[0], spec, variant)
        if name in seen:
            raise ValueError(f"duplicate catalog name {name!r}")
        seen.add(name)
        tests.append(
            LabTest(
                code=codes[k],
                name=name,
                section=section,
                analyte=a.names[0],
                names=a.names,
                specimen=spec,
                default_specimen=spec == a.specimens[0],
                variant=variant,
            )
        )

    partial = Catalog(tuple(tests), (), ())
    profiles = []
    for line in _PROFILES.strip().splitlines():
        pid, names, comps, expandable = (p.strip() for p in line.split("|"))
        codes_ = []
        for c in _split(comps, ";"):
            analyte, _, spec = c.partition("@")
            codes_.append(partial.find(analyte, spec or None).code)
        profiles.append(LabProfile(pid, _split(names, ";"), tuple(codes_), expandable == "yes"))

    pids = {p.id for p in profiles}
    common = tuple(c if c in pids else partial.find(c).code for c in _COMMON)
    return Catalog(tuple(tests), tuple(profiles), common)
