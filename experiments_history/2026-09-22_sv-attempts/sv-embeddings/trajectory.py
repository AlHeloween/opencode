"""The picture, as a number: does the SV trajectory WALK through the space, or ricochet?

The overlay map shows ~50 SV anchors joined in order, drawn over the CoT embedding clouds. Visually
the segments are long chords between clusters, not short local steps — a pinball, not a walk. That
impression is measurable without any new embedding: sv_map_data.json carries the projected
coordinates of every anchor (`wx`/`wy` for the keyword space, `dx`/`dy` for the dominant), so:

    median distance between CONSECUTIVE anchors   vs   median distance between RANDOM anchor pairs

If the ratio is ~1, consecutive anchors are no closer than strangers and the trajectory carries no
continuity at all — the map is then a scatter with a line drawn through it, which is exactly what
the numeric measurements said from the other side (term-L1 median 2.0 of a 0..2 range).

Run: python experiments/2026-09-22_sv-embeddings/trajectory.py
"""

import json
import random
import statistics
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "2026-08-16_cot-semantic-map"


def main() -> int:
    payload = json.loads((SOURCE / "sv_map_data.json").read_text(encoding="utf-8"))
    points = payload.get("points", [])
    if len(points) < 5:
        print(f"not enough anchors: {len(points)}")
        return 1

    def distance(a: dict, b: dict, prefix: str) -> float:
        dx = a[f"{prefix}x"] - b[f"{prefix}x"]
        dy = a[f"{prefix}y"] - b[f"{prefix}y"]
        return (dx * dx + dy * dy) ** 0.5

    for prefix, label in (("w", "keyword space"), ("d", "dominant")):
        consecutive = [
            distance(points[i - 1], points[i], prefix) for i in range(1, len(points))
        ]
        random.seed(20260922)
        strangers = [
            distance(random.choice(points), random.choice(points), prefix) for _ in range(3000)
        ]
        # A 2-D projection of session text: the cloud's own diameter is the natural yardstick.
        xs = [p[f"{prefix}x"] for p in points]
        ys = [p[f"{prefix}y"] for p in points]
        spread = ((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2) ** 0.5

        near = sum(1 for value in consecutive if value < spread * 0.1)
        print(f"\n{label} ({prefix}-coordinates), {len(points)} anchors")
        print(f"  cloud spread (corner to corner) : {spread:.3f}")
        print(f"  consecutive: median {statistics.median(consecutive):.3f} / max {max(consecutive):.3f}")
        print(f"  strangers  : median {statistics.median(strangers):.3f} / max {max(strangers):.3f}")
        ratio = statistics.median(consecutive) / statistics.median(strangers)
        print(f"  RATIO consecutive/strangers     : {ratio:.3f}")
        print(f"  steps shorter than 1/10 of the cloud: {near} of {len(consecutive)}")
        verdict = (
            "RICOCHET — consecutive anchors are no closer than strangers; the line on the map is a "
            "scatter joined up"
            if ratio > 0.75
            else "WALK — consecutive anchors stay local, so the trajectory carries continuity"
        )
        print(f"  verdict: {verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
