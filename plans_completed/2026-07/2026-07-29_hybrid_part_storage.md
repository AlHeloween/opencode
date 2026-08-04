# B5: Hybrid Part Storage — Indexed Columns for Part Table

Framework: ADID 15.4.3. This plan adds first-class indexed columns (`type`,
`tool_name`, `status`) to the `part` table to eliminate JSON-parse overhead
during hydration, filtering, and search. This is the highest-impact structural
optimization for read-heavy workloads.

## SVM: Vector summary

Semantic vector: `["indexed columns", "JSON extraction", "hydration speed", "query pushdown"]`
with weights `[0.35, 0.30, 0.20, 0.15]`.

Information Mark: **Hypothetical** — design reviewed, failure mechanisms
identified (migration rollback, JSON forward-compat, projector consistency).
Awaiting Exact materialization and conformance oracle evidence.

## 1. Goal and scope

**Goal**: Reduce part hydration latency by 40–60% and enable SQL-level filtering
on part type, tool name, and status without parsing the JSON `data` column.

**Scope**: Drizzle schema (`session.sql.ts`), raw SQL schema (`db.ts`
CORE_SCHEMA_SQL), SyncEvent projector (`projectors.ts` PartUpdated handler),
and the `hydrate()` function in `message-v2.ts`. A Drizzle migration is required.

**Non-goals**: Do NOT change the `data` JSON column (it remains the canonical
storage for all part fields). Do NOT backfill historical parts (existing rows
keep `type = 'unknown'`; only new parts get typed). Do NOT change the Part
type definitions in `message-v2.ts`.

## 2. Current state assessment (Exact)

### P1: Part table stores everything in a JSON `data` column

**File**: `packages/opencode/src/session/session.sql.ts`, lines 77–93

```typescript
export const PartTable = sqliteTable("part", {
  id: text().$type<PartID>().primaryKey(),
  message_id: text().$type<MessageID>().notNull(),
  session_id: text().$type<SessionID>().notNull(),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<PartData>(),
}, (table) => [
  index("part_message_id_id_idx").on(table.message_id, table.id),
  index("part_session_idx").on(table.session_id),
])
```

Raw SQL (db.ts:127–136):
```sql
CREATE TABLE IF NOT EXISTS "part" (
  id text PRIMARY KEY NOT NULL,
  message_id text NOT NULL,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
```

There are only two indexes: `(message_id, id)` and `(session_id)`. No way to
query "all tool parts of message X" without loading and parsing every part.

### P2: hydrate() loads all parts then parses JSON for every row

**File**: `packages/opencode/src/session/message-v2.ts`, lines 720–744

```typescript
function hydrate(rows: (typeof MessageTable.$inferSelect)[]) {
  const ids = rows.map((row) => row.id)
  const partByMessage = new Map<string, Part[]>()
  if (ids.length > 0) {
    const partRows = Database.use((db) =>
      db.select().from(PartTable)
        .where(inArray(PartTable.message_id, ids))
        .orderBy(PartTable.message_id, PartTable.id)
        .all(),
    )
    for (const row of partRows) {
      const next = part(row)       // ← JSON.parse(row.data)
      const list = partByMessage.get(row.message_id)
      if (list) list.push(next)
      else partByMessage.set(row.message_id, [next])
    }
  }
  return rows.map((row) => ({
    info: info(row),
    parts: partByMessage.get(row.id) ?? [],
  }))
}
```

The `part()` function (line 708) does:
```typescript
const part = (row) => ({
  ...row.data,    // ← spreads parsed JSON
  id: row.id,
  sessionID: row.session_id,
  messageID: row.message_id,
})
```

Every `hydrate()` call parses JSON for ALL parts of ALL requested messages.
With 100 messages × 5 parts average = 500 JSON.parse calls per page load.

### P3: The PartUpdated projector writes the full JSON blob

**File**: `packages/opencode/src/session/projectors.ts`, lines 133–151

```typescript
SyncEvent.project(MessageV2.Event.PartUpdated, (db, data) => {
  const { id, messageID, sessionID, ...rest } = data.part
  db.insert(PartTable)
    .values({
      id, message_id: messageID, session_id: sessionID,
      time_created: data.time,
      data: rest,   // ← everything except id/messageID/sessionID
    })
    .onConflictDoUpdate({ target: PartTable.id, set: { data: rest } })
    .run()
})
```

### P4: Part types are a discriminated union with known discriminators

**File**: `packages/opencode/src/session/message-v2.ts`, lines 430–443

