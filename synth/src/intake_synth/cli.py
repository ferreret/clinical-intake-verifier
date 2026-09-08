"""``intake-synth`` command line."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Annotated

import typer

from . import __version__
from .generate import catalog
from .generate.pipeline import MANIFEST_NAME, GenerateOptions, generate_batch
from .schema import field_names, repo_root, validate_golden

app = typer.Typer(
    help="Synthetic lab-request generator and evaluation harness for clinical-intake-verifier.",
    no_args_is_help=True,
    add_completion=False,
)


def _version(value: bool) -> None:
    if value:
        typer.echo(f"intake-synth {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option("--version", callback=_version, is_eager=True, help="Show version and exit."),
    ] = False,
) -> None:
    pass


@app.command()
def generate(
    n: Annotated[int, typer.Option("--n", "-n", min=1, help="Number of documents.")] = 20,
    seed: Annotated[int, typer.Option(min=0, help="Global seed. Same seed, same documents.")] = 42,
    out: Annotated[
        Path | None, typer.Option(help="Output directory. Default: <repo>/data/synth/seed-<seed>.")
    ] = None,
    scan_ratio: Annotated[
        float,
        typer.Option(min=0.0, max=1.0, help="Fraction passed through the scanner simulation."),
    ] = 0.5,
    handwriting_ratio: Annotated[
        float, typer.Option(min=0.0, max=1.0, help="Fraction with some handwritten fields.")
    ] = 0.4,
    templates: Annotated[
        str, typer.Option(help="Comma-separated template names, or 'all'.")
    ] = "all",
    only_index: Annotated[
        int | None, typer.Option(min=0, help="Regenerate a single document index.")
    ] = None,
    start: Annotated[
        int, typer.Option(min=0, help="First index (documents are start..start+n-1).")
    ] = 0,
    dpi: Annotated[
        int, typer.Option(min=72, help="Raster resolution for scanned documents.")
    ] = 200,
    overwrite: Annotated[
        bool, typer.Option(help="Allow writing into a non-empty directory.")
    ] = False,
) -> None:
    """Generate N synthetic lab requests (PDF + golden JSON) plus a manifest."""
    if templates == "all":
        chosen = catalog.TEMPLATE_NAMES
    else:
        chosen = tuple(t.strip() for t in templates.split(",") if t.strip())
        unknown = [t for t in chosen if t not in catalog.TEMPLATE_NAMES]
        if unknown:
            raise typer.BadParameter(
                f"unknown template(s) {unknown}; choose from {list(catalog.TEMPLATE_NAMES)}"
            )

    out_dir = out or (repo_root() / "data" / "synth" / f"seed-{seed}")
    if out_dir.exists() and any(out_dir.iterdir()) and not overwrite and only_index is None:
        raise typer.BadParameter(f"{out_dir} is not empty; pass --overwrite to write into it")

    opts = GenerateOptions(
        seed=seed,
        scan_ratio=scan_ratio,
        templates=chosen,
        dpi=dpi,
        handwriting_ratio=handwriting_ratio,
    )
    indices = [only_index] if only_index is not None else range(start, start + n)

    def progress(doc) -> None:
        flags = ("scan" if doc.scanned else "clean") + (
            " hand" if doc.golden["generator"]["handwritten_fields"] else ""
        )
        roles = ",".join(p["role"] for p in doc.golden["pages"])
        typer.echo(
            f"  {doc.id}  {doc.template:<17} {flags:<11} tests={len(doc.golden['tests']):>2}"
            f"  pages={doc.page_count} [{roles}]"
        )

    typer.echo(f"Generating {len(indices)} document(s) with seed {seed} into {out_dir}")
    manifest = generate_batch(indices, opts, out_dir, progress=progress)
    _summary(manifest, out_dir)


def _summary(manifest: dict, out_dir: Path) -> None:
    docs = manifest["documents"]
    by_template = Counter(d["template"] for d in docs)
    scanned = sum(1 for d in docs if d["scanned"])
    handwritten = sum(1 for d in docs if d["handwritten_fields"])
    typer.echo("")
    typer.echo(f"Wrote {len(docs)} documents + {MANIFEST_NAME}")
    typer.echo("  templates : " + ", ".join(f"{k}={v}" for k, v in sorted(by_template.items())))
    typer.echo(f"  scanned   : {scanned}/{len(docs)}")
    typer.echo(f"  handwriting: {handwritten}/{len(docs)}")
    by_pages = Counter(d["pages"] for d in docs)
    typer.echo("  pages     : " + ", ".join(f"{k}p={v}" for k, v in sorted(by_pages.items())))
    request_first = sum(1 for d in docs if d["roles"][0] == "request")
    typer.echo(f"  request on page 1: {request_first}/{len(docs)}")

    null_counts: Counter[str] = Counter()
    for d in docs:
        with open(out_dir / d["golden"], encoding="utf-8") as fh:
            g = json.load(fh)
        for name, v in g["fields"].items():
            if v is None:
                null_counts[name] += 1
    absent = [f"{k}={v}" for k, v in null_counts.most_common() if v]
    if absent:
        typer.echo("  absent    : " + ", ".join(absent))


@app.command("debug-boxes")
def debug_boxes(
    golden: Annotated[
        Path, typer.Argument(exists=True, dir_okay=False, help="Path to a golden .json")
    ],
    out: Annotated[
        Path | None,
        typer.Option(help="Output directory for the PNGs. Default: next to the golden."),
    ] = None,
    dpi: Annotated[int, typer.Option(min=50)] = 110,
) -> None:
    """Render a document with its golden boxes painted on top (red=field, orange=also_at, blue=test)."""
    from .debug import draw_boxes

    for p in draw_boxes(golden, out, dpi=dpi):
        typer.echo(str(p))


@app.command()
def validate(
    path: Annotated[
        Path, typer.Argument(exists=True, help="A golden .json or a directory of them.")
    ],
) -> None:
    """Validate golden files against schema/golden.schema.json and check PDF hashes."""
    files = sorted(path.glob("synth-*.json")) if path.is_dir() else [path]
    if not files:
        typer.echo("no golden files found", err=True)
        raise typer.Exit(code=1)
    names = set(field_names())
    failures = 0
    for f in files:
        with open(f, encoding="utf-8") as fh:
            g = json.load(fh)
        errors = validate_golden(g)
        if set(g.get("fields", {})) != names:
            errors.append("fields: keys do not match schema/fields.json")
        pdf = f.parent / g.get("file", "")
        if not pdf.exists():
            errors.append(f"file: {pdf.name} missing")
        elif hashlib.sha256(pdf.read_bytes()).hexdigest() != g.get("sha256"):
            errors.append("sha256: PDF does not match golden")
        if errors:
            failures += 1
            typer.echo(f"FAIL {f.name}")
            for e in errors:
                typer.echo(f"     {e}")
    typer.echo(f"{len(files) - failures}/{len(files)} golden files valid")
    if failures:
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
