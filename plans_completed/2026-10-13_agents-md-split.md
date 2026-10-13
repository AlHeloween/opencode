# AGENTS.md split — rules stay, prose moves to docs/ with an index, plus a size guard

<!-- intention: AGENTS.md has swollen to 98 199 B / 1 303 lines / 34 sections, injected into every session as instructions -> AGENTS.md keeps the rules (front matter + a few lines per section + a `Details:` pointer) at ≈ half its size, every moved paragraph lives VERBATIM in a topic doc under docs/, docs/README.md and the AGENTS.md Documentation Index name each new/extended doc, and a pre-commit guard fails the next swelling -->

<!-- goal_sv: agents-md-split, rules-vs-prose, lossless-move, doc-index, size-guard -->

- **plan_id:** 2026-10-13_agents-md-split
- **revision:** 1
- **state:** COMPLETED (2026-10-13)
- **reported:** owner, 2026-10-13: «agents.md раздулся, отправь робота разрулить и раскидать по документации с индексацией» (robot brief, same day: keep rules; move history/measurements/tables/rationale/quotes verbatim; index in docs/README.md; anchors keep resolving; lossless oracle; pre-commit size guard; one commit).
- **why it matters:** AGENTS.md is read as instructions by every session (opencode injects it; `.claude/CLAUDE.md` is the Claude-side consumer) — each kilobyte is paid by every robot and every Claude session, every turn. Measured 2026-10-13: 98 199 B / 1 303 lines / 34 sections; 20 563 B on 2026-09-15 (×4.8 in four weeks, 30 commits).
- **envelope (owner, 2026-10-08, restated in the brief):** worktree `D:\zPython\opencode`, branch `Local_Development`, no branch switch, no worktree; commit only own paths (`git add <path>`, never `-A`); no `bin/`; no `--no-verify`; shared `_progress_log.md` — append only; tests via cmd_runner, one file per call; `_build.ps1` via cmd_runner at the end.

