# experiments/ canonization → `yyyy-mm-dd_brief`

<!-- intention: mixed experiment naming (20260718T000000Z_*, 20260912_*, 2026-09-12_*, undated loose files) -> one canonical `yyyy-mm-dd_brief` top level -->

**Status:** COMPLETE — applied, verified, typecheck green
**Harness:** `experiments/2026-09-13_experiments-canon/` — `canonize.cjs`, `fixrefs.cjs`, `verify.cjs`

## Context / goal

`experiments/` is a gitignored scratch tree (`.gitignore:73`) that accumulated three
competing name formats plus ~50 undated loose files:

| Format | Example |
|--------|---------|
| `yyyyMMddTHHmmssZ_brief` | `20260718T000000Z_crash-diagnostics` |
| `yyyyMMdd_brief` | `20260912_deepseek-h3` |
| `yyyy-mm-dd_brief` | `2026-09-08_bun-txt-embed-repro` ← existing canonical example |
| undated | `deepseek_cache_test.py`, `fossil_replay6.sh`, `vision/` |

Goal: one canon at the top level — `yyyy-mm-dd_brief` for dirs, `yyyy-mm-dd_brief.ext`
for loose files — with related loose files grouped into dated folders of the same type.
Subdirectory contents are **not** renamed (only the top-level entries move).

## Prior art

reuse: N/A — one-off local tree hygiene. The naming canon is defined by the repo's own
existing example (`experiments/2026-09-08_bun-txt-embed-repro/`), and the earlier partial
attempt (`experiments_history/2026-09-08_experiments-reorg/20260908_canonize_all.cjs`, `20260908_reorganize.ps1`) is folded into
`2026-09-08_experiments-reorg/` as the historical record.

## Implementation steps

- [x] Ground the full tree + every inbound reference (`grep experiments/` across repo, docs, plans, source comments).
- [x] Write `canonize.cjs` (dry-run default; `--apply` writes `before.json` / `after.json` / `manifest.json`).
- [x] Write `fixrefs.cjs` (rewrites path strings invalidated by the moves).
- [x] Write `fixrefs2.cjs` (wave 2: live surfaces only; backups under `backups/`; skips captured evidence).
- [x] Write `scanrefs.cjs` (residual stale-reference scanner) and `verify.cjs` (naming + manifest + no-loss oracle).
- [x] Dry-run clean: 113 ops, 5251 → 5251 files, 0 errors.
- [x] Apply `canonize.cjs --apply` — 113 ops, 5251 → 5251, 0 errors; `all top-level entries canonical`.
- [x] Apply `fixrefs.cjs --apply` — 38 files, 0 warnings; re-run idempotent (0 files).
- [x] Apply `fixrefs2.cjs --apply` — 166 files, 185 replacement groups; re-run idempotent (0 files).
- [x] Run `verify.cjs` — **PASS**, `missing 0 / extra 0`.
- [x] Confirm no live reference resolves to a pre-move path — scanner 323 → 63 hits, remainder is captured evidence / foreign trees (see below).
- [x] Typecheck (`packages/opencode`, `20260915T070836Z_1475d0cd`) — exit 0.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `node experiments/2026-09-13_experiments-canon/canonize.cjs` (repo root) | `errors: 0`, before == after, all moves listed | 113 ops, 5251 → 5251, **0 errors** (`.opencode/data/tmp_canon_dry.txt`) |
| 2 | `node -e "…hash…"` on `2026-09-12_log-cleanup-probe/probe.cjs` vs `2026-09-12_log_cleanup_probe/probe.cjs` | different → merge must rename, not overwrite | different (1627 B vs 961 B, distinct md5) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria | Result [Exact] |
|---|---------------|---------------|----------------|
| 1 | `node experiments/2026-09-13_experiments-canon/verify.cjs` (repo root) | `PASS`, exit 0 — every top-level entry canonical, every manifest op landed, inventory `missing 0 / extra 0` | **PASS** (exit 0; `before 5251 / after 5251 / missing 0 / extra 0`) |
| 2 | `node experiments/2026-09-13_experiments-canon/fixrefs.cjs` + `fixrefs2.cjs` (repo root) | re-run reports no changes (idempotent) | both `0 files` on re-run |
| 3 | `bun typecheck` (`packages/opencode`, cmd_runner) | exit 0 — no source reference was broken | **exit 0** (`20260915T070836Z_1475d0cd`) |

### Residual references (deliberate)

`scanrefs.cjs` reports 63 remaining hits; every one is excluded by design:

- **Captured evidence** — `logs/`, `diag/`, `request_payload_sent.md`, `system_prompt.txt`,
  `checkpoint_sample.json`, `deepseek_request_body.json`. These record what was true at
  capture time; rewriting them would falsify the record.
- **Foreign trees** — `packages/opencode/test/experiments/` (a separate tracked lane),
  `external/opentui-*/`, `.codex/skills/`, `.cursor/skills/`, and the `ADID_Python`
  project's own paths.
- **Historical plan prose** — `plans_completed/**` mentions of names that were already
  stale before this task (`20260609_cache_semantics`, `20260610_cache_guardrail`,
  `tui_rendering`, `jj_smoke`). Those directories never existed in this tree.

### Gate
- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

## Risks

| # | Risk | Containment |
|---|------|-------------|
| 1 | Reference rot in source/docs/plans | two fix waves (`fixrefs.cjs` 38 files, `fixrefs2.cjs` 166 files) + `scanrefs.cjs` residual scan (323 → 63, remainder deliberate); typecheck exit 0 |
| 2 | File loss during 113 moves | `manifest.json` is the reversal map; `verify.cjs` §3 diffs before/after inventories |
| 3 | Live TUI holding a path | moves are `renameSync` within one volume (no copy); no writer touches `experiments/` internals |
| 4 | Duplicate basenames colliding | merge entries are explicitly renamed (`probe-timing.ts`, `probe-minimal.cjs`) |
| 5 | Tracked file under the gitignored tree | `02_plugin_loader_probe.ts` was the only force-added tracked file; re-added at its new path so git records a rename, not a deletion |

## Rollback

Replay `manifest.json` in reverse (each op carries `from`/`to`), or restore from the
`before.json` inventory. The tree is gitignored, so git is not a fallback — the manifest is.
Wave-2 edits are reversible from `experiments/2026-09-13_experiments-canon/backups/`
(pre-change copies of every file `fixrefs2.cjs` touched under `experiments/`).

## Closure

| Acceptance | Evidence |
|------------|----------|
| Top level canonical | `verify.cjs` §1 `all top-level entries canonical` |
| No file lost | `verify.cjs` §3 `before 5251 / after 5251 / missing 0 / extra 0` |
| Every move landed | `verify.cjs` §2 — all 113 manifest ops `ok` |
| References repaired | both fix waves idempotent on re-run; `scanrefs.cjs` 323 → 63 (deliberate remainder) |
| Product not broken | `bun typecheck` exit 0 (`20260915T070836Z_1475d0cd`) |
| Git tracking intact | `git status` shows `R` for the one tracked file under the tree |
