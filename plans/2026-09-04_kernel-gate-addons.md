# Gate Path Add-ons for the reasoning kernel

date: 2026-09-04
status: ACTIVE
kernel: prompt_kernel v2.0.0-alpha.3 (source.py stays FROZEN)

## Goal

Attach host-project path bindings to kernel gates as an **additive rendered section**
(`## 6. GATE_ADDONS`) so the kernel graph remains byte-stable while host conventions
(plans, experiments, docs, index, progress) are bound at specific gates. New rules
go through the addon registry, never through `source.py` edits.

## Mechanism

- `prompt_kernel/addons.py` (NEW) — data-only registry:
  `GateAddon(gate_id, addon_id, lines)` + `GATE_ADDONS` + `validate_addons()`
  (unknown gate id, duplicate addon_id, empty lines → errors).
- `prompt_kernel/render.py` — renders `## 6. GATE_ADDONS` after `## 5. IDENTITY_CONTRACTS`;
  `render_kernel()` calls `validate_addons()` and raises on errors.
  Sections 0–5 remain byte-identical to the pre-change render.
- `prompt_kernel/artifacts.py` — manifest gains `"addons": {count, sha256}`.
- `prompt_kernel/baseline.json` — production sha256 updated after install.

## Addon inventory (initial)

| Gate | Addon | Binding |
|------|-------|---------|
| G1 | PATH_GROUNDING | read `plans/*.md`, `docs/` before invent; never `.opencode/plans/` |
| G2 | PATH_EXPERIMENTS | scratch → `experiments/`; drafts → `futures/`; one-offs `[ISO8601]_name` |
| G3 | PATH_PLANS | plan → `plans/[ISO8601]_<description>.md`; Smoke Tests section before G4 |
| G7 | PATH_PROGRESS | `_progress_log.md` [TIMESTAMP] entry per bounded task |
| G9 | PATH_CLOSURE | done → `plans_completed/` + stale-ref scan; update `docs/` + repo index; deprecated → `obsolete/` |

## Tasks

1. [x] `prompt_kernel/addons.py` — registry + validation
2. [x] `prompt_kernel/render.py` — addon rendering + validation call
3. [x] `prompt_kernel/artifacts.py` — manifest addon fields
4. [x] `prompt_kernel/tests/test_addons.py` — section order, determinism, registry validity, invalid-registry rejection, additive-only proof
5. [x] `python -m pytest prompt_kernel/tests/ -q` — green (72 passed)
6. [x] `python -m prompt_kernel --install`; update `prompt_kernel/baseline.json` sha256
7. [ ] Rebuild via `python build.py` (through cmd_runner)
8. [x] Docs: `docs/gate-addons.md` + AGENTS.md (Kernel Development Workflow + Documentation Index) + DOCINDEX.md entry

## Outcome (2026-09-04, revised same day)

Render format evolved per Alexander's review: single-use local rules render as
inline prose bullets inside `<Gx_RULES>` blocks (no `#### @ID` header, no
`rule:` prefix); addons (PATH_*/TOOL_*) render inside the owning gate's block;
section 6 removed. Named = shared rules ∪ referenced rules ∪
`CONTRACT_PINNED_RULES` (compat contract). Budget dividend: 24349 bytes /
~2860 tokens (was 24978 / 2911) — tool addons admitted without budget raise.
Final sha256 a9513e86c84408acbe331fb17b7a115b9d833abfaecfd0f2b2b9504b008e922b.

## Constraints

- `prompt_kernel/source.py` untouched — kernel graph, gates, rules byte-identical.
- Addon lines contain no `@`-references (outside kernel namespace validation) and
  none of the banned spellings asserted by `tests/test_render.py`.
- Whole render must stay ≤ `KERNEL.utf8_budget` (existing test enforces).
- KV-cache: addon text is static → byte-stable prefix; cost ≈ 1 KB.
- Tests run via `python -m pytest prompt_kernel/tests/ -q` (declared kernel procedure).

## Rollback

- Revert `render.py` / `artifacts.py` (edit .bak) and delete `addons.py`;
  restore `baseline.json` sha; re-run `--install` to restore production file.
- Production pin: `baseline.json` → `assert_current_kernel_unchanged()` must be green post-rollback.

## Smoke Tests

1. **Baseline (captured 2026-09-04, pre-edit):** `python -m pytest prompt_kernel/tests/ -q` → **63 passed in 1.29s**.
2. Post-change: same command → all green including new `test_addons.py`.
3. `python -m prompt_kernel --install` → prints `installed=<sha>`; sha256 of production
   `packages/opencode/src/session/prompt/reasoning_prompt.txt` == dist manifest sha == new `baseline.json` value.
4. Additive proof: rendered text has `index("## 6. GATE_ADDONS") > index("## 5. IDENTITY_CONTRACTS")`
   and sections 0–5 unchanged (structure test green).
5. `python build.py --status` reports rebuild need; full `python build.py` exits 0.
