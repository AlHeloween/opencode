<!-- intention: kernel-audit-unrecorded -> kernel-audit-fix-installed-and-verified -->
# t111 — kernel audit fix round (retroactive record)

SV for this plan (artifact vector, computed from this plan alone):

```yaml
Keywords: kernel-audit-fix 0.35, cuts-by-reference 0.25, structural-fixes 0.20, install-verified 0.12, hygiene-closure 0.08
Semantic dominant: Retroactive record of the kernel audit fix round from duplicate audit to installed receivers.
md5: 8b1d4f6a3e9c5072a6d8e1c4b59307fa
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```

Retroactive record (written 2026-10-20 after the install): the audit and the kernel fix round ran
t108 → ChatGPT audit → t109 merge → t110 verifications → rounds 1–3 → install, but no plan file was
ever created and `plans/MASTER_PLAN.md` never named the work — a JOB FAILED hygiene gap
(AGENTS.md § Plan Maintenance). This file restores the record; every box below closed with the
artifact named beside it. No code is changed by this file.

## Owner decisions (verbatim)

- «Approve all 35 cuts from DECISIONS.md, wide options for 1 and 6; P0 and P1 go to a fix round with your target text; the 4 unused rules apply at every gate.» (t111 order, 2026-10-20; decision sheet: `experiments/2026-10-20_kernel-dups/DECISIONS.md`)
- «Да, это дыра на пол галактики.» (owner, on the unlisted-rules hole, 2026-10-20)
- «в текущей ситуации нельзя подгонять кернел под тесты все надо перепроверить» (owner, 2026-10-20)
- «Ставь все варианты» (owner, install order, 2026-10-20)

## Boxes

- [x] A1 audit inputs frozen and merged: t108 duplicates + ChatGPT `DAIS_Kernel_Audit_Findings.json` + t109 `MERGED.md` + t110 `VERIFIED.md` (35 of 36 duplicate loci CONFIRMED, 0 REFUTED; 10 structural REAL, 1 NOT-REAL, 2 UNCLEAR; 9/9 unlisted rules CONFIRMED). Receipt: `experiments/2026-10-20_kernel-dups/VERIFIED.md` + t110 `VERIFIED-T111.md`, `VERIFIED-T111-R2.md`, `VERIFIED-T111-R3.md` (0 findings each round).
- [x] C1 35 cuts by reference (wide #1 H09 fixture+STALE, #6 H04 stutter+doc sentence; STOPPED-JUSTIFIED render-only #4 H01, #7 H02, #22 DUP-05 — live in `render.py` hard-code): commit `649b710e5f`; new `test_t111_cuts` 4 passed RED→GREEN; full suite 826 passed / 3 receiver-staleness; product 78207→76450 B; ceiling 85 000 holds. Exact `old`/`replacement` from audit-A `edits[]` where given, else `per @TAG` reference; corpora (TRIZ, `@SOURCE_ROUTING` routes, `@THREE_ORACLES` catalogue) never reworded.
- [x] C2 10 structural fixes S01–S11 target text (S08 NOT-REAL, S12/S13 UNCLEAR unchanged): commit `39cefeadc1`; new `test_t111_sfixes` 17 passed RED→GREEN; full suite 843 passed / 3 receiver-staleness; product 76450→77229 B.
- [x] C3 unlisted-rules line (`reference_grammar` gains «A shared rule that no gate lists in its shared_rules applies at every gate.» — lives in `render.py` hard-code, not `source.py`): commit `ad8950a0c7`; new `test_t111_commit3` 4 passed RED→GREEN in all 4 variants; full suite 847 passed / 3 receiver-staleness; product 77229→77305 B. STOP before `--install`; independent full read-as-is review + owner word awaited.
- [x] R2 five new-text fixes (S01/S06/S07/S09/S11) + three render.py cuts (#4 H01 ladder+failed-proof, #7 H02 note, #22 DUP-05 budget tail): commit `37592c0b29`; tests updated one-by-one with quoted provenance (`test_t111_cuts` +4, `test_t111_sfixes` 5, `test_render` RUN_LIMIT/guard + ORACLE_STAMP + LEAN, `test_status_claim` oracle, `test_dedup` S03 allowlist, `test_sv_legend` template-reference); full suite 847 passed / 3 receiver-staleness.
- [x] R3 four corrections to round-2 target texts (S01 commit-messages sentence, S06 all five budgets, S07 parent/permitted-executor + residual, S11 premise-branch tie-break; S09/`decides` and descent-cost findings rejected): commit `e80f7c8960`; full suite 847 passed / 3 receiver-staleness.
- [x] Install all variants + baseline repin: `python -m prompt_kernel --install` → `13759206…` (77523 B), `--claude --install` → `ff958dcb…` (77279 B), `--codex --install` → dist `72eccdec…` (77271 B, no repo receiver — channel is `$CODEX_HOME/AGENTS.md`, t64), `--cursor --install` → runtime `aa06d3b9…` (77253 B), receiver `0a291ba2…`; `prompt_kernel/baseline.json` repinned `3a268fc0` → `13759206` (install does not repin); full suite 850 passed / 0 failed; `_build.ps1` via cmd_runner exit 0, bytes_written 66342, smoke 10.0.1480; receivers sha256 == render sha256 (all three compared read-back). Commit `cb4b54674b` (receivers + baseline only; `bin/` untouched).
- [x] H1 hygiene closure in this change: retroactive record (this file), MASTER_PLAN mapping regenerated via `svm render` from the repo root, file moved to `plans_completed/` — receipts: render `plans/MASTER_PLAN.md` 56381 B, 46 plans, 188 open boxes, `gapsBefore: []` + this commit naming the plan.

`svm render` output in this change: `{file: plans/MASTER_PLAN.md, bytes: 56381, plans: 46, openBoxes: 188, missingPlanSv: 3, missingTaskSv: 118, missingManifests: 180, gapsBefore: []}`.

## Smoke Tests

- `python -m pytest prompt_kernel/tests/ -q` → 850 passed / 0 failed (post-install; the 3 receiver-staleness reds resolve because receivers equal the render).
- 4-variant render present; bytes/tokens under 85 000 B / 11 600 tok in every variant and every round.
- Installed receivers sha256 == render sha256, read back byte-for-byte (production, claude, cursor).
- `_build.ps1` via cmd_runner → exit 0, smoke 10.0.1480, `reasoning_prompt.txt` embedded.

## Future audit candidates (not boxes — residual, does not block closure)

- S01 tension: `ASSERTION_SCOPE` now excludes commit messages («Commit messages are an established external format: no marker») while the pre-existing G7 `ASSERTION_STATUS` addons line (untouched this round) still describes `every assertion you write` — one place should own the exemption.
- Third falsifier-pass wording: the round-2/round-3 correction sentences (tie-break, five-budget list, capability-denial route) are second-order formulations — candidates for another compression pass once behavior is confirmed stable.
