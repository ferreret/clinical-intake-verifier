"""Scoring the fusion engine against each document's LIS scenario (F4, block 3).

The fusion engine (``web/src/lib/fusion``) writes one ``<id>.fused.json`` per document and a
``fusion.json``. Every golden says which LIS records the document is about and where it
disagrees with them, so the traffic light can be checked:

- **links**: was the document linked to the right patient, physician and insurer? A link to
  the wrong record is the worst outcome, because it would paint another person's data green.
- **fields**: is every green value right? A green value is one the technician only has to
  approve; a wrong one would slip through.
- **discrepancies**: does every disagreement between the document and the LIS come out red?

What a field's right value is: what the document prints, except where the scenario says the
form has a typo (then the LIS's); and where the document prints nothing, the LIS's value of
the right record.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from ..schema import load_fields
from .compare import values_match
from .load import NOT_GOLDEN, LoadError

FUSION_FILE = "fusion.json"
FUSED_SUFFIX = ".fused.json"
FUSION_VERSIONS = frozenset({1})
STATES = ("green", "orange", "red", "grey")
RECORDS = ("patient", "physician", "insurer")


def _read(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _lis_values(lis: dict) -> dict[str, dict[str, dict[str, str | None]]]:
    """LIS values by record kind, record id and column, as fields.json names them."""

    def name(r: dict) -> str:
        return f"{r['first_name']} {r['last_name1']} {r['last_name2']}"

    return {
        "patient": {
            p["id"]: {
                "name": name(p),
                "birth_date": p["birth_date"],
                "sex": p["sex"],
                "doc_id": p["doc_id"],
                "phone": p["phone"],
            }
            for p in lis["patients"]
        },
        "physician": {
            m["id"]: {"name": name(m), "colegiado": m["colegiado"]} for m in lis["physicians"]
        },
        "insurer": {i["id"]: {"name": i["name"]} for i in lis["insurers"]},
    }


def _link_outcome(expected: str | None, link: dict) -> str:
    status, rid = link["status"], link["recordId"]
    if expected is None:
        return {"none": "correct_none", "linked": "wrong_link"}.get(status, "false_candidate")
    if status == "linked":
        return "linked" if rid == expected else "wrong_link"
    if status == "candidate":
        return "candidate_right" if rid == expected else "candidate_wrong"
    if status == "ambiguous":
        return "ambiguous_with_right" if expected in link["candidates"] else "candidate_wrong"
    return "missed"


def score_fused(golden: dict, fused: dict, lis: dict, spec: dict) -> dict:
    """The outcome of one fused document against its golden."""
    rec = golden["lis"]
    expected = {
        "patient": rec["patient_id"],
        "physician": rec["physician_id"],
        "insurer": rec["insurer_id"],
    }
    links = {k: _link_outcome(expected[k], fused["links"][k]) for k in RECORDS}

    fields_spec = {f["name"]: f for f in spec["fields"]}
    fields = []
    for f in fused["fields"]:
        fs = fields_spec[f["name"]]
        mode = fs["lis"]["compare"] if fs["lis"] else fs["compare"]
        lis_truth = None
        if fs["lis"]:
            kind, column = fs["lis"]["source"].split(".")
            record = lis[kind].get(expected[kind] or "")
            lis_truth = record[column] if record else None
        printed = golden["fields"][f["name"]]
        if rec["differs"] == f["name"] and rec["correct"] == "lis":
            truth = lis_truth
        elif printed is not None:
            truth = printed["value"]
        else:
            truth = lis_truth
        right = (
            f["value"] is not None and truth is not None and values_match(f["value"], truth, mode)
        )
        fields.append(
            {
                "field": f["name"],
                "state": f["state"],
                "reason": f["reason"],
                "value": f["value"],
                "truth": truth,
                "wrong_green": f["state"] == "green" and not right,
                "discrepancy": rec["differs"] == f["name"],
            }
        )
    return {"id": golden["id"], "scenario": rec["scenario"], "links": links, "fields": fields}


def load_fusion(
    fusion_dir: Path, golden_dir: Path | None
) -> tuple[dict, list[tuple[dict, dict]], dict]:
    """The manifest, (golden, fused) pairs and the LIS of a fusion directory."""
    manifest_file = fusion_dir / FUSION_FILE
    if not manifest_file.exists():
        raise LoadError(f"{fusion_dir} has no {FUSION_FILE}")
    manifest = _read(manifest_file)
    if manifest.get("fusion_version") not in FUSION_VERSIONS:
        raise LoadError(f"unsupported fusion_version {manifest.get('fusion_version')!r}")
    if golden_dir is None:
        from ..schema import repo_root

        golden_dir = repo_root() / manifest["source"]
    lis_file = golden_dir / "lis.json"
    if not lis_file.exists():
        raise LoadError(f"{golden_dir} has no lis.json")
    goldens = {
        p.name.removesuffix(".json"): p
        for p in golden_dir.glob("*.json")
        if p.name not in NOT_GOLDEN
    }
    pairs = []
    for doc in manifest["documents"]:
        if doc["id"] not in goldens:
            raise LoadError(f"no golden for {doc['id']} in {golden_dir}")
        fused = _read(fusion_dir / doc["fused"])
        golden = _read(goldens[doc["id"]])
        if fused["sha256"] != golden["sha256"]:
            raise LoadError(f"{doc['id']}: fused document and golden are of different PDFs")
        pairs.append((golden, fused))
    return manifest, pairs, _read(lis_file)


def evaluate_fusion(fusion_dir: Path, golden_dir: Path | None = None) -> dict:
    manifest, pairs, lis_json = load_fusion(fusion_dir, golden_dir)
    spec = load_fields()
    lis = _lis_values(lis_json)
    outcomes = [score_fused(g, f, lis, spec) for g, f in pairs]

    links = {k: dict(Counter(o["links"][k] for o in outcomes)) for k in RECORDS}
    all_fields = [f for o in outcomes for f in o["fields"]]
    states = dict(Counter(f["state"] for f in all_fields))
    wrong_green = [
        {"id": o["id"], "field": f["field"], "value": f["value"], "truth": f["truth"]}
        for o in outcomes
        for f in o["fields"]
        if f["wrong_green"]
    ]
    discrepancies = [(o, f) for o in outcomes for f in o["fields"] if f["discrepancy"]]
    false_conflicts = [
        {"id": o["id"], "field": f["field"]}
        for o in outcomes
        for f in o["fields"]
        if f["reason"] == "conflict" and not f["discrepancy"]
    ]
    by_scenario: dict[str, Counter] = {}
    for o in outcomes:
        c = by_scenario.setdefault(o["scenario"], Counter())
        c["documents"] += 1
        c.update(f["state"] for f in o["fields"])
    per_field: dict[str, Counter] = {}
    for f in all_fields:
        per_field.setdefault(f["field"], Counter())[f["state"]] += 1

    return {
        "fusion_id": manifest["fusion_id"],
        "predictions": manifest["predictions"],
        "documents": len(outcomes),
        "links": links,
        "wrong_links": sum(n for k in RECORDS for o, n in links[k].items() if o == "wrong_link"),
        "states": {s: states.get(s, 0) for s in STATES},
        "wrong_green": wrong_green,
        "discrepancies": {
            "total": len(discrepancies),
            "caught": sum(f["state"] == "red" for _, f in discrepancies),
            "missed": [
                {"id": o["id"], "field": f["field"], "state": f["state"]}
                for o, f in discrepancies
                if f["state"] != "red"
            ],
        },
        "false_conflicts": false_conflicts,
        "by_scenario": {
            s: {"documents": c["documents"], **{k: c.get(k, 0) for k in STATES}}
            for s, c in sorted(by_scenario.items())
        },
        "per_field": {name: {k: c.get(k, 0) for k in STATES} for name, c in per_field.items()},
        "outcomes": outcomes,
    }


def console_summary(r: dict) -> list[str]:
    def tally(d: dict) -> str:
        return ", ".join(f"{k} {v}" for k, v in sorted(d.items()))

    d = r["discrepancies"]
    s = r["states"]
    return [
        f"fusion {r['fusion_id']} ({r['predictions']}): {r['documents']} documents",
        f"  patient     : {tally(r['links']['patient'])}",
        f"  physician   : {tally(r['links']['physician'])}",
        f"  insurer     : {tally(r['links']['insurer'])}",
        f"  wrong links : {r['wrong_links']}",
        f"  fields      : green {s['green']}, orange {s['orange']}, red {s['red']}, grey {s['grey']}",
        f"  wrong green : {len(r['wrong_green'])}",
        f"  disagreements caught red: {d['caught']} of {d['total']}",
        f"  conflicts with no disagreement: {len(r['false_conflicts'])}",
    ]


def markdown(r: dict) -> str:
    lines = [f"# Fusion report {r['fusion_id']}", "", f"Predictions: {r['predictions']}.", ""]
    lines += ["## Summary", "", "```", *console_summary(r), "```", ""]
    lines += ["## States by scenario", "", "| Scenario | Documents | " + " | ".join(STATES) + " |"]
    lines += ["|---|---|" + "---|" * len(STATES)]
    for name, c in r["by_scenario"].items():
        lines.append(
            f"| {name} | {c['documents']} | " + " | ".join(str(c[k]) for k in STATES) + " |"
        )
    lines += ["", "## States by field", "", "| Field | " + " | ".join(STATES) + " |"]
    lines += ["|---|" + "---|" * len(STATES)]
    for name, c in r["per_field"].items():
        lines.append(f"| {name} | " + " | ".join(str(c[k]) for k in STATES) + " |")
    lines += ["", "## Wrong green values", ""]
    lines += [
        f"- {w['id']} {w['field']}: {w['value']!r}, should be {w['truth']!r}"
        for w in r["wrong_green"]
    ] or ["None."]
    lines += ["", "## Disagreements not marked red", ""]
    lines += [f"- {m['id']} {m['field']}: {m['state']}" for m in r["discrepancies"]["missed"]] or [
        "None."
    ]
    lines += ["", "## Conflicts with no disagreement", ""]
    lines += [f"- {c['id']} {c['field']}" for c in r["false_conflicts"]] or ["None."]
    return "\n".join(lines) + "\n"


def write_fusion_report(r: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "report.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(r, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    md = out_dir / "report.md"
    md.write_text(markdown(r), encoding="utf-8", newline="\n")
    return md
