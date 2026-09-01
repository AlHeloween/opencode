# Kernel tautology fix — heading must not declare and reference itself

**Created:** 2026-09-01
**Status:** COMPLETED 2026-09-01 — all oracles PASS, moved to plans_completed/
**Tree:** Local_Development

## Context

Kernel headings of the form `## X (@X)` declare the anchor and reference it
simultaneously (user: «масло-масляное»). Agreed on 2026-08-31, then dropped —
this plan closes it. refcheck.py `_clean_anchor` fallback normalizes any bare
title to the same anchor (`## SV_FORMAT` → `SV_FORMAT`), so removing the
redundant `(@X)` when title ≡ anchor is mechanically safe. Parens stay ONLY
where title ≠ anchor (`# Schemas (@SCHEMA)`, `# Identities (@IDENTITIES)`,
`# Algorithms (@ALGO)` — the parens carry a DIFFERENT id than the title).

## Prior art (REUSE.BEFORE)

reuse: N/A — internal assembly convention; governing surfaces: refcheck.py
anchor fallback, dictionary.py id extraction (`split("(")[0]`), core_schemas.yaml.

## Grounding findings (Exact)

- 51 tautological headings in dist/reasoning_prompt.txt (grep 2026-09-01);
  3 legit title≠anchor headings kept.
- Sources: 15 literal headings in reasoning fragments (00_map×3, 00b×1,
  00c×6, 05_epistemic×5); 19 schema headings from core_schemas.yaml via
  `_section_to_comment_lines` (entries have only `tag:`, no `name:` → name
  defaults to tag → always tautological); 17 spec headings from
  `_render_compact_spec` (28_runtime_render.py:214); 1 from `resolve_def_refs`
  (_assemble_prompts_kernel.py:181).
- Consumers verified safe: refcheck fallback yields identical anchors;
  dictionary.py id extraction strips parens then normalizes — bare titles give
  identical ids; test_prompt_schema.py:384 regex REQUIRES parens → must be
  updated to accept bare titles (tag = normalized title fallback).

## Tasks

- [x] **T1 — renderers:** `_assemble_prompts_kernel.py` — `_tagged_header()` helper (parens only when title ≠ tag) + `resolve_def_refs` bare title; `28_runtime_render.py:214` — `## {name}`. DONE.
- [x] **T2 — fragments:** 15 headings stripped (00_map×3, 00b×1, 00c×6, 05_epistemic×5). DONE.
- [x] **T3 — test_prompt_schema.py:** regex accepts bare titles (tag = explicit parens or normalized title). DONE.
- [x] **T4 — regen + rebuild + promote.** DONE (fresh-process pitfall respected; 54875 chars).
- [x] **T5 — oracles + commit.** DONE — see below.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (already recorded this session [Exact])

| # | Command | Expected now | Actual |
|---|---------|--------------|--------|
| 1 | `python -m pytest prompts_kernel/tests/ -q` | pass | 490 passed (43.63s) |
| 2 | `python -m prompts_kernel.tools.refcheck` | exit 0 | exit 0, 109/109 |
| 3 | `python -m prompts_kernel.tools.dictionary` | exit 0 | exit 0, 109 entries |

### Post-implementation oracles

| # | Command / check | Pass criteria | Actual [Exact] |
|---|-----------------|---------------|----------------|
| 1 | tautology inventory on rebuilt dist txt | 0 tautologies; only 3 legit title≠anchor parens remain | 3: `Identities (@IDENTITIES)`, `Schemas (@SCHEMA)`, `Algorithms (@ALGO)` |
| 2 | `python -m pytest prompts_kernel/tests/ -q` | pass (incl. updated schema test) | 490 passed (35.57s) |
| 3 | `python -m prompts_kernel.tools.refcheck` | 0 unresolved | 84/84 resolved, 0 unresolved (109→84: minus 25 FAKE self-refs that lived inside the tautological parens — the defect itself), anchors 147 intact |
| 4 | `python -m prompts_kernel.tools.dictionary` | 109 entries, same breakdown | 109 (37/7/5/1/47/12) — after parser fallback fix (see finding below) |
| 5 | `git diff --no-index` dist vs production | empty (after promotion) | DIFF_EMPTY |
| 6 | semantic_map gated chain | completes | 109 entries, chain built (cache intact — bodies unchanged) |

### Mid-oracle catch (2026-09-01)

First post-fix dictionary run: 60 entries (−49: all schema/algorithm/epistemic)
— dictionary.py `_extract_tag` keyed entry ids ONLY off the parenthetical tag.
Fixed: explicit `(@TAG)` OR the bare title when it is already an ALL-CAPS
identifier (prose titles like "Gate Dispatch" stay non-entries). Re-run: 109 ✓.
refcheck refs 109→84 is CORRECT: the removed 25 were fake refs `@X` inside the
removed `(@X)` parens — the very declaration+ref duplication being fixed.

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

## Blast radius

prompts_kernel/_assemble_prompts_kernel.py, 28_runtime_render.py (via precompiled
regen), reasoning/*.txt (4 files), tests/test_prompt_schema.py,
_kernel_precompiled.py (regen), dist/* (gitignored),
production reasoning_prompt.txt (PROMOTED — changes by design).
