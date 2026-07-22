# Plans

Active plans. Completed plans move to `plans_completed/`.
Superseded / deferred designs live in `abstract_futures/` (do not implement from there).

## Testing Convention

1. **TS source first** — tests run against TypeScript source (`bun test`), not the compiled binary.
2. **Targeted evidence** — choose tests that exercise the claimed behavior and yield an actionable pass/fail oracle; elapsed-time runs alone are not acceptance evidence.
3. **Build after source checks** — run `pwsh _build.ps1` when a packaged-artifact check is required by the changed surface.

## Active Plans

- `2026-07-22_epistemic_guardrails.md` — close the Inferred/Exact gap: job output marking, verification nudge, compaction decisions preservation

## Abstract futures (not active)

See `abstract_futures/README.md`. Includes parked Zig 0.16 migration notes and superseded HTTP API v2 design.

## Recently completed → `plans_completed/`

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