```yaml
Keywords: agents-md-split 0.30, rules-vs-prose 0.24, lossless-move 0.18, doc-index 0.16, size-guard 0.12
Semantic dominant: Split AGENTS.md into rule stubs plus verbatim topic docs indexed from both ends, proven lossless by a paragraph oracle, with a pre-commit size guard.
md5: 7c41f0a2d9b3e65718ac24d05fe6b930
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Context / goal

AGENTS.md today = rules + three weeks of accumulated rationale, measurements, tables, worked examples and owner quotes. The split keeps the governance in place and moves the record where it is read on demand:

1. **AGENTS.md keeps the RULES**: the front matter (`intent`/`state`/`scope`/`constraints`/`forbidden_actions`/`invariants`/`acceptance_tests`) and, per section, the rule itself in a few lines + one `Details: [docs/<file>.md](docs/<file>.md)` pointer. Every section heading stays (this is what keeps `AGENTS.md § <section>` references from 30+ files resolving).
2. **Everything else MOVES — verbatim, never paraphrased**: history, measurements, tables, rationale, worked examples, every owner verbatim quote go into topic docs under `docs/` (an existing doc is reused when it already owns the topic; a new file only when none does). An owner quote stays verbatim wherever its rule now lives.
3. **Index from both ends**: `docs/README.md` and the AGENTS.md § Documentation Index name every new/extended doc, one line each.
4. **Lossless oracle** (`experiments/2026-10-13_agents-md-split/lossless.py`): every paragraph of `git show HEAD:AGENTS.md` (paragraph = blank-line block, split at top-level list items; whitespace-normalized) must be found in the new `AGENTS.md` or `docs/**`; prints the count not found (**must be 0**) plus the new AGENTS.md size.
5. **Guard**: `.husky/pre-commit` (the hook that already prints «No peer dependency warnings» on every commit) gains a check that FAILS when AGENTS.md exceeds `budget = ceil(post-split size × 1.15)` bytes, naming the overflow and «move prose to docs/». **Budget is recorded here at T6, after the post-split size is measured** (task instruction: the budget number is written in the plan).

### Section → target map (reuse first; a new file only where no doc owns the topic)

| AGENTS.md section | Moves to |
|---|---|
| STOP — the SDK/upstream question (P015–P031, subheads) + Auto-Generated Code table (P203) | **new** `docs/upstream-relation.md` |
| Storage Paradigm: concurrency rationale, scope, wrong turn, accepted cost, engines, migration order (P048, P051–P058) | **new** `docs/storage-paradigm.md` |
| Debugging Paradigm body (P060–P064, P068) + Hashing (P070–P075) + Granularity quote (P077) | **new** `docs/debugging-paradigm.md` |
| Bug Policy: direction-of-change, silently-asserting test, tool-contract, write-path oracle items | **new** `docs/bug-policy.md` |
| Plan Maintenance: MASTER_PLAN rationale (P107), renderer (P109), JOB FAILED items (P114–P117), commit-not-closure rationale (P121, P122) | **new** `docs/plan-maintenance.md` |
| Style Guide code blocks + subheads (P126, P128, P129, P132, P133, P136, P137, P140, P141, P144, P145, H731/H744/H758/H776) | **new** `docs/style-guide.md` |
| Host Toolchain inventory (P169–P172) | **new** `docs/host-toolchain.md` |
| Build after tests details (P177, P178) + full-suite measurement (P182) | **new** `docs/build-and-run.md` |
| Provider Reach: why-postulate (P219), provider table (P221–P223), evidence (P227, P228) | **new** `docs/provider-reach.md` |
| Project Paradigm layer table (P037) + closed-loop doctrine (P039–P042) + Agent Inventory (P241–P243) | extends `docs/architecture.md` |
| Continuity Paradigm owner quote (P088) | extends `docs/compaction.md` |
| Content Lifecycle: owner quote, verb table, corollary, shipped-status (P081, P082, P085, P086) | extends `docs/content-lifecycle.md` |
| Fossil Snapshot System detail (P152) | extends `docs/fossil-snapshot.md` |
| Unknown-apps rule (P165) + cmd_runner debugger (P197–P200) | extends `docs/tools-and-sidecars.md` |
| Search instruments owner quote (P252) + no-script constraint rationale + ADM dissertations (constraints item L48–96) | extends `docs/tool-playbook.md` |
| Language-slip rationale (P010) | extends `docs/agentic-reasoning-runtime.md` |

Kept verbatim in AGENTS.md, among others: constraints/forbidden/invariants/acceptance front matter (minus the one no-script item, replaced by a compact rule + pointer), Shell Command Restrictions table, opencode Paths table, KV Cache, Checkpoint, dependency catalog, kernel workflow, Markdown flag, the Documentation Index, the four Storage rules, the Continuity rules, the Granularity rules, the Provider-Reach guards, Search-instruments order.

## Prior art (REUSE.BEFORE)

- Reused topic owners (checked against the `docs/` inventory): `compaction.md`, `content-lifecycle.md`, `fossil-snapshot.md`, `architecture.md`, `tools-and-sidecars.md`, `tool-playbook.md`, `agentic-reasoning-runtime.md`, `external-file-locations.md` — the moved blocks land in the doc that already owns the topic; only where none does (9 docs) is a new file created.
- Anchor consumers measured before the split: `git grep -n -e "AGENTS\.md#" -e "AGENTS.md §"` over the tracked tree → 39 lines in 34 files (docs, plans, plans_completed, plans_deferred, prompt_kernel addons/tests, packages/opencode src/test). The split keeps every section heading in AGENTS.md so `§` references keep resolving without edits; `AGENTS.md#`-style links are re-checked at T5.
- `reuse: internal doc reorganization — the experiments canon (`experiments/` → `experiments_history/`) and the existing docs index pattern are the only prior art needed; no external search`.

## Implementation steps

- [x] T1 Create the 9 new topic docs, moved blocks verbatim. — done 2026-10-13: `upstream-relation`, `storage-paradigm`, `debugging-paradigm`, `bug-policy`, `plan-maintenance`, `style-guide`, `host-toolchain`, `build-and-run`, `provider-reach`.
- [x] T2 Extend the 7 existing topic docs with their moved blocks (content verbatim). — done: `architecture`, `compaction`, `content-lifecycle`, `fossil-snapshot`, `tools-and-sidecars`, `tool-playbook`, `agentic-reasoning-runtime`.
- [x] T3 Rewrite AGENTS.md by surgical deletes + `Details:` pointer inserts (`edit`, never a full-file rewrite). — done: 96 896 B / 1 303 lines → 49 737 B / 745 lines; blob hash verified against HEAD immediately before the edit; 72 entries applied in one call.
- [x] T4 Index: one line per new/extended doc in `docs/README.md` and the AGENTS.md § Documentation Index. — done: new «Governance» sections in both.
- [x] T5 Anchors: `git grep -n -e "AGENTS\.md#" -e "AGENTS.md §"`; every hit resolves — or the referring file is updated. — done: every § target keeps its heading; the one dangling ref (`test/tool/read.test.ts` «AGENTS.md § Testing Convention», never a section) corrected to the constraints rule.
- [x] T6 Oracle: `lossless.py` — NOT FOUND must be 0; record size + budget. — done: 0/449; 50 482 B on disk; budget 58 055 B (see Recorded result).
- [x] T7 Guard: `.husky/pre-commit` size check, proven FALLIBLE. — done: `.husky/agents-size-guard.mjs` + `guard_proof.ts`; run `20261013T130554Z_78fd5ffa` → exit 0 default / exit 1 at `AGENTS_MD_BUDGET=1` naming «Move prose to docs/» / `GUARD_FALLIBILITY_OK`.
- [x] T8 `pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root; read `state.json`. — done: run `20261013T130746Z_5994a00f`, exit 0 (`state.json`: finished, bytes_written 66 165, no drops/truncation); smoke `10.0.1307`, artifacts staged to `dist/`.
- [x] T9 `_progress_log.md` entry (append), tick boxes, move plan to `plans_completed/` (`git mv`), re-run `svm render`, commit own paths naming the plan. — done this session; the commit names this plan.

## Risks and containment

- **Concurrent writers in AGENTS.md** (other robots): re-read immediately before the edit; every address fail-closed; a refused call writes nothing; re-read and redo.
- **Oracle unit**: paragraph = blank-line block split at top-level list items (`- ` / `N. `), whitespace-normalized, substring match against `AGENTS.md` + `docs/**/*.md`. Items are atomic — a kept item is kept whole, a moved item moves whole; a summary replacing a moved item is NEW text (the original stays verbatim in docs).
- **Index duplication** (AGENTS.md index vs docs/README.md): both are updated in this change; the AGENTS.md index keeps root-relative links (valid only from the repo root), docs/README.md keeps docs-relative links — the addresses that were valid before stay valid.
- **Anchors**: all section headings stay in AGENTS.md, so `AGENTS.md § X` refs resolve; `AGENTS.md#`-style links are re-checked at T5.

