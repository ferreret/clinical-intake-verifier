"""Scoring test mapping and its learning curve (F4, block 4).

``npm run map-simulate`` replays a dataset's requests in order with a simulated technician and
writes every line's proposal and outcome to ``lines.jsonl``. This module turns that into:

- the **learning curve**: per insurer, how the proposals change as its requests come in (the
  k-th request of that insurer), as the share of lines that are green, orange and red, and
  the technician's work (lines they had to correct or choose);
- **wrong green**: green lines whose codes are not the right ones, the error that slips
  through, which must stay at zero;
- **proposal precision** by layer (memory, other insurers' memory, catalog search);
- **recall@k** of the catalog search: whether the right codes are among its candidates at
  all, the ceiling for anything that chooses among them.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from .load import LoadError

MAPPING_FILE = "mapping.json"
LINES_FILE = "lines.jsonl"
MAPPING_VERSIONS = frozenset({1})
STATES = ("green", "orange", "red")

# Ranges of k, the position of a request among its insurer's requests.
BUCKETS: tuple[tuple[int, int | None], ...] = (
    (1, 1),
    (2, 5),
    (6, 10),
    (11, 25),
    (26, 50),
    (51, 100),
    (101, None),
)


def bucket_label(lo: int, hi: int | None) -> str:
    if hi is None:
        return f"{lo}+"
    return str(lo) if lo == hi else f"{lo}-{hi}"


def _bucket(k: int) -> str:
    for lo, hi in BUCKETS:
        if k >= lo and (hi is None or k <= hi):
            return bucket_label(lo, hi)
    raise ValueError(k)


def _rates(lines: list[dict]) -> dict:
    n = len(lines)
    states = Counter(x["state"] for x in lines)
    work = sum(x["action"] in ("correct", "choose") for x in lines)
    return {
        "lines": n,
        **{s: states.get(s, 0) for s in STATES},
        "green_pct": round(100 * states.get("green", 0) / n, 1) if n else None,
        "work_pct": round(100 * work / n, 1) if n else None,
        "wrong_green": sum(x["state"] == "green" and not x["proposed_right"] for x in lines),
    }


def _curve(lines: list[dict]) -> dict[str, dict]:
    by: dict[str, list[dict]] = {}
    for x in lines:
        by.setdefault(_bucket(x["k"]), []).append(x)
    order = [bucket_label(lo, hi) for lo, hi in BUCKETS]
    return {b: _rates(by[b]) for b in order if b in by}


def load_mapping(mapping_dir: Path) -> tuple[dict, list[dict]]:
    manifest_file = mapping_dir / MAPPING_FILE
    if not manifest_file.exists():
        raise LoadError(f"{mapping_dir} has no {MAPPING_FILE}")
    with open(manifest_file, encoding="utf-8") as fh:
        manifest = json.load(fh)
    if manifest.get("mapping_version") not in MAPPING_VERSIONS:
        raise LoadError(f"unsupported mapping_version {manifest.get('mapping_version')!r}")
    with open(mapping_dir / LINES_FILE, encoding="utf-8") as fh:
        lines = [json.loads(line) for line in fh if line.strip()]
    return manifest, lines


def evaluate_mapping(mapping_dir: Path) -> dict:
    manifest, lines = load_mapping(mapping_dir)
    by_source: dict[str, Counter] = {}
    for x in lines:
        if x["proposed"] is not None:
            c = by_source.setdefault(x["source"], Counter())
            c["proposed"] += 1
            c["right"] += bool(x["proposed_right"])
    languages = sorted({x["language"] for x in lines})
    scopes = sorted({x["scope"] for x in lines})
    multi = [x for x in lines if len(x["truth"]) > 1]

    return {
        "mapping_id": manifest["mapping_id"],
        "dataset": manifest["dataset"],
        "documents": manifest["documents"],
        "error_rate": manifest["error_rate"],
        "settings": {
            k: manifest[k]
            for k in ("green_approvals", "search_min_score", "search_min_lead", "candidates")
        },
        "total": _rates(lines),
        "wrong_green": [
            {
                "doc": x["doc"],
                "insurer": x["insurer"],
                "text": x["text"],
                "proposed": x["proposed"],
                "truth": x["truth"],
            }
            for x in lines
            if x["state"] == "green" and not x["proposed_right"]
        ],
        "precision_by_source": {
            s: {
                "proposed": c["proposed"],
                "right": c["right"],
                "pct": round(100 * c["right"] / c["proposed"], 1),
            }
            for s, c in sorted(by_source.items())
        },
        "recall_at_k": {
            lang: round(
                100
                * sum(x["in_candidates"] for x in lines if x["language"] == lang)
                / sum(x["language"] == lang for x in lines),
                1,
            )
            for lang in languages
        },
        "profile_lines": {
            "lines": len(multi),
            "in_candidates": sum(x["in_candidates"] for x in multi),
            "green": sum(x["state"] == "green" for x in multi),
        },
        "curve": _curve(lines),
        "curve_by_language": {
            lang: _curve([x for x in lines if x["language"] == lang]) for lang in languages
        },
        "curve_by_insurer": {s: _curve([x for x in lines if x["scope"] == s]) for s in scopes},
        "model": _model(manifest.get("model"), lines),
        "insurers": {
            s: next(x["insurer"] for x in lines if x["scope"] == s) or "(no insurer)"
            for s in scopes
        },
    }


def _model(info: dict | None, lines: list[dict]) -> dict | None:
    """What the model layer did and cost, when the run had one."""
    if not info:
        return None
    sent = [x for x in lines if x.get("model_called")]
    answered = [x for x in sent if x["model_codes"] is not None]
    right = sum(x["model_codes"] == x["truth"] for x in answered)
    fresh = info["calls"] - info["cached_calls"]
    return {
        **info,
        "lines_answered": len(answered),
        "lines_right": right,
        "precision": round(100 * right / len(answered), 1) if answered else None,
        "calls_per_100_documents": round(100 * info["calls"] / len({x["doc"] for x in lines}), 1),
        "ms_per_uncached_call": round(info["latency_ms"] / fresh) if fresh else None,
    }


def console_summary(r: dict) -> list[str]:
    t = r["total"]
    curve = "  ".join(f"{b}:{c['green_pct']}%/{c['work_pct']}%" for b, c in r["curve"].items())
    prec = ", ".join(
        f"{s} {p['right']}/{p['proposed']}" for s, p in r["precision_by_source"].items()
    )
    recall = ", ".join(f"{lang} {pct}%" for lang, pct in r["recall_at_k"].items())
    out = [
        f"mapping {r['mapping_id']}: {r['documents']} documents, {t['lines']} lines, technician error rate {r['error_rate']}",
        f"  states       : green {t['green']}, orange {t['orange']}, red {t['red']}",
        f"  wrong green  : {t['wrong_green']}",
        f"  technician   : corrected or chose {t['work_pct']}% of lines",
        f"  proposals    : {prec}",
        f"  recall@{r['settings']['candidates']}    : {recall}",
        f"  curve (k: green / work): {curve}",
    ]
    m = r.get("model")
    if m:
        out.append(
            f"  model        : {m['provider']} {m['name']}, policy {m['policy']}: "
            f"{m['calls']} calls ({m['calls_per_100_documents']} per 100 documents), "
            f"{m['lines_sent']} lines sent, {m['lines_answered']} answered, "
            f"{m['lines_right']} right ({m['precision']}%), "
            f"{m['input_tokens']} in / {m['output_tokens']} out tokens, "
            f"{m['ms_per_uncached_call']} ms per uncached call"
        )
    return out


def markdown(r: dict) -> str:
    out = [f"# Mapping report {r['mapping_id']}", ""]
    out += ["```", *console_summary(r), "```", ""]

    def table(title: str, curve: dict) -> list[str]:
        rows = [
            f"### {title}",
            "",
            "| Request k | Lines | Green | Orange | Red | Green % | Work % | Wrong green |",
        ]
        rows.append("|---|---|---|---|---|---|---|---|")
        for b, c in curve.items():
            rows.append(
                f"| {b} | {c['lines']} | {c['green']} | {c['orange']} | {c['red']} | "
                f"{c['green_pct']} | {c['work_pct']} | {c['wrong_green']} |"
            )
        return [*rows, ""]

    out += ["## Learning curve", "", "Work: lines the technician had to correct or choose.", ""]
    out += table("All insurers", r["curve"])
    for lang, curve in r["curve_by_language"].items():
        out += table(f"Language: {lang}", curve)
    for scope, curve in r["curve_by_insurer"].items():
        out += table(f"{r['insurers'][scope]} ({scope})", curve)
    out += ["## Wrong green lines", ""]
    out += [
        f"- {w['doc']} {w['insurer']}: {w['text']!r} proposed {w['proposed']}, right {w['truth']}"
        for w in r["wrong_green"]
    ] or ["None."]
    return "\n".join(out) + "\n"


def write_mapping_report(r: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "report.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(r, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    md = out_dir / "report.md"
    md.write_text(markdown(r), encoding="utf-8", newline="\n")
    return md
