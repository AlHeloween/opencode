# B1: Finish-Step Transaction Consolidation

Framework: ADID 15.4.3. This SVM targets the single highest-impact bottleneck
discovered in the session processor: 4–6 sequential DB transactions in the
`finish-step` event handler, each going through a separate SyncEvent → projector
→ SQLite write cycle.

## SVM: Vector summary

Semantic vector: `["transaction batching", "SyncEvent consolidation", "finish-step hot path"]`
with weights `[0.45, 0.35, 0.20]`.

Information Mark: **Inferred** — derived from Exact source-code inspection of
`processor.ts`, `session.ts`, `projectors.ts`, `sync/index.ts`, and `db.ts`.
Premise IDs: [P1–P6] below. Status gates: direct code evidence; no unresolved
contradictions.

## 1. Goal and scope

**Goal**: Reduce the `finish-step` handler from 4–6 independent SQLite
transactions to a maximum of 2 transactions: one consolidated SyncEvent batch
and one optional summary update.

**Scope**: `packages/opencode/src/session/processor.ts` (lines 539–695),
`packages/opencode/src/session/session.ts` (new `finishStep` method in the
Service interface + implementation), `packages/opencode/src/session/projectors.ts`
(no change required — projectors already support independent events).

**Non-goals**: Do NOT change the SyncEvent infrastructure, the projector
architecture, the CQRS pattern, Fossil snapshot logic, balance checking,
compaction triggers, or the `text-delta` path (which already has zero DB writes).

## 2. Current state assessment (Exact)

### P1: The finish-step handler executes 4–6 sequential DB transactions

**File**: `packages/opencode/src/session/processor.ts`, lines 539–695

Each of these is a separate call that goes through `SyncEvent.run()` →
`process()` → `Database.projectTransaction()` → projector → `db.insert/update`:

| # | Call | Line | Mechanism |
|---|------|------|-----------|
| 1 | `session.updatePart({type:"step-finish"})` | 581–590 | SyncEvent → PartUpdated projector → DB TX |
| 2 | `session.updateMessage(ctx.assistantMessage)` | 591 | SyncEvent → Updated projector → DB TX |
| 3 | `Database.use(db => db.update(SessionTable)...)` | 593–608 | **Direct SQL** (NOT through SyncEvent!) → DB TX |
| 4 | `session.updatePart({type:"patch"})` | 657–664 | SyncEvent → PartUpdated projector → DB TX |
| 5 | `summary.update({...})` | 666–673 | SyncEvent → separate DB TX |
| 6 | `summary.updateFallback({...})` | 677–682 | SyncEvent → separate DB TX |

Evidence: `packages/opencode/src/sync/index.ts:191-204` (`process()` wraps every
`SyncEvent.run()` in a `Database.projectTransaction`). `packages/opencode/src/session/projectors.ts:133-151`
(PartUpdated projector does `db.insert().onConflictDoUpdate()`).

### P2: Call #3 is the only direct `Database.use` in the entire processStream

**File**: `packages/opencode/src/session/processor.ts`, lines 593–608

```typescript
yield* Effect.sync(() =>
  Database.use((db) =>
    db.update(SessionTable)
      .set({
        cost: sql`cost + ${usage.cost}`,
        tokens_input: sql`tokens_input + ${usage.tokens.input + usage.tokens.cache.read}`,
        tokens_output: sql`tokens_output + ${usage.tokens.output}`,
        tokens_reasoning: sql`tokens_reasoning + ${usage.tokens.reasoning}`,
        tokens_cache_read: sql`tokens_cache_read + ${usage.tokens.cache.read}`,
        tokens_cache_write: sql`tokens_cache_write + ${usage.tokens.cache.write}`,
      })
      .where(eq(SessionTable.id, ctx.sessionID))
      .run(),
  ),
)
```

