# Kernel assembly re-verification — pipeline end-to-end after manual dedup edit

**Created:** 2026-08-27
**Revised:** 2026-08-31 (rev 2 — grounding pass against tree: precompiled bundle, provenance fixes, smoke tables)
**Status:** COMPLETED 2026-08-31 — all oracles PASS, moved to plans_completed/
**Tree:** Local_Development

## Context

Production kernel `packages/opencode/src/session/prompt/reasoning_prompt.txt`
was edited outside the assembly pipeline (manual dedup of a duplicated
root-of-truth block; committed as `1aeb256635` on 2026-08-28 — production .txt
only). Canonical sources still emit the duplicate: rebuild would resurrect it.
Rev 2 grounds the plan against the actual tree and fixes three defects found
there: (1) the precompiled bundle bypasses a source-only fix, (2) the T4 oracle
had fabricated provenance, (3) refcheck's target file does not exist.

## Prior art (REUSE.BEFORE)

reuse: N/A — local-only verification/repair of this repo's own assembly
pipeline; governing surfaces: AGENTS.md (Kernel Development Workflow),
prompts_kernel/README.md, prompts_kernel/docs/DOCINDEX.md.

## Grounding findings (2026-08-31, Exact — git diff + source reads)

- **Duplication root — dual emission.** Supremacy clause is appended twice:
  once inside `render_all_specs` (`28_runtime_render.py:311-317`, mirrored at
  `_kernel_precompiled.py:5039`) and again by the explicit `root` append in
  `render_reasoning_artifacts` (`_assemble_prompts_kernel.py:257-260`,
  mirrored at `_kernel_precompiled.py:6602-6605`).
- **Diff inventory.** dist ↔ production = exactly 6 deleted lines; the removed
  copy is the SECOND (trailing) block. Production ends at the first block.
- **Precompiled is live-first.** `prompts_kernel/__init__.py:132` loads
  `_kernel_precompiled.py` (6860 lines, generated) and only falls back to
  fragment bootstrap. A source-only edit to `_assemble_prompts_kernel.py` is
  ineffective while the bundle imports cleanly → regen required:
  `write_precompiled_kernel()` (`_assemble_prompts_kernel.py:484`, documented
  in bundle header `DO NOT EDIT. Regenerate with: write_precompiled_kernel()`).
- **refcheck is currently broken.** `tools/refcheck.py:11` targets production
  `reasoning_prompt.mdc` — that file does not exist (production carries only
  `.txt`). `tools/dictionary.py:20-27` correctly targets `.txt` → align
  refcheck to the same convention.
- **`_default_output()` is date-prefixed** (`_assemble_prompts_kernel.py:37-47`)
  → rebuild must pass the explicit stable path
  `prompts_kernel/dist/reasoning_prompt.mdc`.
- **semantic_map parses the dictionary layer** (production .txt via
  `tools/dictionary.py`), not the txt under test; BGE embedding cache is
  populated (hundreds of .npy) → runnable. Dictionary layer is unchanged by
  this fix → delta comparison is a health check, not the equivalence oracle.
- **rev-1 premise REVOKED.** "semantic delta ~27.76, acceptable 25-32 — Exact
  (AGENTS.md)" — misattributed: 27.76 is a hardcoded print string
  (`tools/_print_chain.py:7`); the 25-32 range appears nowhere in the repo.
  Replaced by a deterministic byte-diff equivalence oracle.
- dist/ is gitignored build output (11 files visible only with noIgnore).

## Goal

Prove (or restore) equivalence: `prompts_kernel/` canonical sources assemble to
byte-identical production `.txt`, and all pipeline validators pass. Fold the
dedup INTO canonical sources + precompiled bundle so future rebuilds do not
resurrect the duplicate. Production .txt must remain UNCHANGED (KV-cache
checkpoint prefix stays byte-stable).

## Tasks

- [x] **T1 — inventory the divergence.** DONE (grounding 2026-08-31): diff =
  6 lines (second supremacy block); dual emission sites located; dedup commit
  `1aeb256635` confirmed. oracle: git diff + git show [Exact].
- [x] **T2 — structural validators on canonical sources.**
  `python -m pytest prompts_kernel/tests/ -q` (490 passed post-fix);
  `python -m prompts_kernel.tools.dictionary` (exit 0, 109 entries);
  `python -m prompts_kernel.tools.refcheck` (exit 0, 109/109 resolved). oracle: exit 0 each.
- [x] **T2b — fix refcheck KERNEL path.** `tools/refcheck.py:11`: production
  `reasoning_prompt.mdc` → `reasoning_prompt.txt` (dictionary.py convention).
  oracle: refcheck runs and exits 0 on the real artifact. DONE — 109/109.
- [x] **T3 — fold the dedup into canonical sources.** Removed the explicit
  `root` append from `render_reasoning_artifacts`
  (`_assemble_prompts_kernel.py:257-260` — supremacy already emitted by
  `render_all_specs`, which `write_runtime_kernel`/CLI depend on; DOCINDEX
  documents supremacy as part of render_runtime_kernel output). THEN regen
  precompiled bundle → rebuild dist via
  `write_reasoning(Path("prompts_kernel/dist/reasoning_prompt.mdc"))` →
  oracle: `git diff --no-index` dist .txt vs production .txt is EMPTY
  (byte-identical) [Exact]. DONE — DIFF_EMPTY_EXIT_0.
  Implementation nuance found by the oracle: production (approved state,
  `1aeb256635`) ends with ONE blank line after the supremacy clause; runtime
  body therefore keeps a trailing `"\n"` after specs to converge byte-for-byte.
  PITFALL recorded: regen + rebuild must run in SEPARATE Python processes —
  same-process rebuild uses the stale in-memory precompiled module.
