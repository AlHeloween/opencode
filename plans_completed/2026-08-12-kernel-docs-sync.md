# Kernel Documentation Synchronization

**Description**: Bring all kernel documentation into sync with current fragment layout, assembly pipeline, and dist-based promotion workflow.

**Date**: 2026-08-12

## Premises (⊆ G)

| Claim | Text | Status |
|-------|------|--------|
| C1 | Fragment files: `00_map.txt`, `00b_schemas.txt`, `00c_algorithms.txt`, `01_gates.txt`, `05_epistemic.txt`, `06_hygiene.txt` | Exact |
| C2 | `write_reasoning()` publishes to `prompts_kernel/dist/{date}_reasoning_prompt.mdc` + `.txt` | Exact |
| C3 | Production promotion from `dist/` to `packages/opencode/...` is manual after deep analysis | Exact |
| C4 | `build.py step_kernel()` checks wrong output path (`packages/opencode/...` instead of `dist/`) | Exact |
| C5 | Quality postscript already removed from `render_reasoning_artifacts()` | Exact |
| C6 | `docs/kernel-assembly-point.md` references old fragment `03_schemas.txt` and `stable_kernel.txt` | Exact |

## Goals

### G1: `prompts_kernel/reasoning/README.md` — fragment table + assembly docs

**SV**: readme fragments documentation assembly pipeline
**Document**: Update fragment table to match actual files; fix output path; describe dist-based workflow; mark v6 changes as historical.

| # | Task | Files | Status |
|---|------|-------|--------|
| T1 | Update fragment table (5→6 fragments, correct names) | `prompts_kernel/reasoning/README.md` | [x] |
| T2 | Fix output path: `reasoning.txt` → `reasoning_prompt.txt` | `prompts_kernel/reasoning/README.md` | [x] |
| T3 | Describe dist-based staging + manual promotion workflow | `prompts_kernel/reasoning/README.md` | [x] |
| T4 | Mark v6 changes as historical; add v7 note if needed | `prompts_kernel/reasoning/README.md` | [x] |
| T5 | Remove stale cross-artifact refs (`prompts_kernel.txt`, `algorithm_card.txt`) | `prompts_kernel/reasoning/README.md` | [x] |

### G2: `packages/opencode/AGENTS.md` — Kernel section

**SV**: agents md kernel pipeline documentation workflow
**Document**: Fix assembly pipeline diagram; remove stale `_rebuild.py` ref; describe dist → manual promotion; update tool verification commands.

| # | Task | Files | Status |
|---|------|-------|--------|
| T1 | Fix "Kernel Assembly Pipeline" diagram: dist staging + manual promotion | `packages/opencode/AGENTS.md` | [x] |
| T2 | Fix "Kernel Update Workflow": replace `_rebuild.py` ref with `build.py` | `packages/opencode/AGENTS.md` | [x] |
| T3 | Fix step 5: remove `copy /Y .mdc .txt` — both generated together | `packages/opencode/AGENTS.md` | [x] |
| T4 | Update tool verification commands (verify refcheck, dictionary, semantic_map exist) | `packages/opencode/AGENTS.md` | [x] |

### G3: `build.py` — `step_kernel()` output check

**SV**: build py kernel step output path fix
**Document**: Fix `step_kernel()` to check output in `prompts_kernel/dist/` instead of `packages/opencode/...`, or remove the check since dist path includes date.

| # | Task | Files | Status |
|---|------|-------|--------|
| T1 | Fix `step_kernel()` dst check to match actual `write_reasoning()` output location | `build.py` | [x] |

### G4: `docs/kernel-assembly-point.md` — historical references

**SV**: assembly point doc historical references update
**Document**: Add note that fix plan items are resolved; update `stable_kernel.txt` → `2026-08-09-historical-stable_kernel.txt`; note that `03_schemas.txt` no longer exists (was part of broken config).

| # | Task | Files | Status |
|---|------|-------|--------|
| T1 | Add status annotations to Fix Plan items (done/pending) | `docs/kernel-assembly-point.md` | [x] |
| T2 | Update `stable_kernel.txt` → correct filename | `docs/kernel-assembly-point.md` | [x] |
| T3 | Add note: `03_schemas.txt` was part of broken config, now `00b_schemas.txt` | `docs/kernel-assembly-point.md` | [x] |

### G5: `docs/kernel-stability-principles.md` — minor updates

**SV**: stability principles doc references update
**Document**: Update `stable_kernel.txt` reference; verify checklist still valid.

| # | Task | Files | Status |
|---|------|-------|--------|
| T1 | Update `stable_kernel.txt` → correct filename | `docs/kernel-stability-principles.md` | [x] |

## Smoke Tests

**smoke: N/A** — documentation-only changes. No code execution. Verification via visual inspection + cross-reference check.

## Claim Ledger

| ID | Text | Status | Evidence |
|----|------|--------|----------|
| C1 | Fragment file list matches reality | Exact | `prompts_kernel/reasoning/*.txt` — 6 files confirmed |
| C2 | `write_reasoning()` publishes to `dist/` | Exact | `_assemble_prompts_kernel.py:308-321` |
| C3 | Manual promotion workflow confirmed by user | Exact | User message: "мы не копируем ничего в промпты, делаем это в ручную после глубокого анализа" |
| C4 | `build.py` dst mismatch | Exact | `build.py:184` vs `_assemble_prompts_kernel.py:47` |
| C5 | Quality postscript removed | Exact | `_assemble_prompts_kernel.py:257` — no postscript line |
| C6 | Old fragment refs in assembly-point.md | Exact | `docs/kernel-assembly-point.md:106` references `03_schemas.txt` |
