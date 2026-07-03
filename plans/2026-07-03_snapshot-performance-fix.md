# Snapshot Performance Fix

**Created:** 2026-07-03T08:26Z
**Status:** Active
**Severity:** High — causes 30-60s overhead per model step on large projects, forces users to delete `.opencode/data` repeatedly

## Problem

`Snapshot.track()` runs full git worktree scans on every call. With 5526 tracked files and `core.fsmonitor=false`, each call spawns multiple git processes that scan the entire project directory. `track()` is called 2-3 times per model step, creating ~60s of git overhead per step on Windows.

## Root Cause

In `packages/opencode/src/snapshot/index.ts`:

1. `track()` (line 295) calls `add()` then `git write-tree`
2. `add()` (line 211) runs:
   - `git diff-files --name-only -z -- .` — full worktree scan (O(n) files)
   - `git ls-files --others --exclude-standard -z -- .` — full worktree scan
   - `ignore()` — spawns `git check-ignore` against PROJECT's `.git` (line 127-131)
   - `fs.stat()` on every candidate file (concurrency 8)
   - `git add --all --sparse` — stages all allowed files
3. `core.fsmonitor = false` (line 308) — no incremental tracking
4. No caching — identical results computed on consecutive calls with no changes

In `packages/opencode/src/session/processor.ts`:

- Line 173: `track()` before LLM request
- Line 508: `track()` at start-step (if snapshot not set)
- Line 564: `track()` at finish-step

So `track()` runs 2x per step minimum (before request + at finish), sometimes 3x.

## Measurements

- Project: 5526 tracked files, 0 untracked, 3 modified
- Each `track()`: ~5 git process spawns + fs.stat batch + git add + git write-tree
- Estimated per-call: 10-30s on Windows (NTFS + git process startup overhead)
- Per step: 20-60s (2 calls)
- Per 17-step session: 5-17 minutes of pure git overhead

## Plan

### Task 1: Deduplicate `track()` calls in processor

**File:** `packages/opencode/src/session/processor.ts`

The `snapshot` field on `ctx` is set once (line 173/181) and reused at start-step (line 508). But finish-step (line 564) always calls `track()` again to capture post-execution state. Between start-step and finish-step, tools may have modified files, so the second call is necessary. However, between the initial `track()` (line 173) and start-step (line 508), nothing changes — the model hasn't even started yet. The start-step call is redundant.

**Change:** Remove the `track()` at start-step. Reuse `ctx.snapshot` which was already captured at line 173. The start-step part should use `ctx.snapshot` directly (it already does this via `snapshot: ctx.snapshot` at line 513).

```
- Line 508: if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
+ Line 508: // snapshot already captured at processor create (line 173)
```

**Impact:** Eliminates 1 git scan cycle per step. ~10-30s saved per step.

### Task 2: Cache unchanged `track()` results

**File:** `packages/opencode/src/snapshot/index.ts`

Add a dirty-flag cache: store the last `write-tree` hash. On next `track()` call, first run `git diff-files --quiet` (fast, exits 0 if clean). If clean, return cached hash without running `add()` or `write-tree`.

**Change in snapshot state (around line 295):**

```ts
let lastHash: string | undefined
let lastHashTime = 0

const track = Effect.fnUntraced(function* () {
  return yield* locked(
    Effect.gen(function* () {
      if (!(yield* enabled())) return
      // ... existing init code ...

      // Fast path: if cached hash exists and worktree is clean, return cached
      if (lastHash) {
        const check = yield* git(
          [...quote, ...args(["diff-files", "--quiet", "--", "."])],
          { cwd: state.directory },
        )
        if (check.code === 0) {
          log.info("tracking (cached)", { hash: lastHash })
          return lastHash
        }
      }

      yield* add()
      const result = yield* git(args(["write-tree"]), { cwd: state.directory })
      const hash = result.text.trim()
      lastHash = hash
      lastHashTime = Date.now()
      log.info("tracking", { hash, cwd: state.directory, git: state.gitdir })
      return hash
    }),
  )
})
```

**Impact:** When no files changed between consecutive `track()` calls (common between finish-step and next step's initial track), saves the full `add()` + `write-tree` cycle. `git diff-files --quiet` is much faster than `git diff-files --name-only` + staging.

### Task 3: Enable fsmonitor in snapshot gitdir

**File:** `packages/opencode/src/snapshot/index.ts`

Change line 308 from `core.fsmonitor = false` to `true`. This enables Git's built-in filesystem monitor which tracks file changes incrementally instead of scanning the full worktree on every command.

**Change:**

```ts
- yield* git(["--git-dir", state.gitdir, "config", "core.fsmonitor", "false"])
+ yield* git(["--git-dir", state.gitdir, "config", "core.fsmonitor", "true"])
```

**Risk:** On Windows, `fsmonitor` uses the native `fsmonitor` daemon (Git 2.37+). If the user's git version is old, this could fail silently. Need to verify git version >= 2.37.

**Impact:** `git diff-files` and `git ls-files` become near-instant after initial scan. Biggest single improvement.

### Task 4: Batch `ignore()` calls

**File:** `packages/opencode/src/snapshot/index.ts`

Currently `ignore()` (line 125-146) spawns a `git check-ignore` process using the PROJECT's `.git` (not the snapshot gitdir). This is a separate git process that also needs to parse `.gitignore` rules. When called with a large file list, this can be slow.

**Change:** The `ignore()` function already accepts a file list and processes it in one batch. Verify it's not being called multiple times per `add()` cycle. If the candidate list is small (only changed files), this is already efficient. No change needed unless profiling shows otherwise.

### Task 5: Add TTFB logging (already done)

**File:** `packages/opencode/src/session/processor.ts`

Already implemented in this session: `ttfb` log at first `text-start`/`reasoning-start`, `totalDurationMs` on `cache hit`/`cache miss`.

## Priority Order

1. **Task 1** (deduplicate) — zero risk, immediate 50% reduction in git calls
2. **Task 2** (cache) — low risk, eliminates redundant work when files unchanged
3. **Task 3** (fsmonitor) — medium risk, biggest single improvement but depends on git version
4. **Task 4** (batch ignore) — deferred, already batched

## Verification

After implementation:
1. Run opencode with a session, check logs for `tracking (cached)` entries
2. Measure time between step start and finish — should drop from ~3-4min to ~1-2min
3. Verify `ttfb` log shows actual model latency, not git overhead
4. Run on a project with 5000+ files to confirm scalability
