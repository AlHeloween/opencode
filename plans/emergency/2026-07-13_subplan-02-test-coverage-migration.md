# Subplan 02: Migrate Stale Test Infrastructure Without Losing Coverage

## Objective

Replace tests tied to deleted internal Git/Worktree services with tests for the current Fossil architecture or preserve their Git CLI behavior where it is user-facing.

## Current Status — 2026-07-14

The listed tests are currently modified or deleted in the working tree. Their replacement coverage has not been run, so deletion is not evidence that the retired implementation is fully migrated.

## Affected Tests

- `packages/opencode/test/file/watcher.test.ts`
- `packages/opencode/test/git/git.test.ts`
- `packages/opencode/test/project/worktree.test.ts`
- `packages/opencode/test/project/worktree-remove.test.ts`
- `packages/opencode/test/server/httpapi-experimental.test.ts`
- session/snapshot tests importing `Snapshot.defaultLayer`
- `packages/opencode/test/session/cache-control.test.ts`

## Steps

1. [ ] Restore any accidental test deletions first; use the pre-change tree as the test-coverage baseline.
2. [ ] For watcher tests, remove only the deleted `Git.Service` layer dependency. Keep Git fixture cases that verify `.git/HEAD` watcher events and keep non-Git-root cases.
3. For `test/git/git.test.ts`, determine whether the old service API is an intentionally removed internal API:
   - if yes, replace unit tests with direct tests of retained `project/vcs.ts` behavior;
   - if no, reintroduce a minimal explicit agent-facing service contract backed by direct child-process spawning.
4. For deleted Worktree tests, map each assertion to its current product equivalent:
   - snapshot lifecycle → Fossil track/checkout/revert tests;
   - HTTP routes → remove only after confirming no current route advertises the retired worktree feature.
5. [x] Replace every `Snapshot.defaultLayer` test provider with `SnapshotFossil.defaultLayer`.
6. [ ] Update Git/JJ wording to Fossil version terminology; `session/revert.ts` still contains a JJ-specific rollback comment.
7. [ ] Update cache-control assertions to current hash field names and XXH64 output length; add fixed input/output hash vectors for regression safety.

## Acceptance Tests

- No test imports deleted `src/git` or `src/worktree` modules.
- Existing behavior coverage is retained or explicitly replaced by a Fossil test.
- Focused watcher, Fossil snapshot, session revert, summary, and cache-control suites pass.
- No test comments assert Git/JJ internals for Fossil operations.
