# Plans

Active plans. Completed plans move to `plans_completed/`.
Superseded / deferred designs live in `abstract_futures/` (do not implement from there).

## Testing Convention

1. **TS source first** — tests run against TypeScript source (`bun test`), not the compiled binary.
2. **Targeted evidence** — choose tests that exercise the claimed behavior and yield an actionable pass/fail oracle; elapsed-time runs alone are not acceptance evidence.
3. **Build after source checks** — run `pwsh _build.ps1` when a packaged-artifact check is required by the changed surface.

## Active Plans

_None._ Core TUI perf, startup parallelization, and reasoning-kernel work are complete.
Optional leftovers (plugin/config caches, session streaming API, deeper memo rewrites) were parked: they risk quality for little measured benefit.

## Abstract futures (not active)

See `abstract_futures/README.md`. Includes parked Zig 0.16 migration notes and superseded HTTP API v2 design.

## Recently completed → `plans_completed/`

- `2026-07-16-tui-startup-parallelization.md`
- `emergency/2026-07-16-tui-cpu-performance-audit.md`
- `20260714_reasoning_kernel_taxonomy_compaction.md`
- `2026-07-15_block-anchor-replacer-fix.md`
- `2026-07-15_git-push-no-verify-prohibition.md`
- `2026-07-16_incremental-summary-compaction.md`
- `2026-07-05_wasm-cli-sandbox.md`
