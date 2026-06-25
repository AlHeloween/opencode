export * as DatabaseMigration from "./migration"

import type { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { migrations } from "./migration.gen"

const MigrationTable = sqliteTable("migration", {
  id: text().primaryKey(),
  time_completed: integer().notNull(),
})

/**
 * Minimal interface for the database client — matches the shape of
 * `DrizzleClient` in db.ts but avoids a circular import.
 */
export interface DbClient extends SQLiteBunDatabase {
  $client: {
    close: () => void
    exec: (sql: string) => void
    prepare: (sql: string) => {
      run: (...args: unknown[]) => void
      get: (...args: unknown[]) => unknown
      all: (...args: unknown[]) => unknown[]
    }
  }
}

export interface Migration {
  id: string
  up: (db: DbClient) => void
}

export function apply(db: DbClient): void {
  applyOnly(db, migrations)
}

export function applyOnly(db: DbClient, input: Migration[]): void {
  const sqlite = db.$client
  const now = Date.now()

  // Create migration tracking table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS migration (
      id TEXT PRIMARY KEY,
      time_completed INTEGER NOT NULL
    )
  `)

  // Load completed migrations
  const completed = new Set(
    db.select({ id: MigrationTable.id }).from(MigrationTable).all().map((row) => row.id),
  )

  // Backfill: if no migrations tracked but tables exist, seed baseline
  if (completed.size === 0) {
    const hasTables = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project'`,
    ).get() as { name: string } | undefined
    if (hasTables) {
      db.insert(MigrationTable)
        .values({ id: "20260601000000_baseline_local_development", time_completed: now })
        .onConflictDoNothing()
        .run()
      completed.add("20260601000000_baseline_local_development")
    }
  }

  // Apply pending migrations
  for (const migration of input) {
    if (completed.has(migration.id)) continue
    if (!process.env.OPENCODE_SKIP_MIGRATIONS) {
      sqlite.exec(`BEGIN`)
      try {
        migration.up(db)
        db.insert(MigrationTable).values({ id: migration.id, time_completed: now }).run()
        sqlite.exec(`COMMIT`)
      } catch (e) {
        sqlite.exec(`ROLLBACK`)
        throw e
      }
    } else {
      db.insert(MigrationTable).values({ id: migration.id, time_completed: now }).run()
    }
  }
}