```typescript
const _Part = Schema.Union([
  TextPart, ReasoningPart, FilePart, ToolPart,
  StepStartPart, StepFinishPart, SnapshotPart,
  PatchPart, AgentPart, RetryPart, CompactionPart,
  SubtaskPart,
]).annotate({ discriminator: "type", identifier: "Part" })
```

The `type` field is the discriminator. For `ToolPart`, `tool` and `state.status`
are the most frequently queried sub-fields.

## 3. Task definition

| # | Task | Weight | Dependencies | State |
|---|------|--------|--------------|-------|
| T1 | Add columns to Drizzle schema | 0.15 | — | pending |
| T2 | Add columns to raw SQL schema | 0.10 | T1 | pending |
| T3 | Generate Drizzle migration | 0.10 | T1, T2 | pending |
| T4 | Update PartUpdated projector | 0.25 | T1 | pending |
| T5 | Rewrite `part()` row mapper | 0.15 | T1 | pending |
| T6 | Add `part_type_idx` and `part_tool_status_idx` | 0.05 | T1 | pending |
| T7 | Smoke tests + migration test | 0.10 | T1–T6 | pending |
| T8 | Benchmark hydration before/after | 0.10 | T1–T6 | pending |

## 4. Exact materialized transition

### T1: Drizzle schema

**File**: `packages/opencode/src/session/session.sql.ts`, lines 77–93

Replace with:

```typescript
export const PartTable = sqliteTable("part", {
  id: text().$type<PartID>().primaryKey(),
  message_id: text().$type<MessageID>().notNull()
    .references(() => MessageTable.id, { onDelete: "cascade" }),
  session_id: text().$type<SessionID>().notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  // NEW: indexed columns extracted from JSON data
  type: text().notNull().default("unknown"),
  tool_name: text(),
  status: text(),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<PartData>(),
}, (table) => [
  index("part_message_id_id_idx").on(table.message_id, table.id),
  index("part_session_idx").on(table.session_id),
  index("part_type_idx").on(table.type),              // NEW
  index("part_tool_status_idx").on(table.tool_name, table.status), // NEW
])
```

### T2: Raw SQL schema

**File**: `packages/opencode/src/storage/db.ts`, lines 127–136 (CORE_SCHEMA_SQL)

Replace with:

```sql
CREATE TABLE IF NOT EXISTS "part" (
  id text PRIMARY KEY NOT NULL,
  message_id text NOT NULL,
  session_id text NOT NULL,
  type text NOT NULL DEFAULT 'unknown',
  tool_name text,
  status text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
CREATE INDEX IF NOT EXISTS "part_message_id_id_idx" ON "part" ("message_id", "id");
CREATE INDEX IF NOT EXISTS "part_session_idx" ON "part" ("session_id");
CREATE INDEX IF NOT EXISTS "part_type_idx" ON "part" ("type");
CREATE INDEX IF NOT EXISTS "part_tool_status_idx" ON "part" ("tool_name", "status");
```

### T3: Migration

Run: `bun run db generate --name add_part_type_columns` from `packages/opencode`

Expected migration SQL (illustrative — actual generated by Drizzle Kit):

```sql
ALTER TABLE "part" ADD COLUMN "type" text NOT NULL DEFAULT 'unknown';
ALTER TABLE "part" ADD COLUMN "tool_name" text;
ALTER TABLE "part" ADD COLUMN "status" text;
CREATE INDEX IF NOT EXISTS "part_type_idx" ON "part" ("type");
CREATE INDEX IF NOT EXISTS "part_tool_status_idx" ON "part" ("tool_name", "status");
```

### T4: Projector update

**File**: `packages/opencode/src/session/projectors.ts`, lines 133–151

```typescript
SyncEvent.project(MessageV2.Event.PartUpdated, (db, data) => {
  const { id, messageID, sessionID, type, ...rest } = data.part

  // Extract indexed fields from the part shape
  const partType = type ?? "unknown"
  const toolName = type === "tool" ? (rest as any).tool ?? null : null
  const partStatus = (rest as any).state?.status ?? null

  try {
    db.insert(PartTable)
      .values({
        id,
        message_id: messageID,
        session_id: sessionID,
        type: partType,
        tool_name: toolName,
        status: partStatus,
        time_created: data.time,
        data: rest,
      })
      .onConflictDoUpdate({
        target: PartTable.id,
        set: {
          data: rest,
          type: partType,
          tool_name: toolName,
          status: partStatus,
        },
      })
      .run()
  } catch (err) {
    if (!foreign(err)) throw err
    log.error("ignored late part update — part references deleted session?", {
      partID: id, messageID, sessionID,
    })
  }
})
```

