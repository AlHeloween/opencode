# Fossil Snapshot Leaf-Artifact Bug — Reproducible Experiment Plan

**Date:** 2026-08-03
**Status:** Experiment design (tests expected to FAIL pre-fix, PASS post-fix)

---

## 1. Bug Summary

When `fossil checkout --force <hash>` switches between snapshot leaves, files that
exist in the **current** leaf but NOT in the **target** leaf are left on disk as
untracked "extra" files. The next `track()` (auto-snapshot) picks them up via
`fossil add --force`, permanently re-adding them to the new leaf. This causes
"completed" files to reappear as active.

### Affected Code Paths

| Path | File:Line | Operation |
|------|-----------|-----------|
| `opRestore` / `checkout` | `fossil.ts:397-407` | `fossil checkout --force <targetVersion>` |
| `restore` | `fossil.ts:433-443` | `fossil checkout --force <snapshot>` |
| `track` (per-file) | `fossil.ts:282-293` | `fossil add --force <rel>` for each file |
| `track` (whole-tree) | `fossil.ts:294-301` | `fossil addremove` — reconciles the full worktree |
| undo entry point | `revert.ts:47-156` | calls `snap.restore()` then `snap.revert()` |
| redo entry point | `revert.ts:158-171` | calls `snap.checkout(op_id)` |

### Root Cause

`fossil checkout --force` switches the working copy to the target version's
tracked file set, but does **NOT** delete files that exist on disk but are not
tracked (or not tracked at that version). The word "force" here means "allow
checkout even when there are uncommitted changes" — it does NOT mean "clean
extraneous files." **`fossil clean` is never called** anywhere in the codebase.

### Fix Hypothesis

After every `fossil checkout --force`, call `fossil clean --force` to remove
untracked files from the working directory. This aligns the on-disk state with
the snapshot's tracked file set.

```diff
// fossil.ts — after every checkout/opRestore/restore call:
  const result = yield* fossil(["checkout", "--force", targetVersion], { cwd: worktree })
+ yield* fossil(["clean", "--force"], { cwd: worktree }).pipe(
+   Effect.catch(() => Effect.void)
+ )
```

---

## 2. Experiment 1: Single Undo/Redo Cycle

### Scenario

A plan file moves from `plans/test-plan.md` (active) to
`plans_completed/test-plan.md` (completed). Undo reverts the completion. Redo
re-applies it — but `plans/test-plan.md` is left on disk as a stale extra file.

### Step-by-Step Procedure

#### Setup (bootstrap)

```
1. tmpdir({ git: true }) creates a temp directory with a git repo
2. Instance.provide({ directory, fn }) boots the Effect runtime
3. Snapshot.Service is available via SnapshotFossil.defaultLayer
4. Initial baseline: snapshot.track() → hash "init"
```

#### Step 1 — Create active plan

```ts
// Write: plans/test-plan.md with "- [ ] Task 1"
await write(path.join(dir, "plans", "test-plan.md"), "- [ ] Task 1")
```

**File system state:**
```
plans/
  test-plan.md    ← "- [ ] Task 1"
plans_completed/  ← (does not exist)
```

#### Step 2 — Snapshot the active state

```ts
const hash_active = await snapshot.track()
// Internally: fossil add --force plans/test-plan.md
//             fossil commit -m "auto-snapshot" ...
```

**Expected:** `hash_active` is a 40-char hex string.
**Fossil leaf at hash_active:** tracks `plans/test-plan.md`.

#### Step 3 — Simulate plan completion

```ts
// Delete: plans/test-plan.md
await fs.unlink(path.join(dir, "plans", "test-plan.md"))
// Create: plans_completed/test-plan.md with "- [x] Task 1"
await write(path.join(dir, "plans_completed", "test-plan.md"), "- [x] Task 1")
```

**File system state:**
```
plans/              ← (empty directory)
plans_completed/
  test-plan.md      ← "- [x] Task 1"
```

#### Step 4 — Snapshot the completed state

```ts
const hash_completed = await snapshot.track()
// Internally: fossil rm plans/test-plan.md
//             fossil add --force plans_completed/test-plan.md
//             fossil commit -m "auto-snapshot" ...
```

