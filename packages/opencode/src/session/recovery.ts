import { Instance } from "@/project/instance"
import { normalizeWorktreePath, remapWorktreePath } from "@/project/project"
import { Database } from "@/storage/db"
import { EventTable } from "@/sync/event.sql"
import { SyncEvent, type SerializedEvent } from "@/sync"
import * as Log from "@opencode-ai/core/util/log"
import { asc, desc, eq, isNull } from "drizzle-orm"
import { Schema } from "effect"
import { existsSync } from "fs"
import { init } from "#db"
import { SessionTable } from "./session.sql"
import { SessionID } from "./schema"

const log = Log.create({ service: "session.recovery" })

export const PreviewInput = Schema.Struct({
  source: Schema.String,
}).annotate({ identifier: "SessionRecoveryPreviewInput" })

export const Candidate = Schema.Struct({
  id: SessionID,
  title: Schema.String,
  source: Schema.String,
  sourceDirectory: Schema.String,
  destinationDirectory: Schema.String,
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
}).annotate({ identifier: "SessionRecoveryCandidate" })

export const ImportInput = Schema.Struct({
  source: Schema.String,
  sessionID: SessionID,
}).annotate({ identifier: "SessionRecoveryImportInput" })

export type Candidate = Schema.Schema.Type<typeof Candidate>

function sourceRoot(input: string) {
  const result = normalizeWorktreePath(input)
  if (!result) throw new Error("Recovery source path is required")
  const database = Database.getProjectDbPath(result)
  if (!existsSync(database)) throw new Error(`No OpenCode database found in ${result}`)
  return { root: result, database }
}

function readSource<T>(source: string, read: (db: ReturnType<typeof init>) => T): T {
  const target = sourceRoot(source)
  const db = init(target.database)
  try {
    const tables = (db.$client as { prepare: (sql: string) => { all: () => Array<{ name: string }> } })
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session', 'event')")
      .all()
    if (tables.length !== 2) throw new Error(`Database in ${target.root} is not a recoverable OpenCode database`)
    return read(db)
  } finally {
    try {
      ;(db.$client as { close: () => void }).close()
    } catch (error) {
      log.debug("recovery source database close failed", { source: target.root, error: String(error) })
    }
  }
}

function rebase(value: unknown, source: string, destination: string, projectID: string): unknown {
  if (Array.isArray(value)) return value.map((item) => rebase(item, source, destination, projectID))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key === "projectID" && typeof item === "string") return [key, projectID]
      if (key === "directory" && typeof item === "string") return [key, remapWorktreePath(item, source, destination)]
      return [key, rebase(item, source, destination, projectID)]
    }),
  )
}

function events(source: string, sessionID: string) {
  return readSource(source, (db) =>
    db
      .select({
        id: EventTable.id,
        aggregateID: EventTable.aggregate_id,
        seq: EventTable.seq,
        type: EventTable.type,
        data: EventTable.data,
      })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all(),
  )
}

export function preview(input: Schema.Schema.Type<typeof PreviewInput>): Candidate[] {
  const source = sourceRoot(input.source).root
  const destination = normalizeWorktreePath(Instance.directory)
  return readSource(source, (db) =>
    db
      .select({
        id: SessionTable.id,
        title: SessionTable.title,
        directory: SessionTable.directory,
        created: SessionTable.time_created,
        updated: SessionTable.time_updated,
      })
      .from(SessionTable)
      .where(isNull(SessionTable.parent_id))
      .orderBy(desc(SessionTable.time_updated))
      .all()
      .map((row) => ({
        id: row.id,
        title: row.title,
        source,
        sourceDirectory: row.directory,
        destinationDirectory: destination,
        time: { created: row.created, updated: row.updated },
      })),
  )
}

export function restore(input: Schema.Schema.Type<typeof ImportInput>): Candidate {
  const source = sourceRoot(input.source).root
  const candidate = preview({ source }).find((item) => item.id === input.sessionID)
  if (!candidate) throw new Error(`Session ${input.sessionID} was not found in ${source}`)

  const exists = Database.use((db) => db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get())
  if (exists) throw new Error(`Session ${input.sessionID} already exists in the current project`)

  const stream = events(source, input.sessionID)
  if (stream.length === 0) throw new Error(`Session ${input.sessionID} has no replayable events`)
  if (!stream[0].type.startsWith("session.created.")) {
    throw new Error(`Session ${input.sessionID} event stream starts with ${stream[0].type}, not session.created`)
  }

  const destination = candidate.destinationDirectory
  const offset = stream[0].seq
  const replay = stream.map((event) => ({
    ...event,
    // A portable source may start its event stream at 1; the target is empty
    // and its event sequence must start at 0 for SyncEvent.replayAll().
    seq: event.seq - offset,
    data: rebase(event.data, source, destination, Instance.project.id),
  })) as SerializedEvent[]
  SyncEvent.replayAll(replay)
  log.info("recovered session into current project", {
    sessionID: input.sessionID,
    source,
    destination,
    events: replay.length,
  })
  return candidate
}
