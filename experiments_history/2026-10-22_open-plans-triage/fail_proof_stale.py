"""t135 addendum 2 — the STALE-box FAIL-PROOF: a box pinned to unchanged code is FRESH, the same box pinned to changed code is STALE."""

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("box_stale", HERE / "box_stale.py")
box_stale = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(box_stale)

ROOT = HERE.parents[1]


def main() -> int:
    print("case                                                  expected  got      detail")
    ok = True
    fresh = box_stale.check_plan(HERE / "fixtures/stale/2026-01-20_fresh.md", ROOT)
    stale = box_stale.check_plan(HERE / "fixtures/stale/2026-01-21_stale.md", ROOT)
    f_status = fresh[0]["status"] if fresh else "NO-BOX"
    s_status = stale[0]["status"] if stale else "NO-BOX"
    mark_f = "OK " if f_status == "FRESH" else "FAIL"
    mark_s = "OK " if s_status == "STALE" else "FAIL"
    if f_status != "FRESH" or s_status != "STALE":
        ok = False
    print(f"{mark_f} 2026-01-20_fresh.md                                 FRESH     {f_status:<8} the pinned code is unchanged — {fresh[0].get('path','?') if fresh else '?'}")
    print(f"{mark_s} 2026-01-21_stale.md                                 STALE     {s_status:<8} the same box, the code has drifted — pinned {stale[0].get('pinned','?')[:12] if stale else '?'}… vs current {str(stale[0].get('current','?'))[:12] if stale else '?'}…")
    print("\nFAIL-PROOF:", "every case met its expectation" if ok else "A CASE DEVIATED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
