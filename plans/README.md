# Plans

Active plans. Completed plans move to `plans_completed/`.

## Testing Convention

1. **TS source first** — tests run against TypeScript source (`bun test`, `bun run --conditions=browser packages/opencode/src/index.ts`), not the compiled binary.
2. **Debug output** — use `--log-level DEBUG --print-logs` to capture diagnostic output during test runs.
3. **Build after tests** — `pwsh _build.ps1` only runs after all TypeScript tests pass, including TUI loading and answering prompts.

## Active Plans

| Plan | Status |
|------|--------|
| `2026-07-13_master-fossil-typecheck-jsc.md` | Active — Subplan 06 (build stress) remaining |
| `2026-07-05_wasm-cli-sandbox.md` | Research — Phase 1 done, Phases 2-3 not started |