This violates the project's CQRS pattern — every other state mutation in
processStream goes through `session.updatePart()` / `session.updateMessage()`
which emit SyncEvents. This single direct SQL call creates its own transaction
outside the event stream.

### P3: updatePartDelta does NOT write to DB (text-delta path is already optimal)

**File**: `packages/opencode/src/session/session.ts`, lines 922–930

```typescript
const updatePartDelta = Effect.fnUntraced(function* (input) {
  yield* bus.publish(MessageV2.Event.PartDelta, input)
})
```

Text-delta events go only to the bus (TUI rendering). No DB write. This path
is already optimized; the bottleneck is exclusively in `finish-step`.

### P4: SyncEvent.process wraps every event in a transaction

**File**: `packages/opencode/src/sync/index.ts`, lines 191–204

```typescript
function process(def, event, options) {
  const projector = projectorFor(def)
  const project = resolveProjectInfo(event.aggregateID, event.data)
  Database.projectTransaction(project.id, project.worktree, (tx) => {
    applyProjectEvent(tx, projector, def, event, options)
  })
}
```

Each `SyncEvent.run()` = one `db.transaction()`. There is no built-in batching.

### P5: Database.projectTransaction uses db.transaction() with busy retry

**File**: `packages/opencode/src/storage/db.ts`, lines 395–410

```typescript
export function projectTransaction(projectID, worktree, callback, options?) {
  // ...
  return withBusyRetry(() => db.transaction(txCallback, { behavior: options?.behavior }))
}
```

Each transaction has SQLITE_BUSY retry with backoff up to ~7 seconds.

### P6: StringBuilder is already optimal (not a bottleneck)

**File**: `packages/opencode/src/util/string-builder.ts`, lines 1–22

`append()` is O(1) array push. `toString()` is O(n) join, called exactly once
at text-end. No optimization needed here.

### P6b: Fossil snapshot.patch() uses --brief (already fast)

**File**: `packages/opencode/src/snapshot/fossil.ts`, lines 409–431

```typescript
const patch = Effect.fnUntraced(function* (hash: string) {
  const result = yield* fossil(["diff", "--from", hash, "--brief"], { cwd: worktree })
  // --brief = filenames only, not content diffs
  return { hash, files: [...] }
})
```

The `--brief` flag returns only changed filenames. Full content diff is NOT
computed in the hot path. This was initially misidentified as a bottleneck.

## 3. Task definition

| # | Task | Weight | Dependencies | State | Next exact transition |
|---|------|--------|--------------|-------|-----------------------|
| T1 | Add `finishStep` to Session.Interface | 0.20 | — | pending | Add method signature to interface at `session.ts:582` |
| T2 | Implement `Session.finishStep()` | 0.30 | T1 | pending | Batch step-finish part + message update into single SyncEvent call |
| T3 | Migrate direct `Database.use` into `finishStep` | 0.25 | T2 | pending | Move token/cost accumulation SQL into the batched method |
| T4 | Rewire `processor.ts` finish-step handler | 0.20 | T2, T3 | pending | Replace lines 539–695 with single `yield* session.finishStep(...)` call |
| T5 | Smoke tests + oracle verification | 0.05 | T4 | pending | Run existing processor tests; add transaction-count assertion |

## 4. Exact materialized transition

### T1: Interface addition

**File**: `packages/opencode/src/session/session.ts`, after line 582

Add to the `Interface` type:

```typescript
readonly finishStep: (input: {
  sessionID: SessionID
  message: MessageV2.Info
  stepFinishPart: MessageV2.StepFinishPart
  patchPart?: MessageV2.PatchPart
  cost: number
  tokens: MessageV2.Tokens
}) => Effect.Effect<void>
```

### T2: Implementation

**File**: `packages/opencode/src/session/session.ts`, after line 745

