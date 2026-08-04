---
status: planned
owner: codex
created: 2026-06-25
reproduce:
  - cd packages/opencode
  - bun test test/storage/ --test-name-pattern "fts"
  - cd ../.. && tools/adm.exe --verify-all packages/opencode/src/storage packages/opencode/migration
---

# FTS Trigger Migration Plan

## Goal

Track the FTS5 virtual table and triggers in the Drizzle migration baseline so `snapshot.json` reflects the complete database schema. Currently FTS5 exists only as a runtime `FTS_SCHEMA_SQL` constant applied via `db.$client.exec()` at DB init — it works correctly but is invisible to Drizzle Kit introspection.

## Abstract Definition

Let `S_migration` be the schema defined in `migration/20260601000000_baseline_local_development/migration.sql`. Let `S_runtime` be the union of `S_migration` with `FTS_SCHEMA_SQL` from `db.ts:243-297`.

**Current**: `partition_fts` ∈ `S_runtime` \ `S_migration` — the FTS5 virtual table and triggers exist at runtime but are not captured in the migration snapshot.

**Target**: `partition_fts` ⊆ `S_migration` — FTS5 schema is part of the baseline migration, making `drizzle-kit generate` aware of the full schema.

## Formalization

```
FTS_SCHEMA = {
  VIRTUAL_TABLE  part_fts USING fts5(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, coefs...),
  TRIGGER        part_fts_insert AFTER INSERT ON part → extract JSON → INSERT INTO part_fts,
  TRIGGER        part_fts_delete AFTER DELETE ON part → DELETE FROM part_fts WHERE part_id = old.id,
  TRIGGER        part_fts_update AFTER UPDATE ON part → DELETE old + INSERT new
}

Operation:
  1. Append FTS_SCHEMA to baseline migration/migration.sql
  2. Regenerate snapshot.json via drizzle-kit introspect (or manual sync)
  3. Remove FTS_SCHEMA_SQL from db.ts runtime path once migrations guarantee it
  4. Guard: IF NOT EXISTS must remain on all DDL for idempotent re-runs
```

## Structural Diagram

```
Current:
  DB open → CORE_SCHEMA_SQL (tables+indexes, IF NOT EXISTS) → migrations run → FTS_SCHEMA_SQL (IF NOT EXISTS)
  FTS_SCHEMA_SQL lives only in db.ts constant

Target:
  DB open → CORE_SCHEMA_SQL (tables+indexes, IF NOT EXISTS) → migrations run (includes FTS5 DDL) → [FTS_SCHEMA_SQL removed or no-op]
  FTS5 DDL lives in baseline migration, snapshot.json includes part_fts
```

## Tasks

