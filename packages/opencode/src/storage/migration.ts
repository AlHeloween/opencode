export * as DatabaseMigration from "./migration"

import type { SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrations } from "./migration.gen"

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
    (sqlite.prepare(`SELECT id FROM migration`).all() as Array<{ id: string }>).map((row) => row.id),
  )

  // Backfill: if no migrations tracked but tables exist, seed baseline
  if (completed.size === 0) {
    const hasTables = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project'`,
    ).get() as { name: string } | undefined
    if (hasTables) {
      sqlite.prepare(
        `INSERT OR IGNORE INTO migration (id, time_completed) VALUES (?, ?)`,
      ).run("20260601000000_baseline_local_development", now)
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
        sqlite.prepare(`INSERT INTO migration (id, time_completed) VALUES (?, ?)`).run(migration.id, now)
        sqlite.exec(`COMMIT`)
      } catch (e) {
        sqlite.exec(`ROLLBACK`)
        throw e
      }
    } else {
      sqlite.prepare(`INSERT INTO migration (id, time_completed) VALUES (?, ?)`).run(migration.id, now)
    }
  }
}
