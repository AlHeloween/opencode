import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { LocalContext } from "@/util/local-context"
import { lazy } from "../util/lazy"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { InstanceState } from "@/effect/instance-state"
import { iife } from "@/util/iife"
import { init } from "#db"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export function getChannelPath() {
  if (["latest", "beta", "prod"].includes(InstallationChannel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
    return path.join(Global.Path.data, "opencode.db")
  const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `opencode-${safe}.db`)
}

export const Path = iife(() => {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return path.join(Global.Path.data, Flag.OPENCODE_DB)
  }
  return getChannelPath()
})

export type Transaction = SQLiteTransaction<"sync", void>

type Client = SQLiteBunDatabase

type Journal = { sql: string; timestamp: number; name: string }[]

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function migrations(dir: string): Journal {
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const sql = dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter(Boolean) as Journal

  return sql.sort((a, b) => a.timestamp - b.timestamp)
}

export const Client = lazy(() => {
  log.info("opening database", { path: Path })

  const db = init(Path)

  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA wal_checkpoint(PASSIVE)")

  // Apply schema migrations
  const entries =
    typeof OPENCODE_MIGRATIONS !== "undefined"
      ? OPENCODE_MIGRATIONS
      : migrations(path.join(import.meta.dirname, "../../migration"))
  if (entries.length > 0) {
    log.info("applying migrations", {
      count: entries.length,
      mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
    })
    if (Flag.OPENCODE_SKIP_MIGRATIONS) {
      for (const item of entries) {
        item.sql = "select 1;"
      }
    }
    migrate(db, entries)
  }

  verifyFTS(db)
  maintainOnStartup(db)

  return db
})

export function close() {
  Client().$client.close()
  Client.reset()
}

const FTS_BACKFILL_SQL = `
  INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
  SELECT
    id,
    session_id,
    message_id,
    json_extract(data, '$.type'),
    COALESCE(
      json_extract(data, '$.text'),
      json_extract(data, '$.state.output'),
      json_extract(data, '$.state.error'),
      json_extract(data, '$.filename'),
      ''
    ),
    COALESCE(json_extract(data, '$.semantic_vector'), ''),
    COALESCE(json_extract(data, '$.dominant_topic'), ''),
    COALESCE(json_extract(data, '$.exact_coef'), 0),
    COALESCE(json_extract(data, '$.inferred_coef'), 0),
    COALESCE(json_extract(data, '$.hypothetical_coef'), 0),
    COALESCE(json_extract(data, '$.guess_coef'), 0),
    COALESCE(json_extract(data, '$.unknown_coef'), 0)
  FROM part`

function verifyFTS(db: SQLiteBunDatabase) {
  const hasFts = db.all("SELECT 1 FROM sqlite_master WHERE type='table' AND name='part_fts'")
  if (!hasFts.length) return

  const schema = db.all<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='part_fts'")
  const hasSemanticColumns = schema.length > 0 && schema[0].sql.includes("semantic_vector")

  if (!hasSemanticColumns) {
    log.info("rebuilding FTS index with semantic columns")
    const migrationDir = path.join(import.meta.dirname, "../../migration/20260414120000_semantic_vector")
    if (existsSync(migrationDir)) {
      const sql = readFileSync(path.join(migrationDir, "migration.sql"), "utf-8")
      ;(db as SQLiteBunDatabase & { $client: { exec: (sql: string) => void } }).$client.exec(sql)
    }
    const partCount = db.all<{ c: number }>("SELECT count(*) as c FROM part")[0]
    if (partCount.c > 0) {
      try {
        db.run(FTS_BACKFILL_SQL)
      } catch (e) {
        log.error("failed to backfill FTS index after rebuild", { error: String(e) })
      }
    }
    return
  }

  const triggers = db.all("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'part_fts_%'")
  const ftsCount = db.all<{ c: number }>("SELECT count(*) as c FROM part_fts")[0]
  const partCount = db.all<{ c: number }>("SELECT count(*) as c FROM part")[0]
  const needsTriggers = triggers.length < 3
  const needsBackfill = ftsCount.c === 0 && partCount.c > 0

  if (!needsTriggers && !needsBackfill) return

  log.info("healing FTS index", {
    triggers: needsTriggers,
    backfill: needsBackfill,
    ftsRows: ftsCount.c,
    partRows: partCount.c,
  })

  if (needsTriggers) {
    const migrationDir = path.join(import.meta.dirname, "../../migration/20260414120000_semantic_vector")
    if (existsSync(migrationDir)) {
      const sql = readFileSync(path.join(migrationDir, "migration.sql"), "utf-8")
      ;(db as SQLiteBunDatabase & { $client: { exec: (sql: string) => void } }).$client.exec(sql)
    }
  }

  if (needsBackfill) {
    try {
      db.run(FTS_BACKFILL_SQL)
    } catch (e) {
      log.error("failed to backfill FTS index", { error: String(e) })
    }
  }
}

