# Candidate kernel/addon rules — evidence-before-attribution + per-edit verification

state: CANDIDATE (owner decision pending; not implemented)
scope: prompt_kernel/addons.py (G7/G8 advisory lines) + source.py only if the owner picks the binding form
origin: Alexander, 2026-09-12: "добавь это в планы как кандидат добавить в кернел,
        чтобы не метаться, ведь в натуре могучий тулсет"
evidence: `_progress_log.md` 2026-09-12; `.opencode/data/memory/reasoning.md` 2026-09-12
budget: utf8 30 000 / rendered **28 184** → **1 816 bytes free** (measured 2026-09-12)

> Consolidation note: this plan supersedes two near-duplicate drafts written earlier the
> same day — `2026-09-12_kernel-recovery-toolset-candidate.md` and
> `2026-09-12_kernel-edit-verification-discipline.md`. Both described the same incident
> and proposed overlapping addon lines. Creating a second overlapping candidate was itself
> an instance of the duplication the rule is meant to prevent, so the drafts are merged here
> and archived (not deleted) at
> `experiments/2026-09-12_deepseek-h3/superseded-plans/` — recoverable if the owner prefers
> one of their wordings over this text.
>
> The superseded drafts are archived (not deleted) at
> `experiments/2026-09-12_deepseek-h3/superseded-plans/` for provenance; they are reference-only
> and must not be treated as active plans.

## Context / goal

Two process failures, one incident. While implementing the DeepSeek thinking/h3 work I
broke `packages/opencode/src/provider/transform.ts` into a non-compiling state:
`bun run typecheck` → **22 errors, all in that file** (run `20260912T090706Z_a1404786`).

Damage shape (all self-inflicted — session `ses_f6c4405acffevaivEhhwIxOz0F`):

| symptom | count | detail |
|---|---|---|
| duplicate `isDeepSeekThinkingId` | 5 | lines 505, 540, 582, 600, 713 (+ a `const` arrow at 683) |
| duplicate `deepSeekEfforts` | 3 | 612, 641, 718 |
| duplicate `deepSeekVariants` | 2 | 557, 723 |
| duplicate `deepSeekThinkingVariants` | 2 | 518, 691 |
| orphan helpers from abandoned drafts | 3 | `isDeepSeekReasoningId`, `isDeepSeekThinkingModel`, `isDeepSeekPro` |
| lost `case` labels | 2 | `case "@openrouter/ai-sdk-provider"`, `case "@ai-sdk/gateway"` — bodies absorbed under `case "@ai-sdk/deepseek"`, leaving an unconditional `return` before dead google code |

Each duplicate carried a *different* doc comment: successive drafts of the same idea, never
consolidated. HEAD 1394 → 1598 lines. Mechanism: a stale-anchor `edit` inserting another copy
of a helper next to a near-identical anchor, without removing the previous one.

The two failures:

1. **A cheap oracle was deferred.** `grep -c "function <name>"` == 1 after each insertion,
   or a per-edit typecheck, would have caught every duplicate. I batched the oracle to the
   end of the turn instead.
2. **Unexplained state was blamed on an external actor, twice.** I claimed a "concurrent /
   parallel writer" for (a) the plan file 663→190 lines and (b) `transform.ts`. The record
   contradicted both: plan backups 49/49 in my own session dir; `transform.ts` 119/119
   tool-parts in my own session. The recovery instruments existed and went unqueried.
   The user's correction was exact:

   > «зачем тебе чекаут, у тебя пачка бэкапов на файл все твои редактирования и еще диф
   > по фоссилу, ну и гит сам посебе. Почему так брутально сразу, нас же никто в шею не гонит.»

## Prior art (REUSE.BEFORE)

- **G8 already carries the generalised rule for terminals**: `TOOL_ORACLE` —
  *"a shared cmd_runner session has two writers: attribute who drove the state and re-read
  the render after handing the window over."* This candidate applies the same attribution
  discipline to **file state**. The two lines must not read as duplicates (terminal vs file).
- `docs/gate-addons.md` — the addon-vs-kernel test: *"if deleting the line would change what
  the kernel decides → source.py; if it only says where a thing lives in this host project →
  addon."* Budgets are shared and raises are an owner decision.
- `prompt_kernel/tests/test_dedup.py::test_compacted_runtime_budget` — budget ledger; cap
  **30 000 bytes / 3 700 tokens**.
- Recovery instruments that actually worked, in preference order:
  `edit`-tool `.bak` (per-edit; `restore` tool) → Fossil snapshot (`fossil info/diff`, read-only)
  → git (`git show HEAD:<path>` to read; `checkout` is destructive and was correctly denied).
  The restore that worked used
  `…20260912-164703_call_00_qVi2ku2vZYcbQVNgVE962796_…transform.ts.bak` — verified
  HEAD-identical by hash (LF-normalised), after a first attempt picked the wrong backup
  (filename is local time, not UTC — read `LastWriteTimeUtc`, never the name).
