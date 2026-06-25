# Per-Model Encrypted Conversation Checkpoint Plan

**Created:** 2026-06-24
**Status:** Active — core checkpoint storage/reuse corrected 2026-06-25; documentation and deeper integration coverage remain pending.
**Effort:** ~6-8h

---

## Abstract

Replace per-turn system prompt assembly from source files with an encrypted per-model conversation checkpoint. After every successful provider response, the full model-ready state (system prompt + messages) is encrypted and written to disk as a `.enc` file. On startup or model switch, the checkpoint is loaded — eliminating prompt assembly, reducing DB reads to deltas only, and providing atomic rollback on failure.

## Problem

**[Exact]** Current per-turn flow in `prompt.ts:runLoop()`:

```
Every turn:
1. Effect.all([sys.skills, sys.environment, instruction.system, instruction.rules])  ← recomputed
2. filterCompactedEffect(sessionID)                                                   ← paginated DB load (500-row pages)
3. MessageV2.toModelMessagesEffect(msgs, model)                                      ← O(n) conversion (LRU cache per-msg, not persistent)
4. system = [banner, ...rules, ...env, ...skills, ...instructions]                   ← array assembly
```

For session length N, every turn costs O(N) DB reads (paginated, 500 rows/page) + O(N) message conversion (per-process LRU helps but not persistent) + full prompt assembly. The LRU conversion cache reduces repeated work within a process but doesn't survive restarts or model switches.

## Why This Matters Beyond Performance — KV Cache Integrity

This architecture solves three compounding problems simultaneously:

### 1. Guaranteed Provider-Side KV Cache Stability

```
Current (every turn):   system = buildFresh()  → bytes differ? → cache MISS
Checkpoint (per turn):  system = load(.enc)    → byte-identical → cache HIT
```

The system prompt is the most expensive part of the provider prompt (~3-15KB of rules + instructions + capabilities). When recomputed every turn, even a single byte change (different git status, different directory listing, different timestamp) invalidates the entire provider-side KV cache prefix. With checkpoints, the system prompt is frozen between compactions — **100% cache hit rate on the largest prompt component**.

### 2. AGENTS.md Changes Deferred to Compaction

```
Current:  Edit AGENTS.md → next turn loads new content → system prompt changes → KV cache breaks
          Model gets confused mid-conversation by sudden instruction changes

Checkpoint: Edit AGENTS.md → agent already "knows" instructions from checkpoint
          System prompt unchanged until next compaction (natural boundary)
          New instructions activate atomically with fresh conversation context
```

The model operates with **consistent instructions across an entire conversation segment**. When the developer edits AGENTS.md, the change takes effect at the next compaction — not mid-conversation. No confusion, no cache poisoning.

### 3. Failure = Rollback, Not Cache Break

```
Turn N:     Load .enc → send → success → save .enc (atomically via temp+rename)
Turn N+1:   Load .enc → send → OVERFLOW → discard, reload Turn N's .enc
            Compact from known-good state → retry with byte-identical system prompt
            KV cache from Turn N still valid — no recomputation needed
```

The `.enc` file is always a complete, valid conversation state. On failure, rollback to the previous checkpoint is automatic and the provider-side KV cache remains intact. No partial state touches disk.

### Semantic Maximum

This achieves the **theoretical maximum** for agentic conversations: one system prompt assembly per compaction segment → frozen until reset → zero KV cache invalidations → AGENTS.md updates atomic at conversation boundaries. The `.enc` file isn't just a performance cache — it's a **conversation integrity guarantee**.

## Solution Architecture

```
┌──────────────────────────────────────────────────────┐
│                 .enc Checkpoint File                  │
│  {                                                    │
│    systemPrompt: string[],     // assembled system     │
│    messages: ModelMessage[],   // AI SDK format        │
│    messageIDs: string[],       // DB message IDs       │
│    model: { providerID, modelID },                     │
│    turn: number,                                       │
│    timestamp: number                                   │
│  }                                                    │
│  Encrypted: AES-256-GCM, key = SHA-256(pid:wdir:sid)  │
│  Naming: .checkpoints/{provider}_{model}_{sid}.enc      │
└──────────────────────────────────────────────────────┘
```

## Flow

### Startup / Model Switch

```
1. Load .enc for (sessionID, modelID)
   ├── Exists → decrypt → systemPrompt + messages ready
   └── Missing → full assembly (one-time)

2. Query DB: "messages WHERE id NOT IN (checkpoint.messageIDs)"
   → Convert new messages only → append to model-ready messages

3. Full conversation is now: checkpoint.messages + new_delta_messages
```

### Per Turn

```
1. Check overflow (token count of checkpoint + deltas)
   ├── Overflow → compact checkpoint messages → rebuild system → new checkpoint
   └── OK → reuse checkpoint

2. Send to provider with checkpoint.systemPrompt + checkpoint.messages + deltaMessages

3. Provider responds → success:
   └── New checkpoint = { systemPrompt, messages + new assistant response, messageIDs + new, ... }
   └── Encrypt + write atomically (write to temp, rename)
   └── Also write to DB (for durability queries, restore)

4. Provider responds → failure:
   └── Checkpoint untouched — rollback to previous state automatically
```

### Compaction

```
1. Compact operates on checkpoint.messages only (known-good state)
2. Add uncompacted delta messages from DB
3. Produce new systemPrompt + compacted messages
4. Write as new checkpoint
```

### Model Switch

```
1. Save current model's checkpoint (already done on last success)
2. Load target model's .enc
3. Target model's DB deltas = messages WHERE id NOT IN (target_checkpoint.messageIDs)
4. Each model has independent checkpoint — zero interference
```

