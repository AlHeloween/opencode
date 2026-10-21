## [2026-10-22] t136 — read-as-is verification of t135 (33 rows: 12 closed + 3 moves + 17 quotes + 1 master)

WHAT: every item t135 closed, moved, quoted or rendered in e4b2313eb0+d5c52c7e2d, checked against the artefacts as read.
MEASURED: PASS 28 / FAIL 5 (A3 T4 receipt, A5 C2 residual, A11 S8 receipt, B2 triz move unearned, C17 dais D3 no quote) / UNKNOWN 0 (A12 S9 run found in the repo-root store on recheck; first check looked at the wrong binary's store). Summary numbers wrong: "10 boxes" vs 12 §2 rows, "2 plans" vs 3 §3 moves. Artefacts: REPORT.md (33 rows + re-run oracles) + check_master_plan.py in experiments/2026-10-22_t135-verification/ (mirrored to experiments_history/ for the commit, since experiments/ is gitignored).
