# Fix: SnapshotFossil track() returns undefined in test — Config.Service instance isolation

## Root Cause

`SnapshotFossil.defaultLayer` (fossil.ts:492-496) does `Layer.provide(Config.defaultLayer)`, pinning `Config.Service` to a built-in `Config.defaultLayer` inside the `SnapshotFossil` subtree. In Effect v4-beta, `Layer.provide` bakes the dependency into the layer — a merged external `Config.defaultLayer` creates a **separate** `Config.Service` instance for the test subtree, leaving `SnapshotFossil` with the internal instance.

The test writes `opencode.jsonc` with `snapshot: true`, and `yield* Config.Service.get()` from the test subtree correctly returns `{ snapshot: true }`. But `SnapshotFossil`'s internal `Config.Service` instance reads the config independently and `enabled()` (fossil.ts:61-63) returns `false`, causing `track()` to return `undefined`.

**Evidence:**
- `yield* Config.Service.get().then(c => c.snapshot)` → `true`
- `yield* Snapshot.Service.track()` → `undefined`
- `computeDiff: from=undefined to=undefined`

## Fix

**File:** `packages/opencode/test/session/snapshot-tool-race.test.ts`  
**Line:** 114

Replace `SnapshotFossil.defaultLayer` with `SnapshotFossil.layer` + explicit provides — removing the internal `Config.defaultLayer` pin so the test's `Config.defaultLayer` (line 121, with `snapshot: true`) provides `Config.Service` for all consumers.

```diff
-    SnapshotFossil.defaultLayer,
+    SnapshotFossil.layer.pipe(
+      Layer.provide(CrossSpawnSpawner.defaultLayer),
+      Layer.provide(AppFileSystem.defaultLayer),
+    ),
```

## Verification

```
bun test test/session/snapshot-tool-race.test.ts --timeout 60000
bun test test/snapshot/fossil-track.test.ts --timeout 15000
```

Expected: race test diff > 0, fossil-track 1 pass.
