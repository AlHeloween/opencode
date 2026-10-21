# t135 — the open-plan triage (archived)

**What this is.** The owner's order of 2026-10-22: 53 unfinished plans, classify why each
is unfinished, close what is already earned, name the planning defect. The report is
`REPORT.md`; everything else here is the evidence it was built from and the tools that
produced it.

**Born in** `experiments/2026-10-22_open-plans-triage/` (gitignored scratch), **archived
here** per the canon (`experiments_history/README.md`): a finished experiment whose
finding is recorded is tracked. One copy only — the scratch folder is gone, not duplicated.

## The files

| file | what it is | how to regenerate |
|---|---|---|
| `REPORT.md` | the triage: the per-plan table, the boxes closed with their receipts, the moves, the finish order for the robots, the class shares, the measured patterns, the mechanism | `python make_report.py` (reads the four artefacts below) |
| `decisions.json` | **hand-made, not regenerable** — the per-box class (a–e) for all 211 boxes, one entry per plan | by hand; it is the DECISION, the measurement is separate |
| `plan_inventory.json` | the pre-triage census per plan (boxes, smoke, prior art, lifecycle, git history) | `python measure.py` |
| `box_context.json` | the pre-triage TEXT of every open box + the lines that follow it + the manifest state — the evidence the class rests on | `python box_context.py` (after `measure.py`) |
| `decisions.json` | **hand-made, not regenerable** — the per-box class (a–e), one entry per plan (the decision, not the measurement) | by hand; it is the DECISION, the measurement is separate |
| `plan_link.py` | the master-goal LINK check (candidate mechanism, addendum 2) | — |
| `fail_proof_link.py` + `fixtures/link/` | its 3-case fail-proof (1 linked PASS + 2 unlinked REFUSE) | `python fail_proof_link.py` |
| `box_stale.py` | the STALE-box check (candidate mechanism, addendum 2) | — |
| `fail_proof_stale.py` + `fixtures/stale/` | its 2-case fail-proof (FRESH vs STALE on the same box) | `python fail_proof_stale.py` |
| `pre_triage_census.json` | the PRE-triage census (53/211/285/14/3/27/9/49), kept because `plan_inventory.json` was regenerated post-move | the stdout of the first `measure.py` run |
| `open_boxes.md`, `box_context.md` | the same, human-readable | `python box_context.py` |
| `measure.py` | the census — it MIRRORS `util/plan-status.ts`'s own box regex and lifecycle reader, so the numbers are the runtime's own | — |
| `plan_admission.py` | the CANDIDATE mechanism (the plan admission gate) | — |
| `fail_proof.py` | its fail-proof: 5 cases, 3 PASS + 2 REFUSE | `python fail_proof.py` |
| `fixtures/` | the five fixture plans + the fixture manifest store | — |
| `make_report.py` | the report generator | — |
| `progress_row.md` | the `_progress_log.md` row this task committed (the append-only log route) | — |

## Reproduce

```
python fail_proof.py                      # the fail-proof: 5/5
python fail_proof_link.py                 # the link fail-proof: 3/3
python fail_proof_stale.py                # the stale fail-proof: 2/2
python plan_admission.py plans             # the gate over the live tree (exit 1 = refused)
python plan_link.py plans                  # the link check (exit 1 = unlinked, named)
python box_stale.py <plan-file>            # the stale check (exit 1 = STALE, named)
python measure.py && python manifests.py && python box_context.py && python make_report.py
```

The build receipt this task used (it closed the S9 box of
`plans/2026-10-20_triz-kernel-correspondence.md`): cmd_runner run
`20261021T203353Z_ce9f9b26` — exit 0, smoke `10.0.1515`, `reasoning_prompt.txt embedded`,
artifacts in `dist/` (`bin/` untouched).