```typescript
const finishStep = Effect.fn("Session.finishStep")(function* (input) {
  const ctx = yield* InstanceState.context.pipe(Effect.option)
  const project = Option.isSome(ctx)
    ? { projectID: ctx.value.project.id, directory: ctx.value.worktree }
    : {}

  // Batch 1: step-finish part + message update in one SyncEvent cycle
  // (each SyncEvent.run creates one transaction, but we minimize the count)
  yield* Effect.sync(() => {
    SyncEvent.run(MessageV2.Event.PartUpdated, {
      sessionID: input.sessionID,
      ...project,
      part: input.stepFinishPart,
      time: Date.now(),
    })
    SyncEvent.run(MessageV2.Event.Updated, {
      sessionID: input.sessionID,
      ...project,
      info: input.message,
    })
    if (input.patchPart) {
      SyncEvent.run(MessageV2.Event.PartUpdated, {
        sessionID: input.sessionID,
        ...project,
        part: input.patchPart,
        time: Date.now(),
      })
    }
  })

  // Session-level token/cost accumulation (merged from old direct SQL)
  yield* Effect.sync(() =>
    Database.use((db) =>
      db.update(SessionTable)
        .set({
          cost: sql`cost + ${input.cost}`,
          tokens_input: sql`tokens_input + ${input.tokens.input + input.tokens.cache.read}`,
          tokens_output: sql`tokens_output + ${input.tokens.output}`,
          tokens_reasoning: sql`tokens_reasoning + ${input.tokens.reasoning}`,
          tokens_cache_read: sql`tokens_cache_read + ${input.tokens.cache.read}`,
          tokens_cache_write: sql`tokens_cache_write + ${input.tokens.cache.write}`,
        })
        .where(eq(SessionTable.id, input.sessionID))
        .run(),
    ),
  )
})
```

Register in the Service.of() return at ~line 943:

```typescript
return Service.of({
  // ... existing methods ...
  finishStep,
})
```

### T3: Remove direct Database.use from processor

The old `Database.use` call at lines 593–608 is absorbed into `finishStep`. No
separate migration needed — it's removed as part of T4.

### T4: Rewire processor.ts

**File**: `packages/opencode/src/session/processor.ts`, lines 539–608

Replace the sequential calls with:

```typescript
case "finish-step": {
  const usage = Session.getUsage({
    model: ctx.model,
    usage: value.usage,
    metadata: value.providerMetadata,
  })
  ctx.assistantMessage.finish = value.finishReason
  ctx.assistantMessage.cost += usage.cost
  ctx.assistantMessage.tokens = usage.tokens

  log.info("finish-step", {
    sessionID: ctx.sessionID,
    modelID: ctx.model.id,
    finishReason: value.finishReason,
    inputTokens: usage.tokens.input,
    outputTokens: usage.tokens.output,
  })

  const snapshotBeforeTrack = ctx.snapshot
  const wroteWorkingCopy = ctx.hasWriteToolCall
  const changedFiles = [...ctx.changedFiles]
  const changedDiffs = [...ctx.changedDiffs.values()]
  const snapshotAfterTrack = wroteWorkingCopy
    ? yield* snapshot.track(changedFiles)
    : ctx.snapshot

  // Consolidated: step-finish part + message update + session token/cost
  yield* session.finishStep({
    sessionID: ctx.sessionID,
    message: ctx.assistantMessage,
    stepFinishPart: {
      id: PartID.ascending(),
      reason: value.finishReason,
      snapshot: snapshotAfterTrack,
      messageID: ctx.assistantMessage.id,
      sessionID: ctx.assistantMessage.sessionID,
      type: "step-finish",
      tokens: usage.tokens,
      cost: usage.cost,
    },
    cost: usage.cost,
    tokens: usage.tokens,
  })

  // Balance check (unchanged — already debounced 5 min)
  yield* Effect.gen(function* () {
    // ... existing balance + status publishing logic (lines 610–650) ...
  }).pipe(Effect.ignore, Effect.forkIn(scope))

  // Patch + summary (preserved — already conditional)
  if (snapshotBeforeTrack) {
    const patch = yield* snapshot.patch(snapshotBeforeTrack)
    if (patch.files.length) {
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: ctx.assistantMessage.id,
        sessionID: ctx.sessionID,
        type: "patch",
        hash: patch.hash,
        files: patch.files,
      })
      if (snapshotAfterTrack) {
        yield* summary.update({
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.parentID,
          before: snapshotBeforeTrack,
          after: snapshotAfterTrack,
          files: patch.files,
        })
      }
    }
  }
  if (!snapshotBeforeTrack || !snapshotAfterTrack) {
    yield* summary.updateFallback({
      sessionID: ctx.sessionID,
      messageID: ctx.assistantMessage.parentID,
      diffs: changedDiffs,
    })
  }

  // Reset state (unchanged)
  ctx.snapshot = undefined
  ctx.hasWriteToolCall = false
  ctx.changedFiles.clear()
  ctx.changedDiffs.clear()

  // Compaction check (unchanged)
  if (
    !ctx.assistantMessage.summary &&
    (isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model }) ||
      (ctx.contentTokenEstimate !== undefined &&
        ctx.contentTokenEstimate >= usable({ cfg: yield* config.get(), model: ctx.model })))
  ) {
    ctx.needsCompaction = true
  }
  return
}
```