export function rebuildFTS() {
  const db = Client() as SQLiteBunDatabase & { $client: { exec: (sql: string) => void } }
  const migrationDir = path.join(import.meta.dirname, "../../migration/20260414120000_semantic_vector")
  if (!existsSync(migrationDir)) {
    log.error("semantic vector migration not found")
    return false
  }
  const sql = readFileSync(path.join(migrationDir, "migration.sql"), "utf-8")
  db.$client.exec(sql)
  const partCount = db.all<{ c: number }>("SELECT count(*) as c FROM part")[0]
  if (partCount.c > 0) {
    db.run(FTS_BACKFILL_SQL)
  }
  log.info("FTS index rebuilt")
  return true
}

function maintainOnStartup(db: SQLiteBunDatabase) {
  const pageResult = db.all<{ page_size: number }>("PRAGMA page_size")
  const countResult = db.all<{ page_count: number }>("PRAGMA page_count")
  const freeResult = db.all<{ freelist_count: number }>("PRAGMA freelist_count")
  const pageSize = Number(pageResult[0]?.page_size || 0)
  const pageCount = Number(countResult[0]?.page_count || 0)
  const freelistCount = Number(freeResult[0]?.freelist_count || 0)
  const freeRatio = pageCount > 0 ? freelistCount / pageCount : 0

  ;(db as SQLiteBunDatabase & { $client: { exec: (sql: string) => void } }).$client.exec("PRAGMA mmap_size = 1073741824")
  ;(db as SQLiteBunDatabase & { $client: { exec: (sql: string) => void } }).$client.exec("PRAGMA wal_autocheckpoint = 1000")
  ;(db as SQLiteBunDatabase & { $client: { exec: (sql: string) => void } }).$client.exec("PRAGMA temp_store = MEMORY")
  ;(db as SQLiteBunDatabase & { $client: { exec: (sql: string) => void } }).$client.exec("PRAGMA wal_checkpoint(PASSIVE)")

  const tables = ["message", "part", "session", "todo", "permission", "project", "session_share"]
  for (const t of tables) {
    try {
      db.run(`ANALYZE "${t}"`)
    } catch {
      // table may not exist
    }
  }

  ;(db as SQLiteBunDatabase & { $client: { exec: (sql: string) => void } }).$client.exec("PRAGMA optimize")

  if (freeRatio > 0.1) {
    log.info("database fragmentation detected", {
      pageSize,
      pageCount,
      freelistCount,
      freeRatio: Math.round(freeRatio * 100) / 100,
    })
    try {
      ;(db as SQLiteBunDatabase & { $client: { exec: (sql: string) => void } }).$client.exec("VACUUM")
      log.info("database vacuum completed")
    } catch (e) {
      log.warn("database vacuum failed", { error: String(e) })
    }
  }
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => any | Promise<any>) {
  const bound = InstanceState.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

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
      const effects: (() => void | Promise<void>)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
      const result = Client().transaction(txCallback, { behavior: options?.behavior })
      for (const effect of effects) effect()
      return result as NotPromise<T>
    }
    throw err
  }
}

export * as Database from "./db"
