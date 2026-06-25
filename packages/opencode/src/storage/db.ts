import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { LocalContext } from "@/util/local-context"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { existsSync, mkdirSync } from "fs"
import { InstanceState } from "@/effect/instance-state"
import { init } from "#db"
import type { ProjectID } from "../project/schema"
import { DatabaseMigration } from "./migration"
import { Fiber, Context } from "effect"
import { InstanceRef } from "@/effect/instance-ref"

const log = Log.create({ service: "db" })

/** Unified client cache keyed by DB file path (dbPath).
  * dbPath is always {worktree}/.opencode/data/opencode.db — one connection per project.
  * All callers share one connection per file — no dual-connection collision. */
const pathClientCache = new Map<string, DrizzleClient>()

/** Get or create a client for the given dbPath. All callers share one connection per file. */
function getOrCreateDb(dbPath: string): DrizzleClient {
  const cached = pathClientCache.get(dbPath)
  if (cached) return cached
  const db = createAndInitDb(dbPath)
  pathClientCache.set(dbPath, db)
  return db
}

export type Transaction = SQLiteTransaction<"sync", void>

type Client = SQLiteBunDatabase & { $client: { close: () => void; exec: (sql: string) => void; prepare: (sql: string) => { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[]; run: (...args: unknown[]) => void } } }

type DrizzleClient = ReturnType<typeof init> & { $client: { close: () => void; exec: (sql: string) => void; prepare: (sql: string) => { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[]; run: (...args: unknown[]) => void } } }

export function getProjectDbPath(worktree: string) {
  return path.join(worktree, ".opencode", "data", "opencode.db")
}

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

  try {
    DatabaseMigration.apply(db as DatabaseMigration.DbClient)
  } catch (e) {
    log.warn("migration runner failed (non-fatal)", { error: String(e) })
  }

  try {
    db.$client.exec(CORE_SCHEMA_SQL)
  } catch (e) {
    log.error("core schema failed", { error: String(e) })
    throw e
  }
  return db
}

