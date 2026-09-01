# Plans

Active plans. Completed plans move to `plans_completed/`.

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
- Kernel rule: `SMOKE.BEFORE` (see `opencode_prompts_kernel.py` / runtime `RULES`).

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

- `2026-07-25_shell_dialect_preflight.md` — cmd/bash dialect preflight, COMMAND_UNAVAILABLE classification, description fixes (Windows `ls` false path oracle)
- `2026-07-22_epistemic_guardrails.md` — close the Inferred/Exact gap: job output marking, verification nudge, compaction decisions preservation

## Abstract futures (not active)

See `abstract_futures/README.md`. Includes parked Zig 0.16 migration notes and superseded HTTP API v2 design.

## Recently completed → `plans_completed/`

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
