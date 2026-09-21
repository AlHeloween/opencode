# Snapshot test file re-baseline (git-era → fossil contract)

<!-- intention: test/snapshot/snapshot.test.ts pins the git backend's contract -> the file pins the fossil contract the product actually ships, and every open behavior question is named -->

## Why (evidence)

- The file was written for the **git** backend: `864041ba3f` (2025-09-17, "Switch snapshots to isolated
  git backend"); its assertions carry that era's contract (relative paths, untracked files visible to
  `patch()`/`diff()`, a file-size cap, POSIX `chmod`).
- The backend family changed **without the tests**: `63e088ff7d` (2026-07-04, "replace jj with Fossil SCM
  backend") touched **only** `src/snapshot/fossil.ts` (+382 lines) — `git show --name-only` lists zero
  `test/snapshot` files.
- The file was never a gate afterwards: post-fossil runs were `fossil-rollback` + `fossil-track` (32 pass)
  and the summary batch (114 pass); `snapshot.test.ts` (59 tests, heavy) was never in the loop.
  Same class as the recorded lesson: a constant change means finding its test FILE — a backend swap means
  finding its whole test file.

## Families (2026-09-21 run: 59 tests, ~35 assertion reds + load-induced timeouts)

1. **Stale mechanics** → re-point to the product's convention:
   - relative path expectations vs the absolute convention (m* and the summary merge both print/consume
     absolute) — ~10 assertions;
   - untracked files expected in `patch()` / `diff()` / `diffFull()` — ~15;
   - POSIX `chmod` test on win32 — 1.
2. **Silently unported behavior** → decide:
   - file size cap ("large added files are skipped"): `fossil.ts` has no size guard at all (grep: none).
3. **Fixed today** (`79c4b02271`): `diffFull` patch text for added/deleted files — those tests go green
   on their own; the binary test too (the parser no longer invents a "difference" entry).

## Decisions

- **Size cap: none.** A silent hole in the undo chain is worse than repo growth; exclusion is
  `ignore-glob` — explicit and visible (owner's «ЭТО ВСЕ КОД» ruling). The test asserts the current
  behavior and names the git-era origin in a comment. (If a cap is ever wanted it is one check, but it
  must be a *stated* one, not a silent skip.)
- **Untracked visibility: keep fossil semantics.** A written file enters the chain at the next boundary
  (`track([...])` / `addremove`); `extras`-style tree walks stay banned from this path (the >180 s hang
  class removed 2026-09-21). Tests pin both halves — invisible before the boundary, visible after.

## Scope

One bounded pass over `packages/opencode/test/snapshot/snapshot.test.ts`: mechanical path fixes; the ~15
untracked tests rewritten to the boundary semantics; the cap test switched to current behavior; a win32
guard for `chmod`. Every skip states WHY; no `test.todo`.

## Smoke Tests

- Baseline: `cd packages/opencode && bun test test/snapshot/snapshot.test.ts` — reds as classified above.
- After: same command → **0 fail** (named skips allowed, with reasons).
- `bun typecheck` exit 0.
- Control: `fossil-rollback` + `fossil-track` stay green; the summary batch stays 114/0.
