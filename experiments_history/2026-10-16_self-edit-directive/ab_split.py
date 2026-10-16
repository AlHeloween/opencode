"""Split AB_PAIRS.json into arm files without cross-contamination.

AB_ARM_A.json: n, a_replay, prompt only (no markers, no errata).
AB_ARM_B.json: n, b_replay, prompt only (erratum lives inside b_replay —
that IS the mechanism under test).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> None:
    data = json.loads((HERE / "AB_PAIRS.json").read_text(encoding="utf-8"))
    a = [{"n": p["n"], "a_replay": p["a_replay"], "prompt": p["prompt"]}
         for p in data["pairs"]]
    b = [{"n": p["n"], "b_replay": p["b_replay"], "prompt": p["prompt"]}
         for p in data["pairs"]]
    (HERE / "AB_ARM_A.json").write_text(
        json.dumps({"pairs": a}, indent=1, ensure_ascii=False), encoding="utf-8")
    (HERE / "AB_ARM_B.json").write_text(
        json.dumps({"pairs": b}, indent=1, ensure_ascii=False), encoding="utf-8")
    for p in data["pairs"]:
        assert "marker" not in json.dumps(a[p["n"] - 1], ensure_ascii=False)
        assert "marker" not in json.dumps(b[p["n"] - 1], ensure_ascii=False)
    print(f"arm A: {len(a)} pairs, arm B: {len(b)} pairs, no marker leakage")


if __name__ == "__main__":
    sys.exit(main())