- [x] 1. Append FTS5 DDL to `migration/20260601000000_baseline_local_development/migration.sql`
- [x] 2. Add FTS5 entries to `migration/20260601000000_baseline_local_development/snapshot.json` (skipped — no snapshot.json exists in baseline dir; Drizzle doesn't use it at runtime per plan corrections)
- [x] 3. Remove or guard `FTS_SCHEMA_SQL` execution in `db.ts` (keep as safety net with `IF NOT EXISTS` or remove entirely)
- [x] 4. Add test: verify FTS5 triggers fire after clean migration (insert part → text appears in FTS)
- [x] 5. Add test: verify part_fts survives WAL checkpoint + VACUUM (virtual table rebuild)
- [ ] 6. Run `drizzle-kit generate` to verify no spurious diff
- [ ] 7. Run typecheck + full test suite

## Input/Output Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| Input: `migration.sql` | SQL file | Baseline migration (164 lines) |
| Input: `snapshot.json` | JSON | Drizzle Kit schema snapshot |
| Input: `db.ts` | TypeScript | DB init with `FTS_SCHEMA_SQL` constant |
| Output: Updated `migration.sql` | SQL file | Includes FTS5 DDL |
| Output: Updated `snapshot.json` | JSON | Includes part_fts virtual table definition |
| Output: Modified `db.ts` | TypeScript | FTS_SCHEMA_SQL removed or guarded |

## Brief Implementation

### Step 1: Append FTS5 DDL to baseline migration

The baseline migration at `migration/20260601000000_baseline_local_development/migration.sql` has 164 lines defining 14 tables + indexes. Append the FTS5 DDL after the last CREATE INDEX:

```sql
-- FTS5 full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS "part_fts" USING fts5(
  part_id UNINDEXED,
  session_id UNINDEXED,
  message_id UNINDEXED,
  part_type UNINDEXED,
  text_content,
  semantic_vector,
  dominant_topic,
  exact_coef UNINDEXED,
  inferred_coef UNINDEXED,
  hypothetical_coef UNINDEXED,
  guess_coef UNINDEXED,
  unknown_coef UNINDEXED
);

CREATE TRIGGER IF NOT EXISTS part_fts_insert AFTER INSERT ON part BEGIN
  INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
  SELECT
    new.id,
    new.session_id,
    new.message_id,
    json_extract(new.data, '$.type'),
    COALESCE(json_extract(new.data, '$.text'), json_extract(new.data, '$.state.output'), json_extract(new.data, '$.state.error'), json_extract(new.data, '$.filename'), ''),
    COALESCE(json_extract(new.data, '$.semantic_vector'), ''),
    COALESCE(json_extract(new.data, '$.dominant_topic'), ''),
    COALESCE(json_extract(new.data, '$.exact_coef'), 0),
    COALESCE(json_extract(new.data, '$.inferred_coef'), 0),
    COALESCE(json_extract(new.data, '$.hypothetical_coef'), 0),
    COALESCE(json_extract(new.data, '$.guess_coef'), 0),
    COALESCE(json_extract(new.data, '$.unknown_coef'), 0);
END;

CREATE TRIGGER IF NOT EXISTS part_fts_delete AFTER DELETE ON part BEGIN
  DELETE FROM part_fts WHERE part_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS part_fts_update AFTER UPDATE ON part BEGIN
  DELETE FROM part_fts WHERE part_id = old.id;
  INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
  SELECT
    new.id,
    new.session_id,
    new.message_id,
    json_extract(new.data, '$.type'),
    COALESCE(json_extract(new.data, '$.text'), json_extract(new.data, '$.state.output'), json_extract(new.data, '$.state.error'), json_extract(new.data, '$.filename'), ''),
    COALESCE(json_extract(new.data, '$.semantic_vector'), ''),
    COALESCE(json_extract(new.data, '$.dominant_topic'), ''),
    COALESCE(json_extract(new.data, '$.exact_coef'), 0),
    COALESCE(json_extract(new.data, '$.inferred_coef'), 0),
    COALESCE(json_extract(new.data, '$.hypothetical_coef'), 0),
    COALESCE(json_extract(new.data, '$.guess_coef'), 0),
    COALESCE(json_extract(new.data, '$.unknown_coef'), 0);
END;
```

### Step 2: Update snapshot.json

The baseline migration at `migration/20260601000000_baseline_local_development/` **does not contain a `snapshot.json`** (verified 2026-06-25). The migration was created manually, not via `drizzle-kit generate`. Two options:
- **Option A**: Create `snapshot.json` by running `drizzle-kit generate` after adding FTS DDL to `migration.sql`
- **Option B**: Skip snapshot.json — the migration SQL is the source of truth; Drizzle doesn't use snapshot.json at runtime

### Step 3: Guard FTS_SCHEMA_SQL in db.ts

After migration inclusion, the runtime execution becomes a safety net for databases that haven't run migrations. Guard it behind a check or remove it:

```typescript
// Option A: Remove entirely (trust migrations)
// Delete lines 66-70 and the FTS_SCHEMA_SQL constant

// Option B: Guard with a check (safer for existing installs)
const hasFTS = db.$client.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='part_fts'"
).get()
if (!hasFTS) {
  db.$client.exec(FTS_SCHEMA_SQL)
}
```

Recommend Option B for backward compatibility with existing databases that haven't run the migration.

### Step 4-5: Tests

```typescript
test("FTS5 triggers fire on part INSERT", () => { /* insert part → verify text in part_fts */ })
test("FTS5 triggers fire on part UPDATE", () => { /* update part → old text removed, new text in part_fts */ })
test("FTS5 triggers fire on part DELETE", () => { /* delete part → text removed from part_fts */ })
test("FTS5 survives WAL checkpoint and DB reopen", () => { /* checkpoint + reopen → FTS still queries correctly */ })
test("FTS5 survives VACUUM", () => { /* vacuum → FTS still queries correctly */ })
```

## Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| 1 | Insert a text part → `part_fts` contains the text via trigger | `SELECT * FROM part_fts` returns row with text |
| 2 | Update a text part → `part_fts` has old text removed, new text present | Count matches before/after |
| 3 | Delete a text part → `part_fts` row removed | Row count decrements |
| 4 | Messagesearch query returns results after clean migration | `search("test query")` returns matching results |
| 5 | drizzle-kit generate produces no spurious diff after FTS5 in migration | Zero changes in generated output |
| 6 | WAL checkpoint + DB reopen → FTS5 queries still work | search succeeds after checkpoint |
| 7 | VACUUM → FTS5 rebuilds correctly | search succeeds after vacuum |

## Corrections Applied (2026-06-25, explorer-validated)

- **Fixed**: `snapshot.json` does not exist in the baseline migration directory — the migration was created manually without `drizzle-kit generate`. Updated Step 2 to reflect two viable approaches.
- All other plan claims verified accurate: FTS_SCHEMA_SQL location, trigger definitions, search query integration, execution order in db.ts.
