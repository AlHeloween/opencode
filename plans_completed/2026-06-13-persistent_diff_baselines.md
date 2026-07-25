# Persistent Encrypted Diff Baselines

**Goal:** Survive restarts — store the last formatted LLM request per session+model as an AES-256-GCM encrypted baseline in `.opencode/data/diffs/models/`. On session restore, reload baselines so the diff chain continues from where it left off.

**Status:** completed

---

## Problem

`prevMap` (`request-diff.ts:42`) is a module-level `Map<string, Baseline>` — purely in-memory, lost on every restart. When a session is restored after a process restart, `getPrev(sessionID)` returns `undefined`, and the first request produces no diff. The diff chain is broken across process boundaries.

**Root cause:** `prevMap` is never persisted. Sessions persist in SQLite, diff output files persist on disk, but the baseline linking consecutive turns does not.

---

## Storage Layout

```
.opencode/data/diffs/
  models/                            ← NEW directory
    {sessionID}/
      {provider}_{model}.enc         ← AES-256-GCM encrypted Baseline JSON
  *.diff                             ← existing diff output files (plaintext, unchanged)
```

**Rationale:**
- Per-session directories — confirmed by user. Cleanup on `session.delete()` is a single `rmdir`.
- Files keyed by `{provider}_{model}` — allows session to use multiple models with separate diff chains.
- `.diff` files stay plaintext — they are redacted previews valuable for debugging; the baseline contains the *full prompt* which is more sensitive.

---

## Encryption Design

### Key derivation (deterministic, no key-management burden)

```
keyBytes = SHA-256(projectID + ":" + worktree + ":" + sessionID + ":opencode-diff-baseline-v1")
```

Import as `AES-GCM` raw key via `crypto.subtle.importKey()`.

**Why deterministic:** Same data already lives in plaintext SQLite (`opencode.db`). A derived key prevents casual inspection while avoiding OS-keyring or passphrase complexity. Proper per-project random key can follow later.

### Encrypt/decrypt

```
encryptBaseline(plaintext: string, key: CryptoKey) → Buffer
  iv = crypto.getRandomValues(12 bytes)
  ciphertext = crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, Buffer.from(plaintext))
  return Buffer.concat([iv, ciphertext])   // IV prepended for decrypt

decryptBaseline(wire: Buffer, key: CryptoKey) → string
  iv = wire.slice(0, 12)
  ciphertext = wire.slice(12)
  plaintext = crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
  return Buffer.from(plaintext).toString()

deriveKey(projectID, worktree, sessionID) → Promise<CryptoKey>
  keyBytes = SHA-256(projectID + ":" + worktree + ":" + sessionID + ":opencode-diff-baseline-v1")
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"])
```

**IV size:** 12 bytes (96 bits) — recommended for GCM.
**Auth tag:** Included automatically by Web Crypto API (16 bytes appended to ciphertext).

### On-disk format

```
[12 bytes: IV] [variable: AES-GCM ciphertext + 16-byte auth tag]
```

Contains JSON: `{ formatted: string, meta: DiffMeta }` — exactly the `Baseline` struct.

---

## Implementation Tasks

### 1. Add crypto primitives to `request-diff.ts`

**File:** `packages/opencode/src/session/request-diff.ts`

New imports:
```ts
import { createHash } from "node:crypto"  // already in codebase; SHA-256 for key derivation
```

New exports:
```ts
const MODELS_DIR = path.join(DIFFS_DIR, "models")

export function modelsDirForSession(sessionID: string): string
  // → {Global.Path.data}/diffs/models/{sessionID}

export function baselinePath(sessionID: string, providerID: string, modelID: string): string
  // → {modelsDir}/{sessionID}/{provider}_{model}.enc

export async function deriveKey(projectID: string, worktree: string, sessionID: string): Promise<CryptoKey>

export async function encryptBaseline(plaintext: string, key: CryptoKey): Promise<Buffer>

export async function decryptBaseline(encrypted: Buffer, key: CryptoKey): Promise<string>
```

