"""A/B scorer (t70 chunk 1): verbatim marker presence per output.

Markers are the KNOWN error strings (frozen in AB_PREDICTIONS.md).
Prints per-pair verdicts + arm totals. Hand verification of every short
output was done separately (see AB_REPORT.md); this is the mechanical pass.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MARKERS = {1: "非常", 2: "在 нодах", 3: "在 G8", 4: "和 почему",
           5: "在 машинном", 6: "更长", 7: "28", 8: "exit 6",
           9: "30", 10: "WrForum-trusted"}


def main() -> None:
    out = json.loads((HERE / "AB_OUTPUTS.json").read_text(encoding="utf-8"))
    totals = {"A": 0, "B": 0}
    for n in range(1, 11):
        row = {}
        for arm in ("A", "B"):
            hit = MARKERS[n] in out[arm][str(n)]
            row[arm] = int(hit)
            totals[arm] += int(hit)
        print(f"pair {n:2d} marker={MARKERS[n]!r:22s} A={row['A']} B={row['B']}")
    print(f"TOTAL A={totals['A']}/10 B={totals['B']}/10")
    return 0


if __name__ == "__main__":
    sys.exit(main())
