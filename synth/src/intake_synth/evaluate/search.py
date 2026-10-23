"""Comparing catalog searches on the same lines (F4, block 5a).

``npm run search-compare`` ranks the catalog for every distinct (insurer, line) of a dataset
with each search method and records where the right codes landed and the best two scores.
Methods are compared two ways:

- **ranking**: how often the right codes are first (recall@1), among the first 5 and among
  the 20 candidates, and the mean reciprocal rank;
- **at matched precision**: a search proposes its first candidate when its score reaches a
  minimum and leads the second by a margin. Scores of different methods live on different
  scales, so each method's thresholds are swept, and the methods are compared by how many
  lines they can propose (coverage) at the same share of right proposals (precision). A
  method that proposes more lines at the same precision leaves the technician fewer red
  lines; one that only wins at a lower precision is not better, just bolder.

Thresholds chosen on the lines they are then measured on flatter every method. So the lines
are split in order of first appearance: thresholds are chosen on the first half and measured
on the second, the way they would be chosen on past requests and used on new ones.
"""

from __future__ import annotations

import json
from pathlib import Path

from .load import LoadError

SEARCH_FILE = "search.json"
LINES_FILE = "lines.jsonl"
TARGETS = (0.95, 0.976, 0.99, 0.995)
SCORES = [round(0.01 * i, 2) for i in range(101)]
LEADS = [round(0.005 * i, 3) for i in range(61)]


def load_search(search_dir: Path) -> tuple[dict, list[dict]]:
    manifest_file = search_dir / SEARCH_FILE
    if not manifest_file.exists():
        raise LoadError(f"{search_dir} has no {SEARCH_FILE}")
    with open(manifest_file, encoding="utf-8") as fh:
        manifest = json.load(fh)
    with open(search_dir / LINES_FILE, encoding="utf-8") as fh:
        lines = [json.loads(line) for line in fh if line.strip()]
    return manifest, lines


def ranking(lines: list[dict], method: str) -> dict:
    n = len(lines)
    ranks = [x["methods"][method]["rank"] for x in lines]
    return {
        "lines": n,
        "recall_at_1": round(100 * sum(r == 1 for r in ranks) / n, 1),
        "recall_at_5": round(100 * sum(r is not None and r <= 5 for r in ranks) / n, 1),
        "recall_at_20": round(100 * sum(r is not None for r in ranks) / n, 1),
        "mrr": round(sum(1 / r for r in ranks if r) / n, 3),
    }


def operating_point(lines: list[dict], method: str, min_score: float, min_lead: float) -> dict:
    proposed = right = 0
    for x in lines:
        m = x["methods"][method]
        if m["top1"] >= min_score and m["top1"] - m["top2"] >= min_lead:
            proposed += 1
            right += m["top1_right"]
    return {
        "min_score": min_score,
        "min_lead": min_lead,
        "proposed": proposed,
        "right": right,
        "coverage": round(100 * proposed / len(lines), 1),
        "precision": round(100 * right / proposed, 2) if proposed else None,
    }


def best_at(lines: list[dict], method: str, target: float) -> dict | None:
    """The thresholds that propose the most lines with precision at least ``target``."""
    best = None
    for s in SCORES:
        for lead in LEADS:
            p = operating_point(lines, method, s, lead)
            if not p["proposed"] or p["right"] / p["proposed"] < target:
                continue
            if best is None or p["proposed"] > best["proposed"]:
                best = p
    return best


def evaluate_search(search_dir: Path, lexical_point: tuple[float, float] = (0.55, 0.05)) -> dict:
    manifest, lines = load_search(search_dir)
    methods = manifest["methods"]
    groups = {
        "all": lines,
        **{
            f"language {lang}": [x for x in lines if x["language"] == lang]
            for lang in sorted({x["language"] for x in lines})
        },
        "profiles": [x for x in lines if len(x["truth"]) > 1],
    }
    return {
        "search_id": manifest["search_id"],
        "dataset": manifest["dataset"],
        "lines": len(lines),
        "embedding_model": manifest["embedding_model"],
        "ms_per_line": manifest["ms_per_line"],
        "ranking": {g: {m: ranking(ls, m) for m in methods} for g, ls in groups.items() if ls},
        "block4_point": operating_point(lines, "lexical", *lexical_point),
        "at_precision": {str(t): {m: best_at(lines, m, t) for m in methods} for t in TARGETS},
        "held_out": held_out(lines, methods, lexical_point),
    }


