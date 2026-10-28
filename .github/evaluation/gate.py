"""CI's evaluation gate: the reports of the recorded readings against floor.json.

    python3 .github/evaluation/gate.py <dir with eval-<run>/ and fusion-<run>/eval/>

Fails when a measure falls below its floor (precision, recall) or above its ceiling (the
counts: invented values, wrong links, wrong green, wrong values, disagreements missed), and
writes a table of every measure to the job's summary. Standard library only.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

FLOOR = Path(__file__).with_name("floor.json")


def measures(out: Path, run: str) -> dict[str, dict[str, float]]:
    extraction = json.loads((out / f"eval-{run}" / "report.json").read_text())
    fusion = json.loads((out / f"fusion-{run}" / "eval" / "report.json").read_text())
    total = extraction["fields"]["total"]
    return {
        "extraction": {
            "documents": extraction["documents"]["evaluated"],
            "precision": total["precision"],
            "recall": total["recall"],
            "invented": total["invented"],
        },
        "fusion": {
            "wrong_links": fusion["wrong_links"],
            "wrong_green": len(fusion["wrong_green"]),
            "wrong_values": len(fusion["wrong_values"]["items"]),
            "disagreements_missed": len(fusion["discrepancies"]["missed"]),
        },
    }


def main(out: Path) -> int:
    floor = json.loads(FLOOR.read_text())["runs"]
    rows, failed = [], []
    for run, stages in floor.items():
        got = measures(out, run)
        for stage, limits in stages.items():
            for name, limit in limits.items():
                value = got[stage][name]
                # Shares must not fall; counts must not rise; the document count must match.
                if name == "documents":
                    ok = value == limit
                elif name in ("precision", "recall"):
                    ok = value >= limit
                else:
                    ok = value <= limit
                shown = f"{value:.2%}" if isinstance(value, float) else str(value)
                bound = f"{limit:.2%}" if isinstance(limit, float) else str(limit)
                rows.append(f"| {run} | {stage} | {name} | {shown} | {bound} | {'✅' if ok else '❌'} |")
                if not ok:
                    failed.append(f"{run} {stage} {name}: {shown}, limit {bound}")

    table = "\n".join(["| Run | Stage | Measure | Value | Limit | |", "|---|---|---|---:|---:|:---:|", *rows])
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## Evaluation on the recorded readings\n\n" + table + "\n")
    print(table)
    for line in failed:
        print(f"::error title=Evaluation gate::{line}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