- [x] **T3b — regression test.** `tests/test_runtime.py::
  test_reasoning_artifacts_contain_exactly_one_supremacy_block`:
  rendered runtime artifact contains exactly ONE `ROOT OF TRUTH` block.
  oracle: pytest pass. DONE — 490 passed (489 baseline + 1 new).
- [x] **T4 — structural semantic surface.** Assembly point intact:
  `# Semantic Vector (SV)` H1 (line 1) → `## SV_FORMAT` (line 5) in rebuilt
  artifact; `ROOT OF TRUTH` count == 1 (grep [Exact]); semantic_map gated
  chain (`--gated G1,...,G9`) completes: 109 entries, flow order built,
  top-3 similarity min 0.507 / mean 0.711 / max 0.886 (dictionary layer
  unchanged — health check only).
- [ ] **T5 — single commit.** `_assemble_prompts_kernel.py` +
  `_kernel_precompiled.py` (regenerated) + `tests/test_runtime.py` +
  `tools/refcheck.py` + `AGENTS.md` + plan → `plans_completed/`. dist
  artifacts are NOT committed (gitignored). Production .txt unchanged
  (byte-identical convergence — verified). Per AGENTS.md Kernel
  Development Workflow: source + regenerated + test fixes in one commit.
- [ ] **T6 — docs hygiene.** AGENTS.md references stale
  `plans/2026-08-08-cc-generator-integration/_rebuild.py` (file does not
  exist anywhere) → replaced with actual regeneration commands
  (`write_precompiled_kernel()` / `write_reasoning(...)`) + fresh-process pitfall.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd: repo root)         | Expected now                                         | Actual [Exact]                                 |
|---|-----------------------------------|------------------------------------------------------|------------------------------------------------|
| 1 | `python -m pytest prompts_kernel/tests/ -q` | pass (green baseline on current tree)      | 489 passed in 42.68s                           |
| 2 | `python -m prompts_kernel.tools.dictionary` | parses production .txt, exit 0             | exit 0, 109 entries (3 stale-count warnings)   |
| 3 | `python -m prompts_kernel.tools.refcheck`   | known fail: KERNEL (.mdc) missing → fixed by T2b | known fail confirmed: `reasoning_prompt.mdc not found` |

### Post-implementation oracles

| # | Command / check                                                | Pass criteria                          | Actual [Exact] |
|---|----------------------------------------------------------------|----------------------------------------|----------------|
| 1 | `git diff --no-index prompts_kernel/dist/reasoning_prompt.txt packages/opencode/src/session/prompt/reasoning_prompt.txt` | empty (byte-identical) | DIFF_EMPTY_EXIT_0 (after trailing-`\n` convergence) |
| 2 | `python -m pytest prompts_kernel/tests/ -q`                    | pass, incl. new supremacy-count test   | 490 passed in 43.63s |
| 3 | `python -m prompts_kernel.tools.refcheck`                      | exit 0                                 | exit 0, 109/109 resolved |
| 4 | `python -m prompts_kernel.tools.dictionary`                    | exit 0                                 | exit 0, 109 entries (same 3 warnings as baseline) |
| 5 | grep count of `ROOT OF TRUTH` in rebuilt dist .txt             | == 1                                   | 1 (line 1183; stale dated snapshots still 2 — gitignored) |
| 6 | `python -m prompts_kernel.tools.semantic_map --gated G1,...,G9` | completes, delta recorded              | completed: 109 entries, 1 gated chain, min/mean/max 0.507/0.711/0.886 |

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

## Premises (claim ledger)

| id | claim | status | provenance | evidence |
|----|-------|--------|------------|----------|
| C1 | Production txt contains the dedup; committed `1aeb256635` 2026-08-28 (production .txt only) | Exact | RETRIEVED | git show --stat |
| C2 | Supremacy clause emitted at two join points (render_all_specs + explicit root append) | Exact | RETRIEVED | 28_runtime_render.py:311-317; _assemble_prompts_kernel.py:257-260; _kernel_precompiled.py:5039,6602-6605 |
| C3 | Precompiled bundle is the live-first module; source-only fix ineffective | Exact | RETRIEVED | __init__.py:132 |
| C4 | refcheck KERNEL targets non-existent production .mdc | Exact | RETRIEVED | tools/refcheck.py:11 + glob |
| C5 | Pipeline tools exist: refcheck, dictionary, semantic_map, write_reasoning, write_precompiled_kernel | Exact | RETRIEVED | tools/*, _assemble_prompts_kernel.py:308,484 |
| C6 | rev-1 premise "delta 25-32 (AGENTS.md)" — REVOKED (misattributed provenance) | Unknown→dropped | — | tools/_print_chain.py:7 only; no range in repo |
| C7 | dist/ is gitignored build output | Inferred | RETRIEVED | glob noIgnore notice |

## Blast radius

- `prompts_kernel/_assemble_prompts_kernel.py` — remove duplicate root append
- `prompts_kernel/_kernel_precompiled.py` — regenerated artifact
- `prompts_kernel/tests/test_runtime.py` — regression assert
- `prompts_kernel/tools/refcheck.py` — KERNEL path one-liner
- `prompts_kernel/dist/*` — rebuilt (gitignored)
- `AGENTS.md` — one stale reference (T6)
- Production `reasoning_prompt.txt` — **unchanged** (dist converges to it) →
  session checkpoint prefix stays byte-stable.
