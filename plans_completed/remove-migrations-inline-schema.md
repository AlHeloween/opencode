# Remove All Migrations — Inline Schema Directly in createAndInitDb

## Goal

Fold FTS and core schema creation directly into `createAndInitDb`, delete all migration directories/files, and remove all migration-related infrastructure (flags, configs, build steps, tests).

## Current State

- `createAndInitDb(dbPath)` creates the DB file and sets PRAGMAs only.
- `applyProjectMigrations(db)` is called separately (in `getProjectDb`, `use()`, `transaction()`) to run `CORE_SCHEMA_SQL` + `FTS_SCHEMA_SQL`.
- Migration directories (`migration/`, `migration-project/`) still exist and are bundled at build time via `OPENCODE_MIGRATIONS` (but not used at runtime).
- Build script copies migration directory to dist.

## Target State

- `createAndInitDb(dbPath)` creates the DB, sets PRAGMAs, and applies `CORE_SCHEMA_SQL` + `FTS_SCHEMA_SQL` in one shot.
- `applyProjectMigrations` function removed. All call sites updated.
- Migration directories deleted entirely. No migration bundling in build.
- `OPENCODE_SKIP_MIGRATIONS` flag removed.
- TUI config migration (`tui-migrate.ts`) is separate from DB migrations — keep it.

## Implementation Tasks

### 1. Fold schema into `createAndInitDb`

**File:** `packages/opencode/src/storage/db.ts`

Move `CORE_SCHEMA_SQL` and `FTS_SCHEMA_SQL` execution into `createAndInitDb`:

```ts
function createAndInitDb(dbPath: string): DrizzleClient {
  const dir = path.dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = init(dbPath) as DrizzleClient
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA wal_checkpoint(PASSIVE)")

  // Create all tables inline
  try {
    db.$client.exec(CORE_SCHEMA_SQL)
  } catch (e) {
    log.error("core schema failed", { error: String(e) })
    throw e
  }
  // FTS is non-fatal — app works without full-text search
  try {
    db.$client.exec(FTS_SCHEMA_SQL)
  } catch (e) {
    log.warn("FTS index creation failed (non-fatal)", { error: String(e) })
  }

  return db
}
```

Remove `applyProjectMigrations()` function entirely (lines 251-265).

### 2. Remove call sites of `applyProjectMigrations`

| Call site | File | Line | Change |
|-----------|------|------|--------|
| `getProjectDb()` | `db.ts` | 274 | Remove `applyProjectMigrations(db)` |
| `use()` fallback | `db.ts` | 333 | Remove `applyProjectMigrations(db as DrizzleClient)` |
| `transaction()` fallback | `db.ts` | 386 | Remove `applyProjectMigrations(db as DrizzleClient)` |

### 3. Remove `OPENCODE_SKIP_MIGRATIONS` flag

**File:** `packages/core/src/flag/flag.ts` line 80
- Remove the flag definition.

### 4. Delete migration directories

```
rm -rf packages/opencode/migration/
rm -rf packages/opencode/migration-project/
```

### 5. Remove migration bundling from build scripts

**File:** `packages/opencode/script/build.ts`
- Lines 20-48: Remove migration loading code that reads `migration/` directories
- Line 217: Remove `OPENCODE_MIGRATIONS: JSON.stringify(migrations)` from defines

**File:** `packages/opencode/script/build-node.ts`
- Same as above (lines 16-44, 54)

### 6. Remove drizzle configs

**Delete:**
- `packages/opencode/drizzle.config.ts`
- `packages/opencode/drizzle-project.config.ts`

### 7. Remove check-migrations script

**Delete:** `packages/opencode/script/check-migrations.ts`

### 8. Update _build.ps1

**File:** `_build.ps1` lines 186-191
- Remove the migration copy block:
```powershell
# Remove this:
$migrationDir = Join-Path $OpencodePkg "migration"
if (Test-Path $migrationDir) {
    Copy-Item -Recurse $migrationDir (Join-Path $DistDir "migration")
    Write-Success "Migrations copied"
}
```

### 9. Remove/update migration-related tests

**Delete entire files:**
- `packages/opencode/test/storage/fts-verify.test.ts` — tests FTS migration SQL from file
- `packages/opencode/test/project/migrate-global.test.ts` — tests global-to-project migration

**Update test name only:**
- `packages/opencode/test/storage/db.test.ts` line 21 — rename test from `"...without migration marker"` to `"...with project database"`

### 10. Files intentionally NOT changed

- `tui-migrate.ts` — TUI config migration (unrelated, moves keys between json files)
- Desktop electron `migrate.ts` — Tauri-to-electron data migration (unrelated)
- Desktop i18n — loading screen text for DB migration (cosmetic, will show correctly when DB is created)
- Console drizzle config — separate project, MySQL
- Cosmetic keyword references (`semantic-vector.ts`, `message-v2.ts`, prompt examples)

## Verification

1. `bun typecheck` in `packages/opencode`
2. Build with `pwsh _build.ps1` — should not copy migration directory
3. Clean first launch test — DB created with all tables and FTS inline
4. Run affected tests
