# Plans

Active plans live directly in `plans/`. Completed plans move to `plans_completed/`.
Plans awaiting an owner decision after the 2026-09-24 code audit live in
[`to_be_confirmed/readme.md`](to_be_confirmed/readme.md). This is a holding shelf, not completion.

## Plan structure (required)

Every **implementable** plan must include:

1. **Context / goal** — what and why
2. **`## Prior art` (REUSE.BEFORE)** — what `universalsearch` found (`web` / Sourcegraph `code` / `hybrid`), or `reuse: N/A — {reason}` for trivial local-only work. Prefer reuse over reinvention.
3. **Implementation steps** — ordered checkboxes `[ ]` / `[x]`
4. **`## Smoke Tests` (PRE_FLIGHT gate)** — required before code edits

```markdown
## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)
| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | TUI/host shell **or** (heavy `bun test`) `cmd_runner start --cwd packages/opencode -- bun test path` + `cmd_runner tail <run_id>` | pass \| known fail: … | (record pass/fail from the tool output / **tail**, not from `start`) |

### Post-implementation oracles
| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | same or extended | must pass |

### Gate
- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]
```

- **`smoke: N/A — {reason}`** only for pure docs/plan-only (no runtime/code surface).
- Vague "test later" or missing Smoke Tests → plan is incomplete; **do not implement**.
- Kernel rule: `SMOKE.BEFORE` (see `prompt_kernel/source.py`).

## Plan state — FOUR forms, and every one is read (2026-09-22)

A plan's state may be written in any of four ways, and `parseLifecycle` reads all four. A reader that
knows one form declares the rest UNKNOWN: measured 2026-09-22, thirteen plans under `plans/` rendered
as `lifecycle UNKNOWN` while several of them wrote their state outright.

| form | example |
|---|---|
| workflow comment | `<!-- workflow: lifecycle EXECUTING \| gate G7 -->` |
| bold English | `**Status:** ACTIVE` |
| Russian, often mid-line after a date | `Дата: … Статус: **DRAFT**.` |
| machine line | `state: DRAFT` / `status: parked` |

