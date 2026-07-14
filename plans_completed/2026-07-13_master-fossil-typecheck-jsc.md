# Completed: Fossil Migration and Typecheck

## Outcome

The internal snapshot system now uses Fossil, relevant coverage migrated with it, and `bun typecheck` is clean.

| Subplan | Status |
|---------|--------|
| 01 Fossil migration | Complete |
| 02 Test coverage migration | Complete |
| 03 Typecheck | Complete |
| 04 Cache hash | Complete |
| 05 WASM gate | Complete (telemetry deferred) |
| 07 rg/fd removal | Complete |
| 08 Snapshot race | Complete — matching Fossil checkouts are reused safely |

## Removed Scope

The former Subplan 06 time-bound TUI/JSC stress run was removed on 2026-07-14 by user direction. A blind elapsed-time run without a representative workload, reproducible crash signal, or actionable oracle is not an acceptance criterion and must not be reinstated as one.

## Completed Acceptance

- Fossil snapshot tracking has no open/reinitialization/failed-commit loop and does not resolve an isolated worktree through an ancestor checkout.
- Agent-facing Git functionality remains separate from internal Fossil snapshots.
- Package typechecking is clean.