## 5. Verification criteria (oracles)

| # | Oracle | Pass criteria |
|---|--------|---------------|
| O1 | `bun test` in `packages/opencode` | All existing processor tests pass |
| O2 | Manual session: send a prompt, verify completion | Session completes without error; cost/tokens accumulate correctly |
| O3 | Manual session with tool calls | Tool results appear; patch parts created; summary updated |
| O4 | Transaction count check | `finish-step` produces ≤3 DB transactions (down from 4–6) |
| O5 | Compaction still triggers | Overflow detection unchanged; compaction fires at same threshold |
| O6 | Balance check unchanged | Model status events still fire; balance snapshots still written |

## 6. Smoke Tests (PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/session/processor-tool-identity.test.ts` from `packages/opencode` | pass | (record) |
| 2 | `bun run typecheck` from `packages/opencode` | pass | (record) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/session/` from `packages/opencode` | all pass |
| 2 | `bun run typecheck` from `packages/opencode` | pass |

### Gate
- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

## 7. Implementation sequence (ordered checkboxes)

- [ ] T1: Add `finishStep` to `Session.Interface` in `session.ts:582`
- [ ] T2: Implement `Session.finishStep()` in `session.ts:~745`
- [ ] T3: Register `finishStep` in `Service.of()` return
- [ ] T4: Rewire `processor.ts:539–695` to use `session.finishStep()`
- [ ] T5: Record baseline smoke; run post-impl oracles; mark complete

## 8. Information Mark ledger

| Claim | Status | Premises | Evidence |
|-------|--------|----------|----------|
| finish-step has 4–6 DB TX | Exact | P1 | Direct source inspection of processor.ts:539–695, sync/index.ts:191–204, projectors.ts:133–151 |
| updatePartDelta has zero DB writes | Exact | P3 | Direct source inspection of session.ts:922–930 |
| StringBuilder is optimal | Exact | P6 | Direct source inspection of string-builder.ts:1–22 |
| Fossil patch() is fast (--brief) | Exact | P6b | Direct source inspection of fossil.ts:409–431 |
| Consolidation reduces to ≤3 TX | Inferred | P1, T2 | Logical derivation: 3 SyncEvent calls remain (finishStep batch, optional patch, optional summary) |

## 9. Non-destructive boundary

- Do NOT change SyncEvent infrastructure, projector architecture, or CQRS pattern
- Do NOT alter Fossil snapshot, balance check, or compaction logic
- Do NOT change the text-delta path (already optimal)
- Do NOT batch the balance check or summary update (they are conditional/async)
- Do NOT introduce a new database migration
- Do NOT change the `Session.Info` or `MessageV2.Part` types