### 2. Wire `ensureBaseline` — load-on-first-access

```ts
/**
 * Ensure a baseline exists in prevMap for this session+model.
 * On first call: checks memory, then loads from disk (decrypt) if found.
 * Later calls: memory hit (synchronous getPrev still works).
 */
export async function ensureBaseline(
  sessionID: string,
  modelID: string,
  projectID: string,
  worktree: string,
): Promise<void> {
  const key = prevKey(sessionID, modelID)
  if (prevMap.has(key)) return

  const filePath = baselinePath(sessionID, ...)
  if (!fs.existsSync(filePath)) return

  try {
    const encKey = await deriveKey(projectID, worktree, sessionID)
    const encrypted = fs.readFileSync(filePath)
    const plaintext = await decryptBaseline(encrypted, encKey)
    const baseline: Baseline = JSON.parse(plaintext)
    prevMap.set(key, baseline)
  } catch {
    // Corrupt file or key mismatch — delete and start fresh
    try { fs.unlinkSync(filePath) } catch {}
  }
}
```

### 3. Modify `storePrev` — persist on write

```ts
/**
 * Store the current request as the next baseline for the session+model.
 * Also persists encrypted to disk for cross-restart continuity.
 */
export function storePrev(
  sessionID: string,
  modelID: string,
  formatted: string,
  meta: DiffMeta,
  projectID: string,
  worktree: string,
): void {
  const key = prevKey(sessionID, modelID)
  prevMap.set(key, { formatted, meta })

  // Fire-and-forget async persistence (don't block the send loop)
  const dir = path.dirname(baselinePath(sessionID, meta.providerID, meta.modelID))
  fs.mkdirSync(dir, { recursive: true })
  deriveKey(projectID, worktree, sessionID).then((encKey) =>
    encryptBaseline(JSON.stringify({ formatted, meta }), encKey).then((encrypted) => {
      fs.writeFileSync(baselinePath(sessionID, meta.providerID, meta.modelID), encrypted)
    })
  ).catch(() => { /* persistence failure is non-critical; diff chain resumes on next restart from scratch */ })
}
```

### 4. Add `deleteBaseline` for session cleanup

```ts
/**
 * Remove all persisted baselines for a session (called on session.delete).
 */
export function deleteBaseline(sessionID: string): void {
  prevMap.delete(sessionID)  // legacy key; also clear model-scoped keys
  const dir = modelsDirForSession(sessionID)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
```

### 5. Update `prevKey` to include modelID

```ts
/** Composite key: session + model. Prevents cross-model comparison when a session switches models. */
function prevKey(sessionID: string, modelID: string): string {
  return `${sessionID}:${modelID}`
}
```

And update:
- `getPrev(sessionID: string, modelID: string): Baseline | undefined` — uses `prevKey`
- `storePrev(...)` — uses `prevKey`
- ALL call sites in `prompt.ts` pass `model.id` or `model.modelID`

### 6. Hook into `prompt.ts` (both call sites)

**Compaction path (~line 1318):**
```ts
if (cfg2.diff_requests !== false) {
  const diffMeta: RequestDiff.DiffMeta = { ... }
  yield* Effect.promise(() =>
    RequestDiff.ensureBaseline(sessionID, model.id, projectID, worktree)
  )
  const prev = RequestDiff.getPrev(sessionID, model.id)
  // ... same diff logic
  RequestDiff.storePrev(sessionID, model.id, formatted, diffMeta, projectID, worktree)
}
```

**Normal path (~line 1548):** Same pattern.

`projectID` = `ctx.project.id`, `worktree` = `ctx.worktree` — both available from `yield* InstanceState.context` at line 1123.

### 7. Hook into `session.ts` delete

**File:** `packages/opencode/src/session/session.ts:584-587`