**Expected:** `hash_completed` is a 40-char hex string, different from `hash_active`.
**Fossil leaf at hash_completed:** tracks `plans_completed/test-plan.md`, NOT `plans/test-plan.md`.

#### Step 5 — Undo (restore to active state)

```ts
await snapshot.restore(hash_active)
// Internally: fossil checkout --force hash_active
```

**Expected behavior:**
- `plans/test-plan.md` reappears with `"- [ ] Task 1"` ✓
- `plans_completed/test-plan.md` is gone ✓

**Actual behavior (verify):**
- `plans/test-plan.md` reappears with `"- [ ] Task 1"` ✓
- `plans_completed/test-plan.md` remains on disk as an **untracked extra** ⚠️

**Assertion:**
```ts
// This SHOULD be false — the completed file should not exist after undo
expect(await exists("plans_completed/test-plan.md")).toBe(false)
// BUG: It actually IS true — fossil checkout --force leaves it behind
```

#### Step 6 — Redo (checkout to completed state)

```ts
await snapshot.checkout(hash_completed)
// Internally: fossil checkout --force hash_completed
```

**Expected behavior:**
- `plans/test-plan.md` is gone ✓
- `plans_completed/test-plan.md` reappears with `"- [x] Task 1"` ✓
- **No other files exist in plans/ or plans_completed/** ✓

**Actual behavior (verify):**
- `plans/test-plan.md` STILL EXISTS as an untracked stale extra file ⚠️
- `plans_completed/test-plan.md` exists with `"- [x] Task 1"` ✓

**KEY ASSERTION (the bug):**
```ts
// The stale file from the undo'd leaf persists after redo checkout
expect(await exists("plans/test-plan.md")).toBe(false)
// BUG: It actually IS true — fossil checkout --force hash_completed
//      does NOT delete plans/test-plan.md because it's not tracked
//      at hash_completed and fossil checkout does not clean untracked files
```

#### Step 7 — Next auto-snapshot picks up the stale file

```ts
const hash_broken = await snapshot.track()
// Internally: fossil addremove (or fossil add --force plans/test-plan.md)
//             finds plans/test-plan.md as an untracked file and ADDS it
//             fossil commit -m "auto-snapshot" ...
```

**Expected (correct behavior):**
- No changes detected, `track()` returns `hash_completed` (no new commit)

**Actual (bug behavior):**
- `fossil addremove` discovers `plans/test-plan.md` as an untracked file
- Adds it and commits → new hash `hash_broken`
- **Both `plans/test-plan.md` and `plans_completed/test-plan.md` are now tracked in the "completed" leaf**

#### Step 8 — Verify the corruption

```ts
// After the buggy track:
const patch = await snapshot.patch(hash_completed)
// patch.files should be empty (nothing changed in the completed leaf)
// BUG: patch.files includes "plans/test-plan.md" — a file that was
//      supposed to be gone on the completed leaf

expect(patch.files).not.toContain(
  path.join(dir, "plans", "test-plan.md").replaceAll("\\", "/")
)
// BUG FAILS: the stale file was re-added
```

### Expected vs Actual Summary (Experiment 1)

| Step | File | Expected | Actual (bug) |
|------|------|----------|--------------|
| 5 (undo) | `plans_completed/test-plan.md` | Gone | **Exists (untracked extra)** |
| 6 (redo) | `plans/test-plan.md` | Gone | **Exists (stale extra)** |
| 7 (track) | `plans/test-plan.md` in patch | Not in patch | **Re-added to completed leaf** |

---

## 3. Experiment 2: Multiple Undo/Redo Cycles (Compounding)

### Scenario

If each undo/redo cycle leaves behind an extra file, multiple cycles should
compound — each cycle adds another stale file to the working directory, and the
next track picks them ALL up.

### Step-by-Step Procedure

#### Setup

```
Same bootstrap as Experiment 1.
Create three files representing three sequential tasks:
  plans/task-1.md  → "- [ ] Task 1"
  plans/task-2.md  → "- [ ] Task 2"
  plans/task-3.md  → "- [ ] Task 3"
```

#### Cycle 1 — Complete Task 1

```
1. snapshot.track() → hash_A  (all 3 tasks active)
2. Delete plans/task-1.md, create plans_completed/task-1.md
3. snapshot.track() → hash_B  (task 1 completed, tasks 2-3 active)
```

#### Cycle 2 — Complete Task 2

```
4. Delete plans/task-2.md, create plans_completed/task-2.md
5. snapshot.track() → hash_C  (tasks 1-2 completed, task 3 active)
```

#### Cycle 3 — Complete Task 3

```
6. Delete plans/task-3.md, create plans_completed/task-3.md
7. snapshot.track() → hash_D  (all 3 tasks completed)
```

Now we have 4 snapshots: A (all active) → B (1 done) → C (2 done) → D (all done).

#### Undo All Three

```
8. snapshot.restore(hash_C)   // undo task 3 completion
9. snapshot.restore(hash_B)   // undo task 2 completion
10. snapshot.restore(hash_A)  // undo task 1 completion
```

**File system after undo chain:**
- `plans/task-1.md`, `plans/task-2.md`, `plans/task-3.md` exist (restored)
- **BUG**: `plans_completed/task-1.md`, `plans_completed/task-2.md`, `plans_completed/task-3.md` may all still exist as untracked extras

#### Redo All Three

```
11. snapshot.checkout(hash_D)  // jump to all-completed state
```

**Expected behavior:**
- Only `plans_completed/task-{1,2,3}.md` exist
- `plans/task-{1,2,3}.md` are gone

**Actual behavior (verify):**
- `plans_completed/task-{1,2,3}.md` exist ✓
- **At least some of `plans/task-{1,2,3}.md` remain** ⚠️
- Each intermediate checkout may have left different stale files

#### Track After Multi-Cycle

```
12. snapshot.track() → examines the worktree
```

**Expected:** No new files, track returns hash_D unchanged.

**Actual (bug):**
- `fossil addremove` discovers ALL stale `plans/task-*.md` files
- Adds them to the "all completed" leaf
- **Result: all 6 files tracked — both active and completed versions**

#### Compound Check

```ts
// After the buggy track on the "all completed" leaf:
const diffs = await snapshot.diffFull(hash_D, hash_broken_after_cycles)

// diffs should be empty — nothing should change on the completed leaf
// BUG: diffs contains ADDED entries for plans/task-1.md, plans/task-2.md, plans/task-3.md
expect(diffs.filter(d => d.status === "added" && d.file.includes("plans/")).length).toBe(0)
// BUG FAILS: 3 files were falsely re-added
```

### Expected vs Actual Summary (Experiment 2)

| Step | Check | Expected | Actual (bug) |
|------|-------|----------|--------------|
| 8-10 | Completed files after undo chain | All gone | **Some/all remain** |
| 11 | Active files after redo to hash_D | All gone | **Some/all remain** |
| 12 | New files in track after redo | 0 | **≥ 3 (1 per cycle)** |
| 12 | Tracked files on "completed" leaf | 3 (completed only) | **6 (both active + completed)** |

### Additional Compound Observations

If each cycle's `fossil checkout --force` leaves behind a different set of stale
files, track after N cycles could re-add up to N stale files. The corruption is
**linear in the number of checkout transitions** that cross leaf boundaries where
files were added or removed.

---

## 4. Test Case Scaffold

The following is a test case skeleton that follows the existing test patterns in
`packages/opencode/test/snapshot/snapshot.test.ts` and
`packages/opencode/test/session/revert-compact.test.ts`. It should be placed in
`packages/opencode/test/snapshot/fossil-leaf-artifact.test.ts`.

### Experiment 1 Test

```ts
import { afterEach, test, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { Instance } from "../../src/project/instance"
import { tmpdir, provideInstance } from "../fixture/fixture"

const fwd = (...parts: string[]) => path.join(...parts).replaceAll("\\", "/")

afterEach(async () => {
  await Instance.disposeAll()
  Bun.gc(true)
})

function run<A>(dir: string, body: (snapshot: Snapshot.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      return yield* body(snapshot)
    }).pipe(provideInstance(dir), Effect.provide(SnapshotFossil.defaultLayer)),
  )
}

const exists = (p: string) =>
  fs.access(p).then(() => true).catch(() => false)

const read = (p: string) =>
  fs.readFile(p, "utf-8").catch(() => null)

test("leaf-artifact: fossil checkout leaves stale files after undo/redo", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Step 1: Create plan file in active state
      const plansDir = path.join(tmp.path, "plans")
      const completedDir = path.join(tmp.path, "plans_completed")
      await fs.mkdir(plansDir, { recursive: true })
      await fs.mkdir(completedDir, { recursive: true })

      const activeFile = path.join(plansDir, "test-plan.md")
      const completedFile = path.join(completedDir, "test-plan.md")
      await fs.writeFile(activeFile, "- [ ] Task 1")

      // Step 2: Snapshot active state
      const hashActive = await run(tmp.path, (snap) => snap.track())
      expect(hashActive).toBeTruthy()
      expect(hashActive!.length).toBeGreaterThanOrEqual(40)

      // Step 3: Simulate completion — delete active, create completed
      await fs.unlink(activeFile)
      await fs.writeFile(completedFile, "- [x] Task 1")

      // Step 4: Snapshot completed state
      const hashCompleted = await run(tmp.path, (snap) => snap.track())
      expect(hashCompleted).toBeTruthy()
      expect(hashCompleted).not.toBe(hashActive)

      // Verify current state: completed file exists, active does not
      expect(await exists(completedFile)).toBe(true)
      expect(await exists(activeFile)).toBe(false)

      // Step 5: UNDO — restore to active state
      await run(tmp.path, (snap) => snap.restore(hashActive!))

      // Expected: active file is back, completed file is gone
      expect(await exists(activeFile)).toBe(true)
      expect(await read(activeFile)).toBe("- [ ] Task 1")

      // BUG ASSERTION: completed file should NOT exist after undo
      // fossil checkout --force hashActive does not clean files unique to hashCompleted
      const completedExistsAfterUndo = await exists(completedFile)
      expect(completedExistsAfterUndo).toBe(false)
      // ↑ THIS FAILS — fossil checkout --force leaves plans_completed/test-plan.md on disk

      if (completedExistsAfterUndo) {
        console.warn(
          "BUG CONFIRMED (step 5): plans_completed/test-plan.md exists after undo — " +
          "fossil checkout --force did not clean it"
        )
      }

      // Step 6: REDO — checkout to completed state
      await run(tmp.path, (snap) => snap.checkout(hashCompleted!))

      // Expected: completed file is back, active file is gone
      expect(await exists(completedFile)).toBe(true)
      expect(await read(completedFile)).toBe("- [x] Task 1")

      // BUG ASSERTION: active file should NOT exist after redo checkout
      const activeExistsAfterRedo = await exists(activeFile)
      expect(activeExistsAfterRedo).toBe(false)
      // ↑ THIS FAILS — fossil checkout --force hashCompleted does not delete
      //   plans/test-plan.md (it was not tracked at hashCompleted)

      if (activeExistsAfterRedo) {
        console.warn(
          "BUG CONFIRMED (step 6): plans/test-plan.md exists after redo — " +
          "fossil checkout --force did not clean the stale file"
        )
      }

      // Step 7: Next track picks up the stale file
      const hashAfterBuggyTrack = await run(tmp.path, (snap) => snap.track())

      // Step 8: Verify corruption — the active file should NOT be in the diff
      const patch = await run(tmp.path, (snap) => snap.patch(hashCompleted!))
      const staleInPatch = patch.files.some(
        (f) => f === fwd(activeFile)
      )

      expect(staleInPatch).toBe(false)
      // ↑ THIS FAILS — the stale file was re-added to the completed leaf

      if (staleInPatch) {
        console.warn(
          "BUG CONFIRMED (step 7-8): plans/test-plan.md was re-added to the " +
          "completed snapshot by track() after checkout left it on disk"
        )
      }

      // Sanity: both files are now tracked on the "completed" leaf
      const diffs = await run(tmp.path, (snap) =>
        snap.diffFull(hashCompleted!, hashAfterBuggyTrack!)
      )
      const addedFiles = diffs.filter((d) => d.status === "added")
      if (addedFiles.length > 0) {
        console.warn(
          `BUG: ${addedFiles.length} stale file(s) re-added to completed leaf:`,
          addedFiles.map((d) => d.file)
        )
      }
    },
  })
})
```

### Experiment 2 Test

```ts
test("leaf-artifact: multiple undo/redo cycles compound stale files", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const plansDir = path.join(tmp.path, "plans")
      const completedDir = path.join(tmp.path, "plans_completed")
      await fs.mkdir(plansDir, { recursive: true })
      await fs.mkdir(completedDir, { recursive: true })

      const tasks = ["task-1", "task-2", "task-3"]
      const activeFiles = tasks.map((t) => path.join(plansDir, `${t}.md`))
      const completedFiles = tasks.map((t) => path.join(completedDir, `${t}.md`))

      // Create all 3 active tasks
      for (const f of activeFiles) {
        await fs.writeFile(f, `- [ ] ${path.basename(f, ".md")}`)
      }

      // Snapshot A: all 3 active
      const hashA = await run(tmp.path, (snap) => snap.track())
      expect(hashA).toBeTruthy()

      // Complete tasks one by one, snapshotting each
      const hashes: string[] = [hashA!]
      let current = hashA!

      for (let i = 0; i < tasks.length; i++) {
        await fs.unlink(activeFiles[i])
        await fs.writeFile(completedFiles[i], `- [x] ${tasks[i]}`)
        const next = await run(tmp.path, (snap) => snap.track())
        expect(next).toBeTruthy()
        expect(next).not.toBe(current)
        hashes.push(next!)
        current = next!
      }

      // hashes = [A, B, C, D] where D = all completed
      const hashD = hashes[hashes.length - 1]

      // Verify D state: all completed, no active
      for (const f of completedFiles) expect(await exists(f)).toBe(true)
      for (const f of activeFiles) expect(await exists(f)).toBe(false)

      // Undo chain: restore C, then B, then A
      for (let i = hashes.length - 2; i >= 0; i--) {
        await run(tmp.path, (snap) => snap.restore(hashes[i]))
      }

      // Now at hash A state: all active files should exist
      for (const f of activeFiles) expect(await exists(f)).toBe(true)

      // BUG: completed files may still exist as untracked extras
      const completedExtrasAfterUndo: string[] = []
      for (const f of completedFiles) {
        if (await exists(f)) completedExtrasAfterUndo.push(f)
      }
      expect(completedExtrasAfterUndo.length).toBe(0)
      // ↑ THIS FAILS — fossil checkout --force left completed files behind

      if (completedExtrasAfterUndo.length > 0) {
        console.warn(
          `BUG (multi-cycle undo): ${completedExtrasAfterUndo.length} completed file(s) ` +
          `remained after undo chain: ${completedExtrasAfterUndo.join(", ")}`
        )
      }

      // Redo: jump to hash D (all completed)
      await run(tmp.path, (snap) => snap.checkout(hashD!))

      // Expected: all completed, no active
      for (const f of completedFiles) expect(await exists(f)).toBe(true)

      // BUG: active files may still exist as stale extras
      const activeExtrasAfterRedo: string[] = []
      for (const f of activeFiles) {
        if (await exists(f)) activeExtrasAfterRedo.push(f)
      }
      expect(activeExtrasAfterRedo.length).toBe(0)
      // ↑ THIS FAILS — fossil checkout --force left active files behind

      if (activeExtrasAfterRedo.length > 0) {
        console.warn(
          `BUG (multi-cycle redo): ${activeExtrasAfterRedo.length} active file(s) ` +
          `remained after redo checkout: ${activeExtrasAfterRedo.join(", ")}`
        )
      }

      // Track after the multi-cycle damage
      const hashAfterCycles = await run(tmp.path, (snap) => snap.track())

      // Verify: shouldn't be any new files on the completed leaf
      const diffs = await run(tmp.path, (snap) =>
        snap.diffFull(hashD!, hashAfterCycles!)
      )
      const reAdded = diffs.filter(
        (d) => d.status === "added" && d.file.includes("plans/")
      )
      expect(reAdded.length).toBe(0)
      // ↑ THIS FAILS — stale files were re-added to the completed leaf

      if (reAdded.length > 0) {
        console.warn(
          `BUG (multi-cycle track): ${reAdded.length} stale file(s) re-added ` +
          `to completed leaf: ${reAdded.map((d) => d.file).join(", ")}`
        )
      }
    },
  })
})
```

---

## 5. Post-Fix Verification

After adding `fossil clean --force` after each `fossil checkout --force` in
`fossil.ts` (lines 402, 438, and any other checkout sites), both Experiment 1
and Experiment 2 tests should **PASS**:

| Assertion | Pre-Fix | Post-Fix |
|-----------|---------|----------|
| Completed file gone after undo (step 5) | FAIL | PASS |
| Active file gone after redo (step 6) | FAIL | PASS |
| No stale files in patch after track (step 8) | FAIL | PASS |
| No completed extras after multi-cycle undo | FAIL | PASS |
| No active extras after multi-cycle redo | FAIL | PASS |
| No re-added files to completed leaf | FAIL | PASS |

### Fix Location

**File:** `packages/opencode/src/snapshot/fossil.ts`

**`opRestore` / `checkout` (line 397-407):**
```diff
  const opRestore = Effect.fnUntraced(function* (targetVersion: string) {
    return yield* locked(
      Effect.gen(function* () {
        log.info("fossil checkout (opRestore)", { version: targetVersion })
        if (!(yield* ensureInit())) return
        const result = yield* fossil(["checkout", "--force", targetVersion], { cwd: worktree })
+       if (result.code === 0) {
+         yield* fossil(["clean", "--force"], { cwd: worktree }).pipe(
+           Effect.catch(() => Effect.void)
+         )
+       }
        if (result.code === 0) return
        log.error("fossil checkout failed", { version: targetVersion, stderr: result.stderr })
      }).pipe(Effect.orDie),
    )
  })
```

**`restore` (line 433-443):**
```diff
  const restore = Effect.fnUntraced(function* (snapshot: string) {
    return yield* locked(
      Effect.gen(function* () {
        log.info("restore (checkout)", { version: snapshot })
        if (!(yield* ensureInit())) return
        const result = yield* fossil(["checkout", "--force", snapshot], { cwd: worktree })
+       if (result.code === 0) {
+         yield* fossil(["clean", "--force"], { cwd: worktree }).pipe(
+           Effect.catch(() => Effect.void)
+         )
+       }
        if (result.code === 0) return
        log.error("fossil checkout failed", { snapshot, stderr: result.stderr })
      }).pipe(Effect.orDie),
    )
  })
```

### Caveats

1. **`fossil clean` deletes ALL untracked files**, not just "extra" ones from
   stale leaves. If the user has intentionally created untracked working files
   between snapshot operations, `clean` would delete those too. Mitigation:
   - Call `clean` only in `checkout`/`restore` (explicit version switches), not
     in `track` (where untracked files are the input to snapshot).
   - The semantics of `checkout` and `restore` already imply "make the worktree
     exactly match this version" — so cleaning is semantically correct.

2. **Windows**: `fossil clean` on Windows may need the `--force` flag to skip
   confirmation prompts. The `--force` flag is already used on `checkout`.

3. **Ignored files**: `fossil clean` respects `.fossil-settings/ignore-glob`
   (already synced from `.gitignore` by `ensureIgnoreGlob`), so ignored files
   will not be deleted.

---

## 6. References

- `packages/opencode/src/snapshot/fossil.ts` — Fossil snapshot implementation
- `packages/opencode/src/snapshot/index.ts` — `Snapshot.Interface` definition
- `packages/opencode/src/session/revert.ts` — Undo/redo implementation
- `packages/opencode/test/snapshot/snapshot.test.ts` — Existing snapshot tests
- `packages/opencode/test/session/revert-compact.test.ts` — Existing revert tests
- `packages/opencode/test/fixture/fixture.ts` — `tmpdir()`, `provideInstance()`
- `packages/opencode/test/lib/effect.ts` — `testEffect` helper
- Fossil docs: `fossil help checkout`, `fossil help clean`