## Smoke Tests

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `python experiments/2026-10-13_agents-md-split/lossless.py` (repo root) | PASS, 0 not found — positive control: with the CURRENT AGENTS.md in the corpus every old paragraph is present | **PASS — 0/449** [Exact] |
| 2 | `python experiments/2026-10-13_agents-md-split/lossless.py --no-agents` (repo root) | FAIL, ≈260 not found — negative control: the checker must be able to fail (docs alone do not contain the old file) | **FAIL — 424 not found** [Exact] (checker proven fallible) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `python experiments/2026-10-13_agents-md-split/lossless.py` (repo root) | NOT FOUND = 0 with the NEW AGENTS.md; prints new size |
| 2 | guard fallibility: `bun -e '<check with budget=1>'` (repo root) | exit 1, names the 98 199 B overflow and «move prose to docs/» |
| 3 | `cmd_runner start --cwd . -- pwsh -NoProfile -File _build.ps1` then read run `state.json` | exit 0 |
| 4 | `git grep -n -e "AGENTS\.md#" -e "AGENTS.md §"` (repo root) | every hit names a section/heading that still exists in AGENTS.md or a doc that exists |

**Actual [Exact]:** (1) NOT FOUND = 0 (449 paragraphs); new size 49 737 B (blob) / 50 482 B (disk). (2) guard proof run `20261013T130554Z_78fd5ffa` — exit 0 within the 58 055 B budget; exit 1 at `AGENTS_MD_BUDGET=1` naming «Move prose to docs/»; `GUARD_FALLIBILITY_OK`. (3) recorded at T8. (4) all `AGENTS.md §` refs resolve; the single dangling ref updated (`read.test.ts`).

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

## Recorded result

- post-split AGENTS.md size: **49 737 B (blob, LF) / 50 482 B on disk (CRLF), 745 lines** — was 96 896 B / 98 199 B / 1 303 lines.
- guard budget = ceil(size × 1.15): **58 055 B** (set in `.husky/agents-size-guard.mjs`; `AGENTS_MD_BUDGET` exists only to prove the failure path).
- lossless run: `lossless.py` — **NOT FOUND = 0 / 449 paragraphs** (positive control 0, negative `--no-agents` 424); one intermediate miss found and repaired (a Search-instruments pointer had split a block fused with the CODEGRAPH markers).
- guard fallibility run: cmd_runner run `20261013T130554Z_78fd5ffa` — exit 0 within budget; exit 1 at `AGENTS_MD_BUDGET=1` naming the overflow and «Move prose to docs/»; `GUARD_FALLIBILITY_OK`.
- build: run `20261013T130746Z_5994a00f` — exit 0, smoke 10.0.1307, artifacts staged to `dist/`.
- residual recorded: cmd_runner payload defect for `.cmd` targets (workaround: wrap in `pwsh`), in `experiments_history/2026-10-13_agents-md-split/RESULTS.md`.
- guard fallibility run: (pending)