### Subagent Reuse

```
1. Task agent acquires cache lease → same providerCacheKey
2. Subagent's system prompt = parent's checkpoint.systemPrompt
3. Subagent's messages = fresh (empty or resumed task)
4. On subagent completion: parent's checkpoint unchanged (subagent has own child session)
```

---

## Code Changes

### [x] 1. New Module: `session/checkpoint.ts` (IMPLEMENTED, 129 lines actual)

**Status:** Complete — `src/session/checkpoint.ts` exists with full `save()`/`load()`/`remove()` API, atomic writes, AES-256-GCM encryption reuse from `request-diff.ts`. Actual line count is 129 (compact implementation, not 300 as originally estimated).

```
Checkpoint.Service:
  load(sessionID, model)      → Checkpoint | null
  save(sessionID, model, data) → Effect<void>
  delete(sessionID)            → Effect<void>
  getMessageIDs(checkpoint)    → string[]
  
Checkpoint data:
  systemPrompt: string[]     // [banner, ...rules, ...env, ...skills, ...instructions]
  messages: ModelMessage[]   // AI SDK format, ready for provider
  messageIDs: string[]       // DB message IDs included
  systemFingerprint: string  // MD5 of systemPrompt.join("")
  turn: number
```

**Reuses:** `request-diff.ts` encryption helpers (`deriveKey`, `encryptBaseline`, `decryptBaseline`) but writes to a separate `.checkpoints/` namespace so request-diff `.baselines/` files cannot collide with checkpoints.

### 2. Modify: `session/prompt.ts` (~100 lines changed)

- `runLoop()`: replace `Effect.all([sys.skills, ...])` + `toModelMessagesEffect()` with checkpoint load
- Add delta-message read after checkpoint load
- Call `checkpoint.save()` after successful provider response
- Overflow check against checkpoint.messages length (not DB-scan messages)

### 3. Modify: `session/compaction.ts` (~30 lines changed)

- Accept checkpoint messages as input (not DB-loaded messages)
- Return compacted messages → written as new checkpoint

### 4. Modify: `session/session.ts` (~5 lines)

- `deleteSession()` → `checkpoint.delete(sessionID)`

### 5. Storage separation from `session/request-diff.ts`

- Existing `encryptBaseline`/`decryptBaseline`/`deriveKey` reused directly
- Checkpoints use `session/checkpoint.ts::checkpointPath()` under `.checkpoints/`
- Request-diff baselines remain under `.baselines/`
- Regression coverage verifies checkpoint saves do not overwrite request-diff baselines

### 6. Documentation updates (~30 min)

- Document `.baselines/` system in prompt components enumeration
- Add checkpoint architecture to `AGENTS.md` / `DOCINDEX.md`
- Update `index.md`

---

## Rollback Safety

```
Turn N success → .enc[N] written
Turn N+1 starts → .enc[N] loaded
Turn N+1 overflow → compact from .enc[N] messages → write .enc[N+1] (compacted)
Turn N+2 bug/crash → restart → load .enc[N+1] (the compacted state, post-overflow recovery)
Turn N+2 success → .enc[N+2] written
```

The checkpoint is ALWAYS a valid complete state. No partial writes (atomic rename). No corruption from crash mid-write.

---

## DB Usage Reduction

| Operation | Before | After |
|-----------|--------|-------|
| Message load per turn | `SELECT * FROM message WHERE session_id = ? ORDER BY created_at` (all rows) | `SELECT * FROM message WHERE session_id = ? AND id NOT IN (checkpoint_ids)` (deltas only) |
| Message conversion | All messages every turn | Only new messages |
| Prompt assembly | skills + env + rules + instructions every turn | Only on checkpoint miss or compaction |
| DB writes | Write message + part on each response | Same (plus checkpoint save is file I/O, not DB) |

---

## Fallback / Safety

- If `.enc` file corrupt → delete, full rebuild from DB (graceful degradation)
- If encryption key derivation fails → full rebuild from DB
- If checkpoint version mismatch → full rebuild
- Checkpoint file capped at reasonable size (no unlimited growth)
- Config flag `experimental_conversation_checkpoints` (default: on) to disable if needed

---

## Verification

1. `bun typecheck` — zero errors
2. Unit test: checkpoint save/load round-trip
3. Unit test: delta message detection after checkpoint
4. Unit test: compaction from checkpoint messages
5. Unit test: model switch loads correct checkpoint
6. Unit test: rollback on failed save (corrupt file)
7. Integration: 50-turn session, verify N DB reads stay at 1 per turn
8. Integration: subagent session inherits parent prompt via checkpoint

---

## Implementation Order

```
1. checkpoint.ts                 ← new module, encryption reuse
2. prompt.ts delta integration   ← replace full-load with checkpoint+delta
3. compaction.ts integration     ← accept checkpoint messages
4. session.ts cleanup            ← delete checkpoint on session delete
5. checkpoint/request-diff path split ← separate checkpoint and diff baseline namespaces
6. Documentation                 ← .baselines/ system + ADID Framework
```

```YAML
master_plan_description: "Per-model encrypted conversation checkpoint — eliminate per-turn prompt assembly, reduce DB reads to deltas, atomic rollback on failure"

SV for checkpoint module:
  Document: plans/20260624_checkpoint_plan.md
  Done: ~17%
  [x] SV for task 1 — checkpoint.ts new module
  [ ] SV for task 2 — prompt.ts delta integration
  [ ] SV for task 3 — compaction.ts integration
  [ ] SV for task 4 — session.ts cleanup
  [ ] SV for task 5 — request-diff.ts marker
  [ ] SV for task 6 — documentation

Done: ~17% (1/6 tasks complete)
```
