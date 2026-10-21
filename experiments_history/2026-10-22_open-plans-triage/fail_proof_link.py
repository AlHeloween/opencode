"""t135 addendum 2 — the link-check FAIL-PROOF: a linked plan passes, an unlinked one is refused."""

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("plan_link", HERE / "plan_link.py")
plan_link = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(plan_link)

CASES = [
    ("fixtures/link/2026-01-10_linked.md", True, "parent-goal-md5 names a goal"),
    ("fixtures/link/2026-01-11_unlinked_zero.md", False, "parent-goal-md5 is 32 zeros"),
    ("fixtures/link/2026-01-12_unlinked_none.md", False, "no SV block at all"),
]


def main() -> int:
    print("case                                                  expected  got      detail")
    ok = True
    for rel, expect_linked, detail in CASES:
        link, why = plan_link.plan_link(HERE / rel)
        got = link is not None
        mark = "OK " if got == expect_linked else "FAIL"
        if got != expect_linked:
            ok = False
        print(f"{mark} {rel.split('/')[-1]:<50} {'LINKED' if expect_linked else 'UNLINKED':<8} "
              f"{'LINKED' if got else 'UNLINKED':<8} {detail} — {why}")
    print("\nFAIL-PROOF:", "every case met its expectation" if ok else "A CASE DEVIATED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
