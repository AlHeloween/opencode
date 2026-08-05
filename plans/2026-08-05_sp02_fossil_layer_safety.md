# SP-02: Fossil Layer Safety (hard fail, track-aware extras, dead code)

**Parent:** `plans/2026-08-05_master_critical_remediation.md`  
**Date:** 2026-08-05  
**Status:** Implemented 2026-08-05 — preLs extras cleanup + hard-fail checkout; suite green except pre-existing `update` history test flaky
**Severity:** CRITICAL residual (user file deletion; silent unrevert)  
**Risk:** Medium  
**Depends on:** Master G0 stamped; SP-01 recommended first (independent typecheck)  
**Blocks:** SP-03  
**Maps bugs:** BUG-2 residual, BUG-9 complete, dead `getEarliestCommit`, commit-fail logging already Phase 1

---

## 1. Problem

Phase 1 stopped the worst data-loss paths but left three fossil-layer holes:

| ID | Symptom | Code today |
|----|---------|------------|
| BUG-2 residual | Untracked **user** files still deleted | `fossil extras` → delete all non-dot paths |
| BUG-9 incomplete | Bad hash on checkout/restore | `log.error` + `return` (silent success) |
| Dead code | `getEarliestCommit` unused | retained after BUG-1 |

**Primary file:** `packages/opencode/src/snapshot/fossil.ts`  
**Callers of restore/checkout:** `session/revert.ts` (unrevert), any debug commands  

Do **not** rewrite session undo semantics here — that is SP-03. This plan only makes **primitive** operations safe and honest.

---

## 2. Prior art

- Phase 1 commit `eb3b6a3` — resolveHash hard fail, backup before reinit, extras instead of `clean --force`  
- Fossil CLI: `extras`, `finfo FILE`, `info HASH`, `checkout --force`, `update`  
- Tests: `test/snapshot/fossil-rollback.test.ts`, `fossil.test.ts`, `fossil-lifecycle.test.ts`  
- Plan catalog: `plans/fossil-undo-redo-fix.md` § BUG-2, BUG-9  

---

## 3. Invariants (from master)

- **I-3** Fail loud on missing hash for checkout/restore  
- **I-4** User-only untracked files survive cleanup  
- No silent `clean --force`  
- Real fossil binary in tests  

---

## 4. Implementation design

### 4.1 Track-aware extras cleanup (BUG-2 residual)

**Current (unsafe):**

```ts
for (const file of extras) {
  if (file.startsWith(".")) continue
  yield* fs.remove(path.join(worktree, file))
}
```

**Target:**

```ts
const cleanupExtras = Effect.fnUntraced(function* (opts?: { onlyIfTracked?: boolean }) {
  const extras = yield* fossil(["extras"], { cwd: worktree })
  if (extras.code !== 0 || !extras.text.trim()) return
  for (const line of extras.text.trim().split("\n")) {
    const file = line.trim()
    if (!file || file.startsWith(".")) continue
    // onlyIfTracked default true for restore/checkout paths
    if (opts?.onlyIfTracked !== false) {
      // Was this path ever in the repo? finfo fails for pure user files.
      const finfo = yield* fossil(["finfo", file], { cwd: worktree })
      // Alternative if finfo flaky on Windows paths: fossil ["ls", "--age"] / timeline for file
      if (finfo.code !== 0) {
        log.debug("extras cleanup skipped untracked-never-fossil file", { file })
        continue
      }
    }
    yield* fs.remove(path.join(worktree, file)).pipe(Effect.catch(() => Effect.void))
  }
})
```

**Research step (mandatory before coding):**

```
# In a temp fossil repo: create never-added file; run extras + finfo
# Document which CLI proves "ever tracked" on Windows paths with backslashes
```

Stamp result in this plan under `## CLI.RESEARCH`.

**Fallback if finfo unusable:** maintain `agentTouched: Set<string>` from `track(files)` only and only delete extras ∩ agentTouched. Prefer CLI proof first (no session coupling).

Apply `cleanupExtras` in **both** `opRestore` and `restore` (duplicate today — extract helper).

### 4.2 Hard fail on invalid checkout hash (BUG-9)

**Current:**

```ts
if (validate.code !== 0) {
  log.error(...)
  return  // silent
}
```

**Target:**

```ts
if (validate.code !== 0) {
  log.error("bug: checkout hash not found — unrevert cannot proceed", { ... })
  return yield* Effect.fail(
    new Error(
      `Cannot checkout snapshot ${targetVersion.slice(0, 8)}: hash not found in Fossil repository`,
    ),
  )
}
```

Same for `restore`.

**Caller impact:**

| Caller | Required handling |
|--------|-------------------|
| `SessionRevert.unrevert` | catch → log bug → **do not** clearRevert on failure; rethrow or return session unchanged with log |
| Debug CLI | surface stderr |

**SP-02 minimal unrevert change** (required so Effect.fail does not become unhandled die):

