# Summary diff from the stored snapshot anchors

<!-- intention: a summary range diff re-reads tool metadata -> a summary range diff derives from the snapshot anchors the undo/redo chain already stores, tool metadata only as merge/fallback -->

Owner directive (2026-09-21, verbatim):

> «Причем приколись для undo/redo мы все делаем, сохраняем хеши снапшотов, которые следовало бы использовать для
> summary diff, потому что он гранулярный, но вместо этого мы крутим старые костыли.»

## Why (measured)

- **The anchors are already stored.** In this session: 4 379 `step-finish` parts carry `snapshot` (124 distinct —
  one per turn) and 1 254 `patch` parts carry `hash` (112 distinct). `snapshotHashesOnMessage` /
  `snapshotRangeForMessages` exist in `summary.ts` but are deprecated with **zero callers** — the crutch left behind.
- **The current summary diff cannot see the worktree.** `collectToolFileDiffs` reads write/edit/multiedit part
  metadata only: a shell-made edit, a deletion or a rename never reaches the summary.
- **`diffFull` is a stub.** `patch: ""` since `a4f6166c01` (2026-07-31); its stat parser splits on whitespace
  (paths with spaces break it), a binary file produces a bogus entry named after the parser's third word and drops
  the file itself, `to` is mandatory (no working-copy diff).
- **Fossil formats probed** (`experiments/2026-09-21_summary-diff-anchors/`, sandbox + real repo): `-s` gives
  per-file `N M path`; `--brief` gives `ADDED/DELETED/MISSING/CHANGED/EDITED`; `--verbose` gives full unified
  sections for added (`--- /dev/null`) and deleted (`+++ /dev/null` / `NUL`) files; binaries print
  "cannot compute difference between binary files" and no hunks.

## Changes

1. `snapshot/fossil.ts` — `diffFull(from, to?, paths?)`: `to` optional (working-copy diff); `--verbose` sections
   parsed into per-file patches (`parseDiffSections`); stat parser keeps whole paths and binary entries (0/0, no
   snippet); `MISSING` maps to status `deleted`.
2. `snapshot/index.ts` — interface picks up the optional `to`.
3. `session/summary.ts` — un-deprecate `snapshotHashesOnMessage`; replace `snapshotRangeForMessages` with
   `summaryRangeStartHash(messages, beforeMessages?)`; add `mergeAnchorDiffs`; `enrichRange` computes its range
   diff anchors-first (via `Effect.serviceOption(Snapshot.Service)`), tool metadata as the merge and as the
   fallback when no anchor/service exists. `beforeMessages` finally has a reader.
4. `compaction.ts` — the sidecar `tool_diff` label states the new source.
5. Docs: `summary-exact-handles.md`, `session-memory-graph.md`, `compaction.md`, `README.md` — "Fossil is
   rollback only" is replaced by the merge policy.
6. Tests: new `test/session/summary-anchors.test.ts` (resolver, merge, LIVE anchored capture); `snapshot.test.ts`
   gains the file-level timeout AGENTS.md requires of heavy files.

## Smoke Tests

- Baseline (before edit): `bun typecheck` exit 0; `bun test test/session/summary.test.ts
  test/session/summary-sidecar.test.ts test/session/summary-exact-live.test.ts` all pass.
- Post-change oracle 1: those suites + `test/session/summary-anchors.test.ts` pass.
- Post-change oracle 2 (decisive): in the live test a file changed with **no tool part anywhere** appears in
  `enrichRange.diffs` (status `added`, patch filled) — the tool-only path cannot produce it.
- Post-change oracle 3: `bun typecheck` exit 0.
- Control: with no Snapshot service in the layer, `enrichRange` returns exactly `collectToolFileDiffs`.

## Residuals (recorded, not done)

- `summarize()`'s per-step turn diffs stay tool-based — an anchored diff there spawns fossil on every
  finish-step (`diff --from` measured 3.1 s on a 106k-file tree) for a feed that updates per step.
- `revert.ts` `computeDiff` (post-undo `session_diff`) unchanged.
- `snapshot.test.ts` keeps its pre-existing reds from the git-era expectations (relative paths, untracked files
  visible to `patch()`/`diff()`): attributed to `63e088ff7d` / `a4f6166c01` (July 2026), not fixed here.
- Untracked files created by a shell command are invisible to the chain until the next boundary's `addremove`;
  the tool merge covers agent-written files in the window.
