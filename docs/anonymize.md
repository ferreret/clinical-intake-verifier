# Anonymizing real request scans

Tools for one job: turning scans of real requests into documents a demo can show, with the
patient's and the physician's data replaced by fictitious data and nothing of the original left
underneath. The scans themselves never enter the repository (CLAUDE.md, rule 1); everything
these commands read and write lives in a folder the caller names, outside version control
(`samples_real/` is ignored and outside the image). Why the project has real requests at all is
in the roadmap, entry of 2026-11-18.

## The plan of a document

Each document gets a plan, `<work>/plans/<doc>.json`: the regions to cover and what to write
in each. A box has a page, coordinates as fractions of the page (origin at the top left, as in
the golden and the predictions), a kind and a style:

| Kind | What is written |
|---|---|
| A personal field (`Paciente`, `FechaNacimiento`, `DocumentoIdentidad`, `Telefono`, `NumeroTarjeta`, `NombreMedico`, `NumeroColegiado`, `NumeroPeticion`, `NumeroSolicitudMutua`, `NumeroAutorizacion`) | The plan's fictitious value for that field, unless the box gives its own text |
| `Otro` | The box's own text: any other personal data (an address, an e-mail, a record number) |
| `Tapar` | Nothing: the region is covered (signatures, stamps, labels, photos of cards) |

A value printed in parts, such as surnames and name on lines of their own, gets a box per
part, each of the field's kind with its part as text; the truth then records the whole value.

The style is `print` or `hand`; a document's handwriting is one of the two handwriting fonts the
generator already uses, the same for all its boxes.

The fictitious values (`identity`) are drawn once per document, from a generator seeded with
its name, in the shape of the values they replace: a DNI written with a hyphen gets a valid DNI
with a hyphen, a NIE stays a NIE, a name keeps its order, comma and case, a birth date keeps its
writing and moves less than half a year, so the age the tests depend on barely changes, and
reference numbers keep their letters and separators with new digits. The insurer's name, the
tests and everything else on the page are left as they are.

## Steps

```bash
cd synth
# 1. A first plan per document, from an extractor run's boxes (or golden files).
uv run intake-synth anon-propose --docs <pdfs> --readings <run> [--work <dir>]
# 2. Review every plan in the browser, on 127.0.0.1 only.
uv run intake-synth anon-review --docs <pdfs> [--work <dir>] [--info manifest.tsv]
# 3. Write the anonymized PDF of every reviewed plan.
uv run intake-synth anon-apply --docs <pdfs> [--work <dir>]
```

The work folder defaults to `<pdfs>/../anon`. `.claude/launch.json` has an `anon-review`
entry for the handwritten set.

**Proposing** turns the extractor's box of each personal field into a box of that kind (a
golden also lists the other places a value is printed). It never replaces a plan that exists,
reviewed or not, unless told to with `--overwrite`. A document whose reading failed gets no
plan, which would otherwise stay empty: read it again, then propose again. The extractor
gives one box per field; the rest is the reviewer's: other occurrences of a value,
signatures, stamps, labels, photos of cards, names in a letterhead.

**Reviewing.** The page lists the documents, shows each page with its boxes and the document's
fictitious values, and saves on every change. Drag on a page to draw a box; drag a box to move
it, its corner to resize it. Keys: `j`/`k` next and previous document, `Delete` removes the box,
`m` switches print and handwriting, `t` makes it a cover, `1`–`9` set its kind, the arrows move
it (with `Shift`, resize it), `v` shows the page as it will be written, `r` marks the document
reviewed. Only reviewed plans are applied.

**Applying** renders every page at 300 dpi, fills each box with the paper's colour taken around
it, writes its text in the ink colour found inside it, and rebuilds the PDF from the images
alone: no text layer, no original image under the paint, no metadata. A bilevel scan stays
bilevel (CCITT); others are stored as JPEG. Beside each PDF, `<doc>.truth.json` records what
was written where: the fictitious values are the reference for the personal fields when the
anonymized document is measured.

## What a person still checks

The tools do not find personal data on their own beyond the extractor's fields. Before a plan
is marked reviewed, every page is looked at in the preview: names in signatures and stamps,
labels with the request number, photos of insurance cards, handwriting in the margins.
