# Plans

Active plans. Completed plans move to `plans_completed/`.
Superseded / deferred designs live in `abstract_futures/` (do not implement from there).

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
| 1 | `bun test path` from `packages/opencode` | pass \| known fail: … | (record before first edit) |

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
- A bug fix is implementation: **do not edit code first and add smoke evidence later**. Record the current baseline (including a known failure) before the first fix, then prove the intended behavior after it.
- Vague "test later" or missing Smoke Tests → plan is incomplete; **do not implement**.
- Kernel rule: `SMOKE.BEFORE` (see `opencode_prompts_kernel.py` / runtime `RULES`).

## Testing Convention

1. **TS source first** — tests run against TypeScript source (`bun test`), not the compiled binary.
2. **Targeted evidence** — choose tests that exercise the claimed behavior and yield an actionable pass/fail oracle; elapsed-time runs alone are not acceptance evidence.
3. **Smoke before implement** — record baseline from the plan Smoke Tests section before the first edit; re-run post-impl oracles before marking items `[x]`.
4. **Build after source checks** — run `pwsh _build.ps1` when a packaged-artifact check is required by the changed surface.
5. **Never from repo root** — tests run from package dirs (e.g. `packages/opencode`).
6. **CodeGraph MCP smoke** — from `packages/opencode`: `bun test/codegraph/mcp_diff_smoke.ts` (fossil file diff → `codegraph_explore` over MCP stdio; hard-fail if MCP down).

## Active Plans

- `pre-existing-stuff.md` — documented test failures not caused by our changes

## Abstract futures (not active)

See `abstract_futures/README.md`. Includes parked Zig 0.16 migration notes and superseded HTTP API v2 design.

## Recently completed → `plans_completed/`

- `2026-07-30-b1-phase2-finish-step-single-tx.md` — **B1 phase-2**: `runBatch` + cost in one TX; graph `docs/finish-step-tx-graph.md`
- `2026-07-30-fix-mechanistic-compaction-trigger.md` — **B6**: in-band compact cadence = openTokens ≥ 65K (zero-token); graph in `docs/session-memory-graph.md`
- `2026-07-29-session-processor-acceleration.svm.md` — **Master SVM**: session processor bottleneck optimization (B1+B3+B5)
- `2026-07-29-session-processor-tx-consolidation.md` — **B1**: finish-step transaction consolidation (4–6→≤3 DB TX)
- `2026-07-29-permission-cache.md` — **B3**: permission request caching (60s TTL)
- `2026-07-29-hybrid-part-storage.md` — **B5**: hybrid part storage with indexed columns (migration)
- `2026-07-27-sidecar-incremental-checkpoints.md` — detached sidecar capture + `project_checkpoint` + session-diff worker; dual-path synthetic-summary removal deferred
- `2026-07-29-raster-viewport-renderer.md` (+ `.svm.md`) — opt-in raster viewport + hybrid production graphics; default raster enable deferred
- `2026-07-27-layer1-compaction-64k.md` — Layer-1 cadence `65_536` + provider-safe `summaryWindowLimit`
- `2026-07-27-system-reminder-audit.md` — neutralize primary whisper language in model-family prompts
- `2026-07-25_session_restore_checkpoint_delta.md` — SQL-visible restore, checkpoint delta load, request-diff suffix path
- `2026-07-29-atomic-native-graphics-scene.md` — hybrid one-canvas native graphics + encode/write diagnostics + transparent-gap oracle
- `2026-07-28-opentui-pixel-buffer-emission.md` — preserve pixel patches until native Kitty/Sixel emission
- `2026-07-28-opentui-sixel-standalone-lab.md` — isolated Mermaid-to-ImageRenderable visual oracle for direct Windows Terminal
- `2026-07-28-sixel-cell-calibration.md` — direct terminal cell metrics for calibrated Sixel placement
- `2026-07-28-sixel-quality.md` — Chafa-compatible Sixel raster and palette fidelity
- `2026-07-28-sixel-geometry-gating.md` — calibrated native Sixel Mermaid previews with safe fallback
- `2026-07-28-compact-mermaid-preview.md` — compact, readable Mermaid previews for native terminal graphics
- `2026-07-28-reasoning-rich-text.md` — route reasoning through the shared Markdown/Mermaid transcript renderer
- `2026-07-28-unified-rich-text-rendering.md` — shared Markdown/Mermaid transcript renderer for user and assistant messages
- `2026-07-23_codegraph_mcp_only.md` — CodeGraph MCP-touch → readonly SQLite pack, Fossil impact, and production smokes
- `2026-07-22_epistemic_guardrails.md` — Inferred/Exact guardrails
- `2026-07-24_summary-after-completion.md` — Layer-1 completion/resume plus persisted Fossil + CodeGraph Exact handles in `message*`
- `2026-07-26_mode_transition_guardrails.md` — one-shot mode-entry instructions; steady-state software enforcement
- `memory after compaction report.md` — historical compaction report
- `shell-output-parsing-bug.md` — shell-output parsing work
- `shell-output-reliability.md` — shell-output reliability work
- `state before compaction rev3.md` — historical compaction state record
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