Three rules the reader holds, each bought by a run: the **colon is required** (that is what keeps prose
out of the match); the read is limited to the document **HEAD** (a `**Status:**` quoted deep inside a
body is somebody else's state); `state:`/`status:` is **line-anchored** because it is always its own
line.

**A plan with no checklist is NEVER moved** — `noChecklist`, state unknown from outside — and
`planstatus` splits that class in two: the files that WRITE their state versus the ones that state
nothing. Reading a state is not earning a completion: only `hasChecklist && !hasOpenItems` moves a file,
and every other terminal (`plans_deferred/`, `plans/futures/`, `plans/postponed/`) is chosen by a NAMED
ground, by hand, in a `git mv` commit that names it.

## Testing Convention

1. **TS source first** — tests run against TypeScript source (`bun test`), not the compiled binary.
2. **OpenCode TUI already has its own shell / test path.** Use those for ordinary commands. Do not wrap every `bun test` in `cmd_runner` just because it is `bun`.
3. **`cmd_runner` is for load, not for “being bun”.** A full `bun test` can pin every core and freeze even a current workstation (Bun’s runner + TS transpile + many files). TUI tools do not demote that. `cmd_runner` starts **any** child at **low process priority**, so the suite cannot take the machine. Use it for `bun test` / typecheck / fat builds:
   ```
   cmd_runner start --cwd packages/opencode -- bun test ./test/session/foo.test.ts
   ```
   `start` prints a `run_id` and a few trailer lines — **that is not the result.** Pass/fail, fail text, and `N pass / M fail` live in the run log. Always:
   ```
   cmd_runner tail <run_id>
   ```
   Use `cmd_runner tail <run_id> --follow` if the suite is still running. Do not record Actual [Exact] from `start` alone. `wait` then `tail` is fine; `list` / `status` are not a substitute for `tail`.
4. **Targeted evidence** — choose tests that exercise the claimed behavior and yield an actionable pass/fail oracle; elapsed-time runs alone are not acceptance evidence.
5. **Smoke before implement** — record baseline from the plan Smoke Tests section before the first edit; re-run post-impl oracles before marking items `[x]`. Actual [Exact] = TUI/host transcript **or** the `tail` log (pass count / first failure), never “cmd_runner started”.
6. **Build after source checks** — `pwsh _build.ps1` when a packaged-artifact check is required. Heavy build → `cmd_runner` (low priority) + `tail`.
7. **Never from repo root** — tests run from package dirs (e.g. `--cwd packages/opencode`).
8. **CodeGraph MCP smoke** — cwd `packages/opencode`: `bun test/codegraph/mcp_diff_smoke.ts` (fossil file diff → `codegraph_explore` over MCP stdio; hard-fail if MCP down). TUI/host tool, or `cmd_runner` + `tail` if the run is heavy.

## Active Plans

The live list is NOT written down here — it is READ FROM THE FILES. Run `planstatus` (or
`getPlanStatus(worktree)`): the report prints placement, the backlog, the checklist-less class and
`@LOOP_MEASURE`'s axes. A hand-maintained index beside the plans is a second source of truth and goes
stale the moment a plan moves — measured 2026-09-22, three of the four entries that used to sit here
had already moved on.

The 18 plans from the 2026-09-24 audit were moved to `to_be_confirmed/` by owner request.
`planstatus` does not scan that subdirectory. Its [readme](to_be_confirmed/readme.md)
records what must be checked before any plan is resumed or closed.

(Completed work moves to `plans_completed/`; most recently `2026-09-13_tui-routing-interaction-repair.md` — landed `918f114db8`.)

## Futures → `plans/futures/`

Research-complete or parked directions, kept as reference rather than active work:

- `futures/2026-09-16_reasoning-roundtrip-vendor-matrix.md` (+ `MATRIX.md`) — primary-source
  vendor CoT-replay contract matrix (2026-09-18). Research delivered; encoding it into
  `transform.ts` branches is the remaining step.

## Abstract futures (not active)

See `abstract_futures/README.md`. Includes parked Zig 0.16 migration notes and superseded HTTP API v2 design.

## Recently completed → `plans_completed/`

The list below is HISTORY and stops where it stops; the live count and the live placement come from
`planstatus`. Kept as prose because a completed plan needs no live index — it needs its artifact.

- `2026-09-18_jobs-db-pid-persistence-and-orphan-sweep.md` — jobs.db persists `pid`+`owner_pid`; boot recovery is instance-aware (a live neighbour runtime's rows are left alone, a dead runtime's orphan tree is killed) under a pid-reuse guard; `job_kill` on a `killed` job re-attempts a guarded tree kill. Found + fixed: `Process.StartTime.Ticks` is local → the guard would silently never fire (`.ToUniversalTime()`). jobs 27/27, workflow 4/4, agent 50/50, core 24/24, typecheck ×2 exit 0, negative control run
- `2026-09-18_jobs-stall-reset-tree-kill.md` — background-job streaming into the job writer, one ⚠ stall notice with an agent-resettable deadline (`jobreset`), real tree kill (`taskkill /T /F` before `proc.kill`), read-offset fix; hard tests pin all of it
- `2026-09-15_huggingface-live-sync.md` — HF added to `PROVIDER_SOURCES` in merge mode: curated metadata survives, live pricing/context win, new ids added (77→144, incl. `zai-org/GLM-5.3-Flash-BF16`); 19 tests pass; build + CLI + router + E2E smoke verified
- `2026-09-13_experiments-canonization.md` — `experiments/` top level unified to `yyyy-mm-dd_brief`; 113 move ops (5251 files, no loss), 204 reference rewrites across two waves, `verify.cjs` PASS + typecheck exit 0
- `2026-09-13_tui-routing-interaction-repair.md` — routing dialog interaction model: heading-skipping traversal, radios, pointer parity, live mode line; landed `918f114db8`, T4 closed by a direct-terminal capture
- `2026-09-12_deepseek-thinking-h3.md` — DeepSeek name-drift fix: one `isDeepSeekThinkingId` family predicate + catalog-driven variant sets (`deepseek-flash` → `off/low/high/max`, `deepseek-v4-pro` → `off/high/max`); h3 unavailable on `api.deepseek.com`; the tool-turn 400 misattribution corrected. T4 (TUI labels) left open
- `2026-09-12_kernel-evidence-and-edit-discipline.md` — candidate kernel/addon rules: query the record before attributing unexplained state; per-edit verification (grep -c == 1, oracle per edit). Owner decision pending
- `2026-09-01_kernel-tautology-fix.md` — kernel headings no longer declare+reference themselves (`X (@X)` → `X`); parens kept only for title≠anchor; dictionary parser fallback
- `2026-08-27_kernel-assembly-reverification.md` — fold supremacy-clause dedup into assembly pipeline: dist byte-identical to production, precompiled regen, refcheck path fix
- `2026-07-23_codegraph_mcp_only.md` — CodeGraph MCP-touch → readonly SQLite pack, Fossil impact, and production smokes
- `2026-07-22_async_job_streaming_and_progress_interval.md` — background job streaming + interactive job_wait
- `20260718_system_prompt_order_fix.md` — KV cache ordering (implemented in system-compose.ts)
- `TUI-session-crash-investigation.md` — TUI session crash (fixed via multiple commits)
- `organize-gitignore.md` — cosmetic gitignore headers (deferred — not worth the churn)
- `2026-07-16-tui-startup-parallelization.md`
- `emergency/2026-07-16-tui-cpu-performance-audit.md`
- `20260714_reasoning_kernel_taxonomy_compaction.md`
- `2026-07-15_block-anchor-replacer-fix.md`
- `2026-07-15_git-push-no-verify-prohibition.md`
- `2026-07-16_incremental-summary-compaction.md`
- `2026-07-05_wasm-cli-sandbox.md`