const CORE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "project" (
  id text PRIMARY KEY NOT NULL,
  worktree text NOT NULL,
  vcs text,
  name text,
  icon_url text,
  icon_url_override text,
  icon_color text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_initialized integer,
  sandboxes text NOT NULL DEFAULT '[]',
  commands text DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY NOT NULL,
  project_id text NOT NULL,
  workspace_id text,
  parent_id text,
  slug text NOT NULL,
  directory text NOT NULL,
  title text NOT NULL,
  version text NOT NULL,
  share_url text,
  summary_additions integer,
  summary_deletions integer,
  summary_files integer,
  summary_diffs text,
  revert text,
  permission text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_compacting integer,
  time_archived integer,
  cost integer NOT NULL DEFAULT 0,
  tokens_input integer NOT NULL DEFAULT 0,
  tokens_output integer NOT NULL DEFAULT 0,
  tokens_reasoning integer NOT NULL DEFAULT 0,
  tokens_cache_read integer NOT NULL DEFAULT 0,
  tokens_cache_write integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "session_project_idx" ON "session" ("project_id");
CREATE INDEX IF NOT EXISTS "session_workspace_idx" ON "session" ("workspace_id");
CREATE INDEX IF NOT EXISTS "session_parent_idx" ON "session" ("parent_id");

CREATE TABLE IF NOT EXISTS "message" (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
CREATE INDEX IF NOT EXISTS "message_session_time_created_id_idx" ON "message" ("session_id", "time_created", "id");

CREATE TABLE IF NOT EXISTS "part" (
  id text PRIMARY KEY NOT NULL,
  message_id text NOT NULL,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
CREATE INDEX IF NOT EXISTS "part_message_id_id_idx" ON "part" ("message_id", "id");
CREATE INDEX IF NOT EXISTS "part_session_idx" ON "part" ("session_id");

CREATE TABLE IF NOT EXISTS "todo" (
  session_id text NOT NULL,
  content text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  position integer NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  PRIMARY KEY ("session_id", "position")
);
CREATE INDEX IF NOT EXISTS "todo_session_idx" ON "todo" ("session_id");

CREATE TABLE IF NOT EXISTS "session_entry" (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  type text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
CREATE INDEX IF NOT EXISTS "session_entry_session_idx" ON "session_entry" ("session_id");
CREATE INDEX IF NOT EXISTS "session_entry_session_type_idx" ON "session_entry" ("session_id", "type");
CREATE INDEX IF NOT EXISTS "session_entry_time_created_idx" ON "session_entry" ("time_created");

CREATE TABLE IF NOT EXISTS "permission" (
  project_id text PRIMARY KEY NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);

CREATE TABLE IF NOT EXISTS "session_share" (
  session_id text PRIMARY KEY NOT NULL,
  id text NOT NULL,
  secret text NOT NULL,
  url text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "workspace" (
  id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  name text NOT NULL DEFAULT '',
  branch text,
  directory text,
  extra text,
  project_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS "event_sequence" (
  aggregate_id text PRIMARY KEY NOT NULL,
  seq integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "event" (
  id text PRIMARY KEY NOT NULL,
  aggregate_id text NOT NULL,
  seq integer NOT NULL,
  type text NOT NULL,
  data text NOT NULL
);

CREATE TABLE IF NOT EXISTS "part_embedding" (
  id text PRIMARY KEY NOT NULL,
  part_id text NOT NULL REFERENCES part(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  message_id text NOT NULL,
  embedding_type text NOT NULL,
  embedding text NOT NULL,
  position_in_document integer NOT NULL,
  content_length integer NOT NULL,
  model_id text NOT NULL,
  model_dim integer NOT NULL,
  provider_priority integer NOT NULL DEFAULT 1,
  time_created integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "part_embedding_part_idx" ON "part_embedding" ("part_id");
CREATE INDEX IF NOT EXISTS "part_embedding_session_idx" ON "part_embedding" ("session_id");
CREATE INDEX IF NOT EXISTS "part_embedding_type_idx" ON "part_embedding" ("embedding_type");
CREATE INDEX IF NOT EXISTS "part_embedding_model_idx" ON "part_embedding" ("model_id");

CREATE TABLE IF NOT EXISTS "balance_snapshot" (
  id text PRIMARY KEY NOT NULL,
  provider_id text NOT NULL,
  currency text NOT NULL,
  total_balance text NOT NULL,
  granted_balance text NOT NULL,
  topped_up_balance text NOT NULL,
  is_available integer NOT NULL,
  session_id text,
  message_id text,
  calculated_cost_since_last real,
  actual_balance_delta real,
  cost_validation_delta real,
  raw_response text,
  time_created integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "balance_snapshot_provider_time_idx" ON "balance_snapshot" ("provider_id", "time_created");
`

export function getProjectDb(projectID: ProjectID, worktree: string): DrizzleClient {
  const dbPath = getProjectDbPath(worktree)
  log.info("opening project database", { projectID, path: dbPath })
  return getOrCreateDb(dbPath)
}

export function closeProjectDb(projectID: ProjectID) {
  // Individual close is no longer tracked separately; close() handles all.
  // Keep this method for API compatibility but it's now a no-op
  // since the unified cache is shared by dbPath, not projectID.
}

export function close() {
  for (const [dbPath, db] of pathClientCache) {
    try {
      db.$client.close()
    } catch (err) {
      log.warn("failed to close DB client", { dbPath, error: err })
    }
  }
  pathClientCache.clear()
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void)[],
}>("database")

const currentProjectCtx = LocalContext.create<{
  projectID: ProjectID
  worktree: string
}>("database.project")

export function withProject<T>(projectID: ProjectID, worktree: string, callback: () => T): T {
  return currentProjectCtx.provide({ projectID, worktree }, callback)
}

function tryResolveProjectCtx(): { projectID: ProjectID; worktree: string } | undefined {
  try {
    return currentProjectCtx.use()
  } catch (err) {
    if (!(err instanceof LocalContext.NotFound)) throw err
  }
  const fiber = Fiber.getCurrent()
  if (fiber) {
    const ref = Context.getReferenceUnsafe(fiber.context, InstanceRef)
    if (ref && ref.project && ref.worktree) {
      return { projectID: ref.project.id, worktree: ref.worktree }
    }
  }
  return undefined
}

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const proj = tryResolveProjectCtx()
      if (proj) {
        const db = getProjectDb(proj.projectID, proj.worktree)
        const effects: (() => void)[] = []
        const result = ctx.provide({ effects, tx: db }, () => callback(db))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
    throw err
  }
}

export function projectUse<T>(projectID: ProjectID, worktree: string, callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const db = getProjectDb(projectID, worktree)
      const effects: (() => void)[] = []
      const result = ctx.provide({ effects, tx: db }, () => callback(db))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => void) {
  const bound = InstanceState.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch (err) {
    if (!(err instanceof LocalContext.NotFound)) throw err
    log.debug("no db context, executing effect immediately")
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

/** Check if an error is SQLITE_BUSY (errno 5) — lock contention after busy_timeout expires. */
function isBusy(err: unknown): boolean {
  if (err instanceof Error && "errno" in err) {
    return (err as Error & { errno: number }).errno === 5
  }
  return false
}

/** Retry a callback on SQLITE_BUSY with backoff. Max 3 retries over ~7 seconds. */
function withBusyRetry<T>(fn: () => T): T {
  const delays = [200, 500, 1000, 2000, 4000]
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return fn()
    } catch (err) {
      if (!isBusy(err) || attempt === delays.length) throw err
      log.debug("db busy, retrying", { attempt: attempt + 1, delayMs: delays[attempt] })
      Bun.sleepSync(delays[attempt])
    }
  }
  throw new Error("unreachable")
}

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const proj = tryResolveProjectCtx()
      if (!proj) throw err
      const db = getProjectDb(proj.projectID, proj.worktree)
      const effects: (() => void)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => {
        const result = ctx.provide({ tx, effects }, () => callback(tx))
        for (const effect of effects) effect()
        return result
      })
      return withBusyRetry(() => db.transaction(txCallback, { behavior: options?.behavior }) as NotPromise<T>)
    }
    throw err
  }
}

export function projectTransaction<T>(
  projectID: ProjectID,
  worktree: string,
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const db = getProjectDb(projectID, worktree)
      const effects: (() => void)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => {
        const result = ctx.provide({ tx, effects }, () => callback(tx))
        for (const effect of effects) effect()
        return result
      })
      return withBusyRetry(() => db.transaction(txCallback, { behavior: options?.behavior }) as NotPromise<T>)
    }
    throw err
  }
}

/** Reclaim WAL file space by checkpointing all frames into the main database
  * and truncating the WAL file to zero bytes.
  * Safe to call at any time — blocks until the write lock is acquired. */
export function walCheckpointTruncate(db: DrizzleClient): void {
  db.run("PRAGMA wal_checkpoint(TRUNCATE)")
}

/** Rebuild the entire database file to reclaim disk space from deleted rows.
  * Requires exclusive database access — blocks until all other connections release their locks.
  * After heavy session deletion, this can significantly reduce the database file size. */
export function vacuum(db: DrizzleClient): void {
  db.run("VACUUM")
}

export * as Database from "./db"

