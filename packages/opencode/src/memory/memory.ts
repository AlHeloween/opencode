import { Database as BunDatabase } from "bun:sqlite"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { classifyText } from "../session/semantic-vector"
import { DOMINANT_MARKER } from "./spine"
import path from "path"
import { existsSync, mkdirSync } from "fs"

const log = Log.create({ service: "memory" })

/** Memory database path — separate from the main project DB. */
function memoryDbPath(worktree: string): string {
  return path.join(Global.Path.data, "memory", "memory.db")
}

/** Open (or create) the memory database for a project. */
function openMemoryDb(worktree: string): BunDatabase {
  const dbPath = memoryDbPath(worktree)
  const dir = path.dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const db = new BunDatabase(dbPath, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA busy_timeout = 5000")

  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS part_index (
      rowid           INTEGER PRIMARY KEY,
      part_id         TEXT UNIQUE NOT NULL,
      message_id      TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      message_index   INTEGER NOT NULL,
      time_created    INTEGER NOT NULL,
      text            TEXT NOT NULL DEFAULT '',
      part_type       TEXT NOT NULL DEFAULT '',
      role            TEXT NOT NULL DEFAULT '',
      exact_coef      REAL NOT NULL DEFAULT 0,
      inferred_coef   REAL NOT NULL DEFAULT 0,
      hypothetical_coef REAL NOT NULL DEFAULT 0,
      guess_coef      REAL NOT NULL DEFAULT 0,
      unknown_coef    REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_memory_session_time
      ON part_index(session_id, time_created);

    CREATE INDEX IF NOT EXISTS idx_memory_time
      ON part_index(time_created DESC);

    CREATE INDEX IF NOT EXISTS idx_memory_session_msg
      ON part_index(session_id, message_index);

    CREATE TABLE IF NOT EXISTS index_watermark (
      id       INTEGER PRIMARY KEY CHECK(id = 1),
      last_rowid INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO index_watermark(id, last_rowid) VALUES(1, 0);
  `)

  return db
}

/**
 * Ensure the FTS5 virtual table exists.
 * Must be called after the table is created (FTS5 depends on part_index existing).
 */
function ensureFts5(db: BunDatabase): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS part_fts USING fts5(
      text,
      part_type UNINDEXED,
      content='part_index',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
  `)
}

/** Sync new parts from the main project DB into memory.db. */
export function sync(worktree: string, projectDbPath: string): void {
  const memDb = openMemoryDb(worktree)
  ensureFts5(memDb)

  const getRow = memDb.prepare("SELECT last_rowid FROM index_watermark WHERE id = 1").get() as { last_rowid: number } | undefined
  const watermark = getRow?.last_rowid ?? 0

  // Check if there's new data
  const projectDb = new BunDatabase(projectDbPath, { readonly: true })
  const countRow = projectDb.prepare(
    "SELECT COUNT(*) AS cnt FROM part WHERE rowid > ?",
  ).get(watermark) as { cnt: number } | undefined
  const newCount = countRow?.cnt ?? 0
  if (newCount === 0) {
    projectDb.close()
    memDb.close()
    return
  }

  log.info("syncing parts to memory db", { watermark, newCount })

  // Query new parts from project DB
  const projectParts = projectDb.prepare(`
    SELECT
      p.rowid,
      p.id AS part_id,
      p.message_id,
      p.session_id,
      p.time_created,
      p.data,
      (SELECT COUNT(*) + 1 FROM message m2
        WHERE m2.session_id = p.session_id AND m2.time_created < m.time_created
      ) AS message_index,
      (SELECT json_extract(m.data, '$.role') FROM message m WHERE m.id = p.message_id) AS role
    FROM part p
    JOIN message m ON m.id = p.message_id
    WHERE p.rowid > ?
    ORDER BY p.rowid ASC
  `).all(watermark) as Array<{
    rowid: number
    part_id: string
    message_id: string
    session_id: string
    time_created: number
    data: string
    message_index: number
    role: string | null
  }>

  projectDb.close()

  if (projectParts.length === 0) {
    memDb.close()
    return
  }

  // Insert into memory DB in a transaction
  const insertIndex = memDb.prepare(`
    INSERT OR IGNORE INTO part_index(
      rowid, part_id, message_id, session_id, message_index, time_created,
      text, part_type, role,
      exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertFts = memDb.prepare(`
    INSERT INTO part_fts(rowid, text, part_type) VALUES (?, ?, ?)
  `)

  const updateWatermark = memDb.prepare(
    "UPDATE index_watermark SET last_rowid = ? WHERE id = 1",
  )

  let maxRowid = watermark

  const insertBatch = memDb.transaction(() => {
    for (const part of projectParts) {
      let data: any
      try {
        data = JSON.parse(part.data)
      } catch {
        continue
      }

      const partType: string = data.type ?? ""
      const text: string = data.text ?? data.state?.output ?? data.state?.error ?? data.filename ?? ""
      if (!text) continue

      // Compute epistemic coefficients for memory DB
      const sv = classifyText(text)
      const exactCoef = data.exact_coef ?? sv.exactCoef
      const inferredCoef = data.inferred_coef ?? sv.inferredCoef
      const hypotheticalCoef = data.hypothetical_coef ?? sv.hypotheticalCoef
      const guessCoef = data.guess_coef ?? sv.guessCoef
      const unknownCoef = data.unknown_coef ?? sv.unknownCoef

      insertIndex.run(
        part.rowid, part.part_id, part.message_id, part.session_id,
        part.message_index, part.time_created,
        text, partType, part.role ?? "",
        exactCoef, inferredCoef, hypotheticalCoef, guessCoef, unknownCoef,
      )

      insertFts.run(part.rowid, text, partType)

      if (part.rowid > maxRowid) maxRowid = part.rowid
    }

    updateWatermark.run(maxRowid)
  })

  insertBatch()
  memDb.close()
}

export interface MemorySearchResult {
  partID: string
  messageID: string
  sessionID: string
  messageIndex: number
  timeCreated: number
  text: string
  partType: string
  role: string
  rank: number
  bm25Score: number
  epistemicScore: number
}

/**
 * FTS5 reads the MATCH argument as an EXPRESSION, not as words: `-` is an operator and
 * `col:term` is a column filter. Our own vocabulary is full of hyphens (`re-base`, `Layer-1`,
 * `deliver-once`), so a raw query dies with `no such column: base` and the instrument looks
 * broken. Quote every whitespace-separated token, doubling embedded quotes, so each term is
 * matched literally and FTS5's implicit AND still joins them.
 */
export function toFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" ")
}

/**
 * Search memory.db with FTS5 + BM25 + epistemic hybrid ranking.
 * If BM25 is unavailable (e.g. FTS5 not yet populated), falls back to epistemic-only.
 */
export function search(params: {
  worktree: string
  query: string
  limit: number
  /** Restrict to one session. Omit to search every session in the project. */
  sessionID?: string
}): MemorySearchResult[] {
  const ftsQuery = toFtsQuery(params.query)
  if (ftsQuery.length === 0) return []

  const memDb = openMemoryDb(params.worktree)

  try {
    // First check if FTS5 has any rows
    const ftsCount = memDb.prepare("SELECT COUNT(*) AS cnt FROM part_fts").get() as { cnt: number } | undefined
    if (!ftsCount || ftsCount.cnt === 0) {
      // Empty FTS — try sync, then return empty
      memDb.close()
      return []
    }

    // FTS5 MATCH query with BM25 + epistemic hybrid ranking.
    // Epistemic coefficients are ordinal (sum=10, one-hot-ish per ClaimStatus).
    // Ordinal weights: Exact=4, Inferred=3, Hypothetical=2, Guess=1, Unknown=0.
    // Result in 0–10 range, weighted 0.7 BM25 + 0.3 epistemic.
    const rows = memDb.prepare(`
      SELECT
        p.part_id,
        p.message_id,
        p.session_id,
        p.message_index,
        p.time_created,
        p.text,
        p.part_type,
        p.role,
        COALESCE(bm25(part_fts, 0.0, 0.0), 0.0) * 0.7 +
        (p.exact_coef * 4.0 + p.inferred_coef * 3.0 +
         p.hypothetical_coef * 2.0 + p.guess_coef * 1.0) / 10.0 * 10.0 * 0.3
        AS combined_rank,
        COALESCE(bm25(part_fts, 0.0, 0.0), 0.0) AS bm25_score,
        (p.exact_coef * 4.0 + p.inferred_coef * 3.0 +
         p.hypothetical_coef * 2.0 + p.guess_coef * 1.0) / 10.0 * 10.0 AS epistemic_score
      FROM part_fts
      JOIN part_index p ON p.rowid = part_fts.rowid
      WHERE part_fts MATCH ?
        ${params.sessionID ? "AND p.session_id = ?" : ""}
      ORDER BY combined_rank DESC
      LIMIT ?
    `).all(
      ...(params.sessionID
        ? [ftsQuery, params.sessionID, params.limit]
        : [ftsQuery, params.limit]),
    ) as Array<{
      part_id: string
      message_id: string
      session_id: string
      message_index: number
      time_created: number
      text: string
      part_type: string
      role: string
      combined_rank: number
      bm25_score: number
      epistemic_score: number
    }>

    return rows.map((row) => ({
      partID: row.part_id,
      messageID: row.message_id,
      sessionID: row.session_id,
      messageIndex: row.message_index,
      timeCreated: row.time_created,
      text: row.text,
      partType: row.part_type,
      role: row.role,
      rank: Math.round(row.combined_rank * 100) / 100,
      bm25Score: Math.round(row.bm25_score * 100) / 100,
      epistemicScore: Math.round(row.epistemic_score * 100) / 100,
    }))
  } finally {
    memDb.close()
  }
}

/**
 * Browse all sessions — chronological user/assistant messages.
 * Returns raw data grouped by session (no ranking).
 */
export function browse(params: {
  worktree: string
  limit?: number
  modelContextLimit?: number
  /** Restrict to one session. Omit to browse every session in the project. */
  sessionID?: string
}): MemorySearchResult[] {
  const memDb = openMemoryDb(params.worktree)

  try {
    const rows = memDb.prepare(`
      SELECT
        part_id, message_id, session_id, message_index, time_created,
        text, part_type, role,
        0.0 AS combined_rank,
        0.0 AS bm25_score,
        0.0 AS epistemic_score
      FROM part_index
      WHERE role IN ('user', 'assistant')
        AND part_type IN ('text', 'reasoning')
        ${params.sessionID ? "AND session_id = ?" : ""}
      ORDER BY session_id, time_created ASC
    `).all(...(params.sessionID ? [params.sessionID] : [])) as Array<{
      part_id: string
      message_id: string
      session_id: string
      message_index: number
      time_created: number
      text: string
      part_type: string
      role: string
      combined_rank: number
      bm25_score: number
      epistemic_score: number
    }>

    return rows.map((row) => ({
      partID: row.part_id,
      messageID: row.message_id,
      sessionID: row.session_id,
      messageIndex: row.message_index,
      timeCreated: row.time_created,
      text: row.text,
      partType: row.part_type,
      role: row.role,
      rank: 0,
      bm25Score: 0,
      epistemicScore: 0,
    }))
  } finally {
    memDb.close()
  }
}

/**
 * Highlight query terms in text by wrapping them in ** **.
 */
export function highlightSnippet(text: string, query: string): string {
  const terms = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))

  let snippet = text.slice(0, 500)
  for (const term of terms) {
    const re = new RegExp(`(${term})`, "gi")
    snippet = snippet.replace(re, "**$1**")
  }
  return snippet
}

/**
 * Get the total number of indexed parts (for diagnostics).
 */
export function stats(worktree: string): { indexedParts: number; watermark: number; ftsRows: number } {
  const memDb = openMemoryDb(worktree)
  try {
    const partCount = memDb.prepare("SELECT COUNT(*) AS cnt FROM part_index").get() as { cnt: number } | undefined
    const wm = memDb.prepare("SELECT last_rowid FROM index_watermark WHERE id = 1").get() as { last_rowid: number } | undefined

    let ftsRows = 0
    try {
      const ftsCount = memDb.prepare("SELECT COUNT(*) AS cnt FROM part_fts").get() as { cnt: number } | undefined
      ftsRows = ftsCount?.cnt ?? 0
    } catch {
      // FTS5 table may not exist yet
    }

    return {
      indexedParts: partCount?.cnt ?? 0,
      watermark: wm?.last_rowid ?? 0,
      ftsRows,
    }
  } finally {
    memDb.close()
  }
}

export interface MemoryDominant {
  partID: string
  messageID: string
  messageIndex: number
  role: string
  partType: string
  text: string
}

/**
 * Parts inside a message range that carry a semantic vector — the level below the spine.
 *
 * The range compares `message_id` as TEXT, which is sound because our ids are ULIDs: measured
 * 2026-09-20, the lexicographic order of `message_id` equals the order of `message_index` for
 * all 3 510 messages of the owner session, and the probe was validated by a positive control
 * (reversing one comparator yields 3 510 of 3 510 inversions — it can see disorder).
 *
 * The marker filter runs INSIDE the range on purpose, and the order is the measurement's, not
 * a preference: the same marker filter over the whole index costs 1 563 ms, while a range query
 * costs 15 ms. Restricted first, filtered second.
 *
 * Two exclusions, both measured (2026-09-20, owner session): 17 parts are `=== COMPACTED ===`
 * snapshots that carry the dominants of EVERY summary, and a tool output quotes dominants it
 * read. So this reads the assistant's own `text` parts only — the one place a vector is written.
 */
export function listDominants(params: {
  worktree: string
  sessionID?: string
  from?: string
  to?: string
  limit?: number
}): MemoryDominant[] {
  const memDb = openMemoryDb(params.worktree)

  try {
    const rows = memDb.prepare(`
      SELECT part_id, message_id, message_index, role, part_type, text
      FROM part_index
      WHERE role = 'assistant'
        AND part_type = 'text'
        AND substr(text, 1, 17) <> '=== COMPACTED ==='
        ${params.sessionID ? "AND session_id = ?" : ""}
        ${params.from ? "AND message_id >= ?" : ""}
        ${params.to ? "AND message_id <= ?" : ""}
        AND instr(text, ?) > 0
      ORDER BY message_index ASC, part_id ASC
      LIMIT ?
    `).all(
      ...(params.sessionID ? [params.sessionID] : []),
      ...(params.from ? [params.from] : []),
      ...(params.to ? [params.to] : []),
      DOMINANT_MARKER,
      params.limit ?? 200,
    ) as Array<{
      part_id: string
      message_id: string
      message_index: number
      role: string
      part_type: string
      text: string
    }>

    return rows.map((row) => ({
      partID: row.part_id,
      messageID: row.message_id,
      messageIndex: row.message_index,
      role: row.role,
      partType: row.part_type,
      text: row.text,
    }))
  } finally {
    memDb.close()
  }
}

export * as Memory from "./memory"
