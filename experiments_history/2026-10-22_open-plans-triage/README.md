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
| `manifests.json` | the SVM manifest store (state + oracle per task), read through the store's own mapping | `python manifests.py` |
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
python plan_admission.py plans             # the gate over the live tree (exit 1 = refused)
python measure.py && python manifests.py && python box_context.py && python make_report.py
```

The build receipt this task used (it closed the S9 box of
`plans/2026-10-20_triz-kernel-correspondence.md`): cmd_runner run
`20261021T203353Z_ce9f9b26` — exit 0, smoke `10.0.1515`, `reasoning_prompt.txt embedded`,
artifacts in `dist/` (`bin/` untouched).
