<!-- intention: verify TRIZ↔kernel correspondences from primary sources → produce report + glossary entries + plan for owner approval -->

# Plan: TRIZ ↔ Kernel Correspondence (t101)

**SV:**
```yaml
Keywords: triz-kernel-correspondence 0.35, primary-sources-altshuller 0.25, falsify-not-confirm 0.20, name-corpus-candidates 0.12, read-not-script 0.08
Semantic dominant: Each TRIZ concept is grounded in Altshuller's primary sources and matched against the kernel's actual rules by reading, every proposed correspondence is tried as a hypothesis to refute, and the confirmed ones become named corpus candidates and glossary entries for the owner to approve into the kernel.
md5: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 3311b003953a48eebdf7da26ed411d70
note: hash values are generative tags — search them, never compute them.
```

## Boxes

- [x] **S1** Read kernel snapshot (`experiments/2026-10-20_kernel-audit/kernel-product-c912b4ac52.txt`) and glossary (`docs/glossary.md`)
- [x] **S2** Fetch TRIZ primary sources via Universal Search + webfetch (40 Principles, ARIZ, IFR, Contradiction Matrix, TESE, S-curve, Physical Contradiction, Resources, Su-Field, SIS, MATRIZ Glossary)
- [x] **S3** Rule on 5 hypotheses (H1–H5) with kernel quotes + TRIZ source_ref + content_hash
- [x] **S4** Discover new correspondences in both directions (TRIZ→Kernel, Kernel→TRIZ)
- [x] **S5** Write report: `experiments/2026-10-20_triz-kernel/REPORT.md`
- [x] **S6** Append 21 TRIZ glossary entries to `docs/glossary.md`
- [x] **S7** Write this plan with boxes, SV, Smoke Tests
- [x] **S8** Commit plan, glossary, report via `scripts/commit_own.py` + append `_progress_log.md` — ✓ CONFIRMED 2026-10-22 (t135), class (a): the commit exists and names this plan. Receipt: commit `7cb11a686e` («t101: TRIZ↔kernel correspondence report + 21 glossary entries + plan») — it carries this plan, `docs/glossary.md` (the 21 entries) and the report.
- [x] **S9** Run `_build.ps1` via cmd_runner from repo root — ✓ CONFIRMED 2026-10-22 (t135), class (a): the build ran in this task. Receipt: cmd_runner run `20261021T203353Z_ce9f9b26` (state.json: status finished / exit_code 0 / bytes_written 66 615 / bytes_dropped 0 / truncated false); the log's own lines: «Smoke test passed: 10.0.1515», «Smoke test passed: reasoning_prompt.txt embedded (BunFS asset present)», «[OK] Build complete - artifacts in dist/». `bin/` untouched (the build stages into `dist/`). With S8 and S9 closed, the plan moves to `plans_completed/` in the same commit (AGENTS § Plan Maintenance, JOB FAILED #2).

## Smoke Tests

- **ST1** Every TRIZ row in report carries a `source_ref` with `content_hash` (verified by grep)
- **ST2** Every kernel quote in report exists verbatim in the kernel snapshot (verified by grep)
- **ST3** Glossary entries follow file's style: `## Term`, `- **Definition.**`, `- **source_ref:**`, `- **content_hash:**`
- **ST4** Plan boxes all ticked except S8–S9 (this plan)
- **ST5** Commit succeeds, `_progress_log.md` appended, `_build.ps1` exits 0

## Acceptance Criteria

- Report delivered with 5 hypothesis rulings + 19 new correspondences (TRIZ→Kernel) + 7 kernel-unique constructs
- 21 glossary entries added with proper source_ref + content_hash
- Plan committed, build passes
- No changes to `prompt_kernel/` (analysis only)