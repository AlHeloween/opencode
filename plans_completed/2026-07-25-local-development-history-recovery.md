# Local_Development history recovery

**Status:** complete
**Scope:** reconstruct the useful, independently verifiable work that was mixed into `7d5a2e05f8df0a64f3a81c574c5f56893e8944b2`.

## Prior art

reuse: local `safety/local-development-before-7d-unwind` preserves the original commits. `09228ff281` is the clean source for the session slice; do not reset to or cherry-pick monolithic `7d5a2e05`. Reapply only narrow, reviewable slices; never restore framework-owned receiver edits under `.cursor/skills/` or `.opencode/skills/`.

## Smoke Tests

### Baseline

| Command (cwd) | Expected now | Actual [Exact] |
|---|---|---|
| `bun test test/permission/next.test.ts` (`packages/opencode`) | pass | 79 pass, 0 fail (recovery validation) |
| `bun test test/session/request-diff.test.ts` (`packages/opencode`) | pass | 23 pass, 0 fail |
| `bun test test/session/compaction.test.ts` (`packages/opencode`) | pass | 73 pass, 0 fail |

### Post-implementation

| Command (cwd) | Pass criteria | Actual [Exact] |
|---|---|---|
| `bun test test/session/request-diff.test.ts` (`packages/opencode`) | pass | 25 pass, 0 fail |
| `bun test test/session/compaction.test.ts` (`packages/opencode`) | pass | 73 pass, 0 fail |
| `bun test test/session/checkpoint.test.ts` (`packages/opencode`) | pass | 18 pass, 0 fail |
| `bun test test/permission/next.test.ts` (`packages/opencode`) | pass | 79 pass, 0 fail |
| `bun typecheck` (`packages/opencode`) | exit 0 | exit 0 |

## Recovery work

- [x] Preserve former branch tip in `safety/local-development-before-7d-unwind` and reset `Local_Development` to `6c4af83896e3f1924c5fef3b86314af19a655cdd`.
- [x] Restore and validate the active-instance permission reply fix as a standalone commit.
- [x] Reconstruct the session visible-message/checkpoint optimization as independent, tested commits; exclude unrelated summary-flow changes (`37034dc76`).
- [x] Reassess plan documents only after their corresponding code is restored and validated. The plan moves from `4e421568` that depended on discarded `7d` work were intentionally not restored; unaffected active plans remain active.
- [x] Force-with-lease push the rebuilt `Local_Development` only after the final local history is coherent (`df8c8ab6d5`).