def held_out(lines: list[dict], methods: list[str], lexical_point: tuple[float, float]) -> dict:
    """Thresholds chosen on the first half of the lines, measured on the second."""
    half = len(lines) // 2
    tune, test = lines[:half], lines[half:]
    out: dict = {
        "tune_lines": len(tune),
        "test_lines": len(test),
        "block4_point": operating_point(test, "lexical", *lexical_point),
        "targets": {},
    }
    for t in TARGETS:
        row = {}
        for m in methods:
            chosen = best_at(tune, m, t)
            row[m] = (
                operating_point(test, m, chosen["min_score"], chosen["min_lead"])
                if chosen
                else None
            )
        out["targets"][str(t)] = row
    return out


def console_summary(r: dict) -> list[str]:
    out = [
        f"search {r['search_id']}: {r['lines']} distinct lines, embeddings {r['embedding_model']}"
    ]
    for group, by_method in r["ranking"].items():
        cells = "  ".join(
            f"{m} R@1 {v['recall_at_1']} R@20 {v['recall_at_20']}" for m, v in by_method.items()
        )
        out.append(f"  {group:12s}: {cells}")
    b = r["block4_point"]
    out.append(
        f"  block 4 lexical point (score {b['min_score']}, lead {b['min_lead']}): "
        f"proposes {b['coverage']}% at {b['precision']}%"
    )
    for t, by_method in r["at_precision"].items():
        cells = "  ".join(
            f"{m} {p['coverage']}% (s {p['min_score']}, l {p['min_lead']})" if p else f"{m} -"
            for m, p in by_method.items()
        )
        out.append(f"  coverage at precision >= {float(t) * 100:g}%: {cells}")
    h = r["held_out"]
    b = h["block4_point"]
    out.append(
        f"  held out ({h['tune_lines']} lines to choose thresholds, {h['test_lines']} to measure); "
        f"block 4 point there: {b['coverage']}% at {b['precision']}%"
    )
    for t, by_method in h["targets"].items():
        cells = "  ".join(
            f"{m} {p['coverage']}% at {p['precision']}%" if p else f"{m} -"
            for m, p in by_method.items()
        )
        out.append(f"    aimed at >= {float(t) * 100:g}%: {cells}")
    return out


def markdown(r: dict) -> str:
    out = [f"# Search comparison {r['search_id']}", "", "```", *console_summary(r), "```", ""]
    out += ["## Ranking", ""]
    for group, by_method in r["ranking"].items():
        out += [
            f"### {group}",
            "",
            "| Method | Lines | R@1 | R@5 | R@20 | MRR |",
            "|---|---|---|---|---|---|",
        ]
        for m, v in by_method.items():
            out.append(
                f"| {m} | {v['lines']} | {v['recall_at_1']} | {v['recall_at_5']} | {v['recall_at_20']} | {v['mrr']} |"
            )
        out.append("")
    out += [
        "## Coverage at matched precision",
        "",
        "| Precision ≥ | Method | Coverage % | Proposed | Right | Min score | Min lead |",
    ]
    out.append("|---|---|---|---|---|---|---|")
    for t, by_method in r["at_precision"].items():
        for m, p in by_method.items():
            if p:
                out.append(
                    f"| {float(t) * 100:g}% | {m} | {p['coverage']} | {p['proposed']} | {p['right']} | {p['min_score']} | {p['min_lead']} |"
                )
            else:
                out.append(f"| {float(t) * 100:g}% | {m} | – | – | – | – | – |")
    return "\n".join(out) + "\n"


def write_search_report(r: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "report.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(r, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    md = out_dir / "report.md"
    md.write_text(markdown(r), encoding="utf-8", newline="\n")
    return md
