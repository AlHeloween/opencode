"""t135 — the FAIL-PROOF of the plan admission gate: it must REFUSE the bad shapes and
PASS the good ones, and it must do so on a fixture whose correct answer is known
independently of the tool.

Cases (each a real file under fixtures/):
  admissible/2026-01-01_admissible.md              -> PASS (binding + inline oracle + smoke)
  admissible/2026-01-02_inline_oracle_no_manifest.md -> PASS (the gate measures the PLAN,
                                                        not the store: no manifest exists)
  admissible/2026-01-06_manifest_oracle.md         -> PASS (the oracle lives in the SVM
                                                        manifest store only)
  refused/2026-01-03_unbound.md                    -> REFUSED (no binding, no oracle —
                                                        the shape that produced the debt)
  refused/2026-01-05_no_smoke.md                   -> REFUSED (executable boxes, but the
                                                        plan names no smoke)

Exit 0 = every case met its expectation; 1 = a case deviated (the gate is not a proof
until it can fail, and cannot be satisfied).
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import importlib.util

_spec = importlib.util.spec_from_file_location("plan_admission", HERE / "plan_admission.py")
plan_admission = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(plan_admission)
audit_plan = plan_admission.audit_plan

STORE = HERE / "fixtures" / "store"

CASES = [
    ("fixtures/admissible/2026-01-01_admissible.md", True, "binding + inline oracle + smoke"),
    ("fixtures/admissible/2026-01-02_inline_oracle_no_manifest.md", True, "inline oracle, NO manifest in the store"),
    ("fixtures/admissible/2026-01-06_manifest_oracle.md", True, "oracle only in the manifest store"),
    ("fixtures/refused/2026-01-03_unbound.md", False, "no binding, no oracle"),
    ("fixtures/refused/2026-01-05_no_smoke.md", False, "no ## Smoke Tests section"),
]


def main() -> int:
    print("case                                                   expected  got      detail")
    ok = True
    for rel, expect_pass, detail in CASES:
        path = HERE / rel
        report = audit_plan(path, STORE)
        got = report["admissible"]
        mark = "OK " if got == expect_pass else "FAIL"
        if got != expect_pass:
            ok = False
        why = ""
        if report["refused"]:
            why = "; ".join(
                f"L{b['line']} {b['task']} " + ("no binding" if not b["binding"] else "") + ("no oracle" if not b["oracle"] else "")
                for b in report["refused"]
            )
        if not report["has_smoke"]:
            why = (why + "; " if why else "") + "no smoke section"
        print(f"{mark} {rel.split('/')[-1]:<50} {'PASS' if expect_pass else 'REFUSE':<8} "
              f"{'PASS' if got else 'REFUSE':<8} {detail} — {why or 'nothing refused'}")
    print("\nFAIL-PROOF:", "every case met its expectation" if ok else "A CASE DEVIATED — the gate is not proven")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
