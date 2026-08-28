# Kernel assembly re-verification — pipeline end-to-end after manual dedup edit

**Created:** 2026-08-27
**Status:** DRAFT (next stage per user directive — «перепроверим сборку кернела»)
**Tree:** Local_Development (reasoning_prompt.txt carries a manual dedup: duplicated
ROOT OF TRUTH block removed — 6 lines, provenance: user, 2026-08-27)

## Context

Production kernel `packages/opencode/src/session/prompt/reasoning_prompt.txt`
was edited outside the assembly pipeline (manual dedup of a duplicated
root-of-truth block). The kernel's own contract (packages/opencode AGENTS.md,
Kernel Assembly Pipeline) demands: canonical sources in `prompts_kernel/` →
assembly → `dist/` artifacts → structural checks → deep analysis → MANUAL
PROMOTION to production. A manual production edit and the canonical sources may
now diverge silently.

## Goal

Prove (or restore) equivalence: `prompts_kernel/` canonical sources assemble to
byte-identical (or consciously-updated) production `.txt`, and all pipeline
validators pass. If divergence is only the dedup — fold the dedup INTO the
canonical sources/assembly so future rebuilds don't resurrect the duplicate.

## Tasks

- [ ] **T1 — inventory the divergence.** `git diff` of production txt vs latest
  `prompts_kernel/dist/*_reasoning_prompt.txt`; locate the duplicated block in
  canonical fragments (`prompts_kernel/reasoning/*.txt`, `27_runtime_dict.py`).
  oracle: diff report (Exact artifact), no edits.
- [ ] **T2 — structural validators on canonical sources.** refcheck, dictionary
  validate, pytest `prompts_kernel/tests/`. oracle: all exit 0.
- [ ] **T3 — fold the dedup into canonical sources.** Edit the fragment that
  emits the duplicated tail (or the assembly script's join logic). oracle:
  rebuild → `diff dist txt` shows no duplicate; refcheck passes.
- [ ] **T4 — semantic verification.** `semantic_map --gated G1..G9` delta within
  25–32; assembly point intact (`# Semantic Vector` H1 → `## SV_FORMAT`).
  oracle: semantic_map json artifact + manual review checklist.
- [ ] **T5 — promote + commit.** copy dist txt → production; commit kernel +
  sources together.

## Smoke Tests

- baseline: `python -m pytest prompts_kernel/tests/ -q` → green on current tree
- post: same + refcheck + dictionary validate → exit 0
- blast_radius: `prompts_kernel/**`, production `reasoning_prompt.txt` (KV-cache
  byte-stability: any production txt change invalidates the session checkpoint
  prefix — user is aware, kernel edit was theirs).

## Premises

- Production txt contains the manual dedup (git diff, 2026-08-27) — Exact.
- Pipeline tools exist: `prompts_kernel/tools/{refcheck,dictionary,semantic_map}.py`,
  `build.py`, `write_reasoning()` — Exact (AGENTS.md, Kernel Development).
- Validators' expected ranges: semantic delta ~27.76 baseline, acceptable 25–32 — Exact (AGENTS.md).
