# Subplan 01: Complete Internal Fossil Layer Migration

## Objective

Ensure every internal snapshot/revert/summary path uses Fossil while preserving legitimate agent-facing Git capabilities.

## Current Status — 2026-07-14

Production consumers are wired to `SnapshotFossil.defaultLayer`, but the diagnostic run repeatedly fails `fossil open`, deletes/recreates the repository, and then fails to commit. The captured Fossil stderr identifies an out-of-sync local checkout database for the root worktree repository. This plan is not complete until that lifecycle is proved stable.

## Target Files

- `packages/opencode/src/snapshot/index.ts`
- `packages/opencode/src/snapshot/fossil.ts`
- `packages/opencode/src/session/revert.ts`
- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/session.sql.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/summary.ts`
- `packages/opencode/src/effect/app-runtime.ts`
- `packages/opencode/src/effect/bootstrap-runtime.ts`
- `packages/opencode/src/project/bootstrap.ts`
- `packages/opencode/src/project/vcs.ts`
- `packages/opencode/src/cli/cmd/debug/snapshot.ts`

## Steps

1. [x] Build a call-site table for every `Snapshot.Service` method and verify its provider is `SnapshotFossil.defaultLayer`.
2. [x] Define and test the Fossil checkout invariant: each intended worktree has one matching local checkout database and repository; an isolated worktree must not resolve through an ancestor `_FOSSIL_` checkout.
3. [x] Replace destructive failed-open recovery. A failed `fossil open` must not delete a repository while retaining incompatible checkout state; recovery must be explicit, atomic, and scoped to the affected checkout/repository pair.
4. [x] Replace stale JJ-specific comments in `session/revert.ts` with Fossil snapshot/checkout terminology.
5. [x] Replace comments in `project/vcs.ts` that refer to deleted `Git.Service`; retain direct Git process helpers because they serve agent-facing branch/diff behavior.
6. [x] Decide and document legacy naming for `op_id` / `opRestore`:
   - retain as compatibility aliases if persisted records use it;
   - otherwise introduce a versioned data migration to Fossil-oriented names such as `snapshot_version` and `checkout`.
7. [x] Remove snapshot backup/baseline/ADID runtime files from source and test trees only after confirming they are not tracked canonical artifacts.

## Acceptance Tests

- `rg 'Git\.Service|Worktree\.Service' packages/opencode/src` returns no internal-service reference.
- `SnapshotFossil.defaultLayer` provides all production snapshot consumers.
- Repeated initialization, track, restore, revert, diff, and diffFull operations preserve one checkout/repository pairing with no `fossil open failed`, reinitialization, or failed commit.
- An isolated experiment does not access the root worktree Fossil repository or checkout database.
- No source-tree `*.backup_*`, `*.baseline`, or `*.adid.log.jsonl` snapshot artifacts remain.