- Artifact preserved during the incident: a broken `transform.ts` snapshot (61186 B), removed on
  2026-09-15 with the rest of the archive build leftovers.

## Proposed change

### Part 1 — addon lines (no kernel-graph change; ~3 lines, ≈330 bytes, inside the 1 816 free)

`G7` — new `EDIT_DISCIPLINE` addon (or appended to `TOOL_IMPLEMENT`):

```
inserting a named symbol: re-read the target region first; after the edit check the name occurs once.
a structural edit is not done until its oracle ran for THAT edit — never batch-end on a compile check.
unexplained file state: query the record first — restore-tool .bak, fossil diff/info, git show; repair from history before any VCS rewrite.
```

`G8` — append to `TOOL_ORACLE` (one line, keeps the file-state case next to the terminal case):

```
file state you cannot account for: attribute it to the record, never to an assumed external writer.
```

No `@`-references in addon lines (registry constraint).

### Part 2 — kernel rule (only if the owner wants it to bind, not advise)

A named rule such as `#### @EVIDENCE_FOR_ATTRIBUTION` referenced from G7: forbid stating a
causal claim about unexplained state without a record query. This **is** kernel content (it
changes what the kernel decides), so it needs `source.py` edits, a `baseline.json` re-pin,
and a binary rebuild — a separate authorization.

**Recommendation: Part 1 first.** Both failures are process errors that advisory lines address
directly, and one line is reversible; a kernel-graph edit is not. Escalate to Part 2 only if
the pattern recurs after Part 1 ships.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before touching addons.py)
| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---|---|---|
| 1 | `python -m pytest prompt_kernel/tests/ -q` (repo root) | all green | **78 passed in 1.60s** — run `20260912T103807Z_32a5bbb7` |
| 2 | budget probe: `python -c "…render_kernel(KERNEL, GATE_ADDONS)…"` | rendered ≤ 30 000 | **28 184 B, headroom 1 816** — measured 2026-09-12 |
| 3 | `cmd_runner start --cwd packages/opencode -- bun run typecheck` then `tail` | exit 0 | exit 0 — run `20260912T103321Z_596ff9ab` |

### Post-implementation oracles
| # | Command (cwd) | Pass criteria |
|---|---|---|
| 1 | `python -m pytest prompt_kernel/tests/ -q` | green; budget caps unchanged (no raise) |
| 2 | budget probe again | rendered + added bytes ≤ 30 000 |
| 3 | `python -m prompt_kernel --install` | prints `installed=<sha256>`; record it |
| 4 | `prompt_kernel/baseline.json` | sha matches the installed digest |
| 5 | render diff | only the new addon lines changed; gates/edges/state contracts byte-identical |
| 6 | grep rendered runtime | new lines inside the G7/G8 blocks; no `@`-refs; existing G8 attribution line intact |
| 7 | rebuild + new session | `reasoning_prompt.txt` embed check passes in the rebuilt binary |

### Gate
- [ ] Owner picked Part 1 or Part 2
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

## Risks

| id | trigger | severity | containment / rollback |
|---|---|---|---|
| R1 | the new G8 line reads as a duplicate of the existing cmd_runner attribution line, diluting both | medium | keep them scoped: one is about a *shared terminal*, one about *file state*; wording pass before install |
| R2 | budget creep / cap raise to fit wording | medium | 1 816 B free is enough; if not, trim and report overflow — **do not raise the cap** (owner decision) |
| R3 | advisory lines ignored in practice (the failure was behavioural) | medium | the lines are falsifiable per edit (`grep -c`, typecheck); measure over the next sessions before escalating to Part 2 |
| R4 | backup filenames are local time, not UTC — wrong backup restored | medium | always order by `LastWriteTimeUtc` and verify the restored file against HEAD by hash before proceeding |
| R5 | Part 2 tempts a premature `source.py` edit for a process problem | medium | Part 1 first; Part 2 needs a fresh owner decision, re-pin, rebuild |

## Rollback

Delete the added `GateAddon` tuple(s) from `addons.py`; re-run pytest + `--install`; restore
the previous `baseline.json` sha. `assert_current_kernel_unchanged()` must be green.

## Out of scope

- Rewriting the kernel gate graph (edges, terminals, budget structure).
- Tooling changes to `.bak` retention or fossil cadence.
- The `transform.ts` code repair itself — that belongs to
  `plans/2026-09-12_deepseek-thinking-h3.md` (T1–T3); this plan owns only the reflex.