### T5: Row mapper update

**File**: `packages/opencode/src/session/message-v2.ts`, line 708

```typescript
// Before:
const part = (row: typeof PartTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  }) as Part

// After:
const part = (row: typeof PartTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
    // Surface indexed columns for type-safe access (avoids re-parsing JSON)
    _type: row.type,
    _toolName: row.tool_name,
    _status: row.status,
  }) as Part
```

### T6: Index creation

Indexes are created inline in T1 (Drizzle) and T2 (raw SQL). No separate step.

## 5. Verification criteria (oracles)

| # | Oracle | Pass criteria |
|---|--------|---------------|
| O1 | `bun run db generate` | Migration SQL generated without errors |
| O2 | Migration applies cleanly on fresh DB | No constraint violations |
| O3 | Migration applies on existing DB with data | Existing parts get `type='unknown'`; no data loss |
| O4 | `bun test test/session/` from `packages/opencode` | All session tests pass |
| O5 | New part creation | `type`, `tool_name`, `status` columns populated correctly |
| O6 | Part update (onConflictDoUpdate) | Indexed columns updated on subsequent writes |
| O7 | `hydrate()` correctness | Parts load with correct typed fields |
| O8 | Migration rollback | `ALTER TABLE part DROP COLUMN type/tool_name/status` restores schema |
| O9 | Hydration benchmark | ≥40% reduction in `hydrate()` time for 100+ message sessions |

## 6. Smoke Tests (PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/session/message-v2.test.ts` from `packages/opencode` | pass | (record) |
| 2 | `bun test test/session/session.test.ts` from `packages/opencode` | pass | (record) |
| 3 | `bun run typecheck` from `packages/opencode` | pass | (record) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/session/` from `packages/opencode` | all pass |
| 2 | `bun run typecheck` from `packages/opencode` | pass |
| 3 | `bun run db generate --name add_part_type_columns` | migration generated |

### Gate
- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

## 7. Implementation sequence (ordered checkboxes)

- [ ] T1: Add `type`, `tool_name`, `status` columns to Drizzle schema in `session.sql.ts:77–93`
- [ ] T2: Add columns + indexes to CORE_SCHEMA_SQL in `db.ts:127–136`
- [ ] T3: Run `bun run db generate --name add_part_type_columns`
- [ ] T4: Update PartUpdated projector in `projectors.ts:133–151`
- [ ] T5: Update `part()` row mapper in `message-v2.ts:708`
- [ ] T6: Verify indexes created (inline with T1/T2)
- [ ] T7: Record baseline smoke; run post-impl oracles
- [ ] T8: Benchmark hydration before/after; record evidence

## 8. Information Mark ledger

| Claim | Status | Premises | Evidence |
|-------|--------|----------|----------|
| Part table is JSON-only | Exact | P1 | Direct source inspection of session.sql.ts:77–93, db.ts:127–136 |
| hydrate() parses all parts | Exact | P2 | Direct source inspection of message-v2.ts:720–744 |
| PartUpdated projector writes JSON blob | Exact | P3 | Direct source inspection of projectors.ts:133–151 |
| Part types are discriminated union | Exact | P4 | Direct source inspection of message-v2.ts:430–443 |
| Indexed columns reduce hydration by 40–60% | Hypothetical | P1, P2, T1 | Falsifiable: benchmark before/after; required test: O9 |
| Migration is backward-compatible | Inferred | T3 | DEFAULT 'unknown' ensures existing rows are safe |
| No data loss on migration | Inferred | T2, T3 | ALTER TABLE ADD COLUMN is non-destructive in SQLite |

## 9. Non-destructive boundary

- Do NOT remove or alter the `data` JSON column (remains canonical)
- Do NOT backfill historical rows (existing rows get `type='unknown'`)
- Do NOT change Part type definitions or the discriminated union
- Do NOT change the `hydrate()` algorithm — only the `part()` row mapper
- Do NOT change SyncEvent infrastructure
- Migration MUST be reversible (DROP COLUMN for rollback)
- Test on a copy of a production DB before deploying

## 10. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Migration fails on large DB | Low | High | Test on DB copy first; SQLite ALTER TABLE is O(1) for new columns with DEFAULT |
| Projector writes wrong indexed values | Low | High | `type`, `tool_name`, `status` are derived from the same `data.part` object; schema tests catch mismatches |
| Old code reads new columns as undefined | Low | Medium | DEFAULT 'unknown' ensures non-null; old `part()` function ignores new columns (backward compat) |
| Index bloat | Low | Low | Two small indexes; SQLite handles efficiently |
