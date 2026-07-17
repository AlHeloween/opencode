# Plans

Active plans. Completed plans move to `plans_completed/`.
Superseded / deferred designs live in `abstract_futures/` (do not implement from there).

## Testing Convention

1. **TS source first** — tests run against TypeScript source (`bun test`), not the compiled binary.
2. **Targeted evidence** — choose tests that exercise the claimed behavior and yield an actionable pass/fail oracle; elapsed-time runs alone are not acceptance evidence.
3. **Build after source checks** — run `pwsh _build.ps1` when a packaged-artifact check is required by the changed surface.

## Active Plans

| Plan | Status |
|------|--------|
| `2026-07-16-tui-startup-parallelization.md` | Phase 1 + 3.1 done; Phase 2 caches optional |
| `emergency/2026-07-16-tui-cpu-performance-audit.md` | Core items done; optional profiling follow-ups |

## Abstract futures (not active)

See `abstract_futures/README.md`. Includes parked Zig 0.16 migration notes.

## Recently completed → `plans_completed/`

- `20260714_reasoning_kernel_taxonomy_compaction.md`
- `2026-07-15_block-anchor-replacer-fix.md`
- `2026-07-15_git-push-no-verify-prohibition.md`
- `2026-07-16_incremental-summary-compaction.md`
- `2026-07-05_wasm-cli-sandbox.md`
