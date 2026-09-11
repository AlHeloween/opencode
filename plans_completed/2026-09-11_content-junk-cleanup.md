# Content junk cleanup — root artifacts, dead patch scaffolds, doc index rot

**Status:** COMPLETE (2026-09-11)
**Created:** 2026-09-11
**Scope:** PLAN_WRITE + MODIFY_PROJECT (deletions of unreferenced content artifacts, DOCINDEX repair)
**Evidence:** `git grep -lI -F <name>` over tracked files (excluding `plans_completed/`, lockfiles) returned 0 referencing files for every deleted path.

## Tasks

- [x] C1 — Remove unreferenced root artifacts: `temp_pkg.json`, `commits_last_month.xlsx`,
      `check_sessions.ts`, `session_stats.ts`, `kernel_semantic_map.json`,
      `packages/storybook/debug-storybook.log`.
- [x] C2 — Remove `updates/` (170 patch/xml scaffolds, last touched 2026-07-28, no code path reads it).
- [x] C3 — Remove the 8 stale files under `obsolete/` (all 2026-06-04). The `obsolete/`
      convention itself stays (kernel G9 rule routes deprecated material there).
- [x] C4 — Remove superseded kernel-era docs: `docs/gated-workflow.md` (pre-G0 9-gate draft with
      numeric marker weights the current kernel does not have), `docs/kernel-validation/validation-report-20260809.md`
      (validates `prompts_kernel/` + `core_schemas.yaml`, both GONE), `docs/bun-gemini-research.md`,
      `docs/fossil-search-research.md` (unreferenced LLM research essays, 56 KB combined).
- [x] C5 — Repair `DOCINDEX.md`: drop dead entries (`opencode_prompts_kernel.py`,
      `tests/test_reasoning_kernel.py`, `specs/effect/*` — all GONE), add the 14 live docs
      that were missing from the index.

## Smoke Tests

- **Baseline (before):** `git grep -lI -F "<deleted name>"` → 0 tracked referencing files (captured for all C1–C4 paths).
- **Post-change oracle 1 (dangling refs):** for every deleted path, `git grep -lI -F` over tracked
  files (excluding `plans_completed/`, `_progress_log.md`, this plan) → **0 hits**.
- **Post-change oracle 2 (DOCINDEX is executable Python):** `python -c "compile(open('DOCINDEX.md',encoding='utf-8').read(),'DOCINDEX.md','exec')"` → exit 0.
- **Post-change oracle 3 (index completeness):** every `docs/**/*.md` tracked path appears in
  `DOCINDEX.md`, and every path named in `DOCINDEX.md` exists on disk → both lists empty.
- **Expected delta:** ~186 tracked files removed, ~1.6 MB out of the tree; no source/test file touched.

## Out of scope

- `.opencode/data/gateway` retention (252 MB/day of raw-wire dumps) — runtime code change, separate goal.