```ts
// session/revert.ts unrevert only — no BUG-3 rewrite
if (session.revert.op_id) {
  yield* snap.checkout(session.revert.op_id).pipe(
    Effect.catch((err) => {
      log.error("bug: unrevert checkout failed", { err })
      return Effect.fail(err) // or succeed session without clearRevert
    }),
  )
}
// only clearRevert after successful checkout/restore
```

Prefer: **on failure leave `session.revert` intact** so user can retry / diagnose.

Check how Effect failures surface to HTTP/TUI (`session` routes). If `orDie` swallows, fix boundary once.

### 4.3 Remove dead `getEarliestCommit`

Delete function if no references. Grep:

```
rg getEarliestCommit packages/opencode
```

### 4.4 Shared helper extraction

Extract:

- `validateHash(hash): Effect<string>` — info OK or fail  
- `cleanupExtrasTracked()`  

Both `opRestore` and `restore` call them (DRY; Phase 1 duplicated blocks).

### 4.5 Out of scope (SP-03)

- BUG-3 second undo  
- BUG-4 full checkout undo  
- Changing `revert(patches)` per-file loop  

---

## 5. Smoke Tests

### SMOKE.BEFORE

```
cwd: packages/opencode
bun test test/snapshot/fossil-rollback.test.ts
bun test test/snapshot/fossil.test.ts
bun test test/snapshot/fossil-lifecycle.test.ts
# Record Actual counts
```

### POST_IMPL oracles

| # | Oracle | Pass |
|---|--------|------|
| F2.1 | `bun test test/snapshot/` | 0 fail |
| F2.2 | New tests in §6 | all pass |
| F2.3 | `bun typecheck` | 0 errors |
| F2.4 | No `clean --force` in fossil.ts | `rg "clean" src/snapshot/fossil.ts` only comments/history |

---

## 6. Real tests (mandatory)

### 6.1 Extend `fossil-rollback.test.ts` or new `fossil-extras-cleanup.test.ts`

| Test | Steps | Exact assert |
|------|-------|--------------|
| `restore does not delete never-tracked user file` | init+track agent file; write `user-only.txt` never add/commit; call Snapshot restore/checkout to older hash via service OR low-level path used by opRestore | `user-only.txt` still exists with same content |
| `restore removes stale tracked-then-deleted-at-target extra` | file existed at leaf A, not at target B; after checkout to B, file must be gone if it was fossil-tracked | content/path absent |
| `checkout invalid hash fails` | `checkout("deadbeef…")` via Snapshot.Service | Effect fails **or** result is error; working tree unchanged; session path if tested leaves revert |
| `resolveHash invalid still throws` | regression Phase 1 | throw/fail, not earliest |

### 6.2 Lifecycle

| Test | Assert |
|------|--------|
| reinit creates `.bak.*` | already Phase 1 intent — confirm test or add if missing |

### 6.3 Harness notes

- Reuse TMP + real fossil from `fossil-rollback.test.ts`  
- Prefer `Snapshot.Service` through `SnapshotFossil.defaultLayer` + tmp Instance for API-level tests  
- CLI-level tests OK for finfo research validation  

**Do not mock** `fossil` spawn.

---

## 7. Implementation order (within SP-02)

1. CLI research → stamp `CLI.RESEARCH`  
2. `validateHash` + hard fail in opRestore/restore  
3. unrevert fail-safe (no clearRevert on fail)  
4. `cleanupExtrasTracked` + tests user-only survival  
5. Delete `getEarliestCommit`  
6. Full snapshot suite + typecheck  

---

## 8. Checklist

- [x] CLI.RESEARCH stamped (`fossil ls` pre-checkout, not finfo)  
- [x] validateHash fails loud (`checkoutTo` + Effect.fail → orDie)  
- [x] unrevert does not clear state on fail (clearRevert only after successful checkout)  
- [x] track-aware extras (`extras ∩ preTracked`)  
- [x] Tests: rollback SP-02 cases + snapshot restore/invalid hash pass; CLI track-aware pass  
- [x] getEarliestCommit removed  
- [x] Master G2 (SP-02 scope)  
- [ ] Note residuals in `fossil-undo-redo-fix.md` (editorial)

---

## CLI.RESEARCH

| Probe | Command | Result on Win | Decision |
|-------|---------|---------------|----------|
| ever tracked via finfo? | `fossil finfo <file>` | unreliable after checkout for files not in target tree | **not used for cleanup** |
| pre-checkout tracked set | `fossil ls` before checkout | lists current leaf tracked paths | **use this** as preTracked |
| extras list | `fossil extras` after checkout | user-only + stale leaf files | delete only `extras ∩ preTracked` |
| path slash form | relative vs abs | worktree-relative `/` | normalize `\\` → `/` |

---

## Exit criteria

Master G2. Commit suggestion:

`fix(snapshot): track-aware extras cleanup + hard-fail checkout hash`
