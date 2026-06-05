import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { LocalContext } from "@/util/local-context"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { existsSync, mkdirSync } from "fs"
import { InstanceState } from "@/effect/instance-state"
import { init } from "#db"
import type { ProjectID } from "../project/schema"
import { DatabaseMigration } from "./migration"

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

/** Path to the config-level database (executable-adjacent). Used for account/auth state. */
export function getConfigDbPath(): string {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
  }
  if (Global.Path.config) return path.join(Global.Path.config, "account.db")
  return ":memory:"
}

/** Cached config DB client (singleton). */
let configDb: DrizzleClient | undefined

function getOrCreateConfigDb(): DrizzleClient {
  if (configDb) return configDb
  const dbPath = getConfigDbPath()
  const dir = path.dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  configDb = createAndInitDb(dbPath)
  return configDb
}

/** Execute a callback using the config-level database (for account/auth state). */
export function configUse<T>(callback: (db: TxOrDb) => T): T {
  return callback(getOrCreateConfigDb())
}

/** Execute a transaction on the config-level database. */
export function configTransaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: { behavior?: "deferred" | "immediate" | "exclusive" },
): NotPromise<T> {
  const db = getOrCreateConfigDb()
  const effects: (() => void)[] = []
  const txCallback = InstanceState.bind((tx: TxOrDb) => {
    const result = ctx.provide({ tx, effects }, () => callback(tx))
    for (const effect of effects) effect()
    return result
  })
  return withBusyRetry(() => db.transaction(txCallback, { behavior: options?.behavior }) as NotPromise<T>)
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
  try {
    db.$client.exec(FTS_SCHEMA_SQL)
  } catch (e) {
    log.warn("FTS index creation failed (non-fatal)", { error: String(e) })
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

CREATE TABLE IF NOT EXISTS "account" (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  url text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry integer,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "account_state" (
  id integer PRIMARY KEY,
  active_account_id text,
  active_org_id text
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

const FTS_SCHEMA_SQL = `
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

const fallbackProjectCtx = {
  value: undefined as { projectID: ProjectID; worktree: string } | undefined,
}

export function setProjectContext(projectID: ProjectID, worktree: string): void {
  fallbackProjectCtx.value = { projectID, worktree }
}

export function clearProjectContext(): void {
  fallbackProjectCtx.value = undefined
}

export function withProject<T>(projectID: ProjectID, worktree: string, callback: () => T): T {
  return currentProjectCtx.provide({ projectID, worktree }, callback)
}

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      try {
        const proj = currentProjectCtx.use()
        const db = getProjectDb(proj.projectID, proj.worktree)
        const effects: (() => void)[] = []
        const result = ctx.provide({ effects, tx: db }, () => callback(db))
        for (const effect of effects) effect()
        return result
      } catch (err2) {
        if (!(err2 instanceof LocalContext.NotFound)) throw err2
      }
      // Fallback: use module-level project context set by middleware
      if (fallbackProjectCtx.value) {
        const db = getProjectDb(fallbackProjectCtx.value.projectID, fallbackProjectCtx.value.worktree)
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
      const proj = currentProjectCtx.use()
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

export * as Database from "./db"

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\opencode\\packages/opencode/src/storage/db.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\opencode\\packages/opencode/src/storage/db.ts.backup_20260517T185131_917545"
//   "created_at": "2026-05-17T10:51:31.934235+00:00"
//   "backup_hash": "0fefbab3ec70aacddd49bd4456f0990a"
//   "new_hash": "c62314fa99eb7e1e8f874b31c0a22182"
//   "goal_id": "reset_default_db_path_on_close"
//   "semantics": "Use closeDefaultDb from Database.close so the cached default database path is reset together with the handle."
//   "update_attrs": {"relative_path": "packages/opencode/src/storage/db.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "export function close() {\n  closeAllProjectDbs()\n  if (defaultDb) {\n    try { defaultDb.$client.close() } catch (err) {\n      log.warn(\"failed to close default DB client\", { error: err })\n    }\n    defaultDb = undefined\n  }\n}", "replace_present": true}
//   "restore_cmd": "python -m adm --rollback \"D:\\zPython\\opencode\\packages/opencode/src/storage/db.ts\""
// }
