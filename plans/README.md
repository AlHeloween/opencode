# Plans

Active plans. Completed plans move to `plans_completed/`.

## Testing Convention

1. **TS source first** — tests run against TypeScript source (`bun test`), not the compiled binary.
2. **Targeted evidence** — choose tests that exercise the claimed behavior and yield an actionable pass/fail oracle; elapsed-time runs alone are not acceptance evidence.
3. **Build after source checks** — run `pwsh _build.ps1` when a packaged-artifact check is required by the changed surface.

## Active Plans

| Plan | Status |
|------|--------|
| `20260714_reasoning_kernel_taxonomy_compaction.md` | Active — taxonomy, compiler oracles, and KV-cache integration remain |
| `2026-07-05_wasm-cli-sandbox.md` | Research — Phase 1 done, Phases 2-3 not started |