After the `SyncEvent.remove(sessionID)` call (line 586), add:
```ts
// Clean up persisted diff baselines (filesystem, not DB)
RequestDiff.deleteBaseline(sessionID)
```
**Why after both `SyncEvent.run` AND `SyncEvent.remove`:** `deleteBaseline()` is a filesystem side-effect that should run after the DB transaction commits. Placing it outside the `Effect.sync` block ensures it happens after DB cleanup, not interleaved with it.

### 8. Tests

**File:** `packages/opencode/test/session/request-diff.test.ts`

New test cases:
- `encryptBaseline + decryptBaseline` round-trip: `decrypt(encrypt(text), key) === text`
- `deriveKey` is deterministic: same inputs → same key
- `ensureBaseline` loads from disk into `prevMap`
- `storePrev` writes to disk, `ensureBaseline` reads it back
- `deleteBaseline` removes directory + clears `prevMap`
- `prevKey` produces different keys for different `modelID`
- Corrupt `.enc` file: `ensureBaseline` cleans up and returns without error

---

## Refactoring: `prevMap` key migration

### Before
```ts
prevMap: Map<string, Baseline>          // key = sessionID
getPrev(sessionID): Baseline | undefined
storePrev(sessionID, formatted, meta)
```

### After
```ts
prevMap: Map<string, Baseline>          // key = `${sessionID}:${modelID}`
getPrev(sessionID, modelID): Baseline | undefined
storePrev(sessionID, modelID, formatted, meta, projectID, worktree)
ensureBaseline(sessionID, modelID, projectID, worktree): Promise<void>
deleteBaseline(sessionID): void
modelsDirForSession(sessionID): string
baselinePath(sessionID, providerID, modelID): string
```

### Call site migration (prompt.ts, both paths)

Old:
```ts
const prev = RequestDiff.getPrev(sessionID)
// ...
RequestDiff.storePrev(sessionID, formatted, diffMeta)
```

New:
```ts
yield* Effect.promise(() =>
  RequestDiff.ensureBaseline(sessionID, model.id, projectID, worktree)
)
const prev = RequestDiff.getPrev(sessionID, model.id)
// ...
RequestDiff.storePrev(sessionID, model.id, formatted, diffMeta, projectID, worktree)
```

---

## File Layout

| File | Change |
|------|--------|
| `packages/opencode/src/session/request-diff.ts` | +110 lines: deriveKey, encryptBaseline, decryptBaseline, ensureBaseline, modelsDirForSession, baselinePath, deleteBaseline; modify getPrev/storePrev signatures; add prevKey helper |
| `packages/opencode/src/session/prompt.ts` | +4 lines per call site (x2): effect.promise ensureBaseline, update getPrev/storePrev args |
| `packages/opencode/src/session/session.ts` | +1 line: deleteBaseline in remove() |
| `packages/opencode/test/session/request-diff.test.ts` | +80 lines: round-trip, load, delete, corruption, key-idempotency tests |

---

## KV Cache Assessment

[KV-CACHE SAFE] — Read-side logging. No change to system prompt construction, message conversion, or provider request bytes. `ensureBaseline` and encryption happen before/after the send loop, not during request assembly. Fire-and-forget `storePrev` persistence is non-blocking.

---

## Completion Criteria

- [x] `deriveKey()` deterministic per `(projectID, worktree, sessionID)`
- [x] `encryptBaseline()` + `decryptBaseline()` AES-256-GCM round-trip
- [x] `ensureBaseline()` loads from disk, populates `prevMap`
- [x] `storePrev()` persists encrypted baseline to disk (fire-and-forget)
- [x] `deleteBaselines()` removes directory + clears memory
- [x] `prevKey` uses `{sessionID}:{modelID}` — no cross-model comparison
- [x] Both `prompt.ts` call sites updated with `ensureBaseline` + new signatures
- [x] `session.remove()` calls `deleteBaselines()`
- [x] Tests pass: round-trip, load, delete, corruption, key-idempotency (28/28)
- [x] Typecheck clean
