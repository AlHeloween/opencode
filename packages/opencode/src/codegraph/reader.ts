/**
 * CodeGraph SQLite helpers — **NOT for live agent / fossil impact paths**.
 *
 * Live graph: MCP only (`codegraph/mcp-client.ts`, mcp.codegraph serve --mcp).
 * While MCP is active, SQLite is blocked by CodeGraph; CLI is blocked.
 * Soft-fail to empty SQL results is forbidden for tools.
 *
 * This module remains for offline diagnostics / path constants only.
 * Schema (codegraph source):
 *   nodes, edges, files, …
 */

import { Database } from "bun:sqlite"
import { existsSync } from "fs"
import path from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CgSymbol {
  id: string
  kind: string
  name: string
  qualifiedName: string | null
  filePath: string
  language: string | null
  startLine: number | null
  endLine: number | null
}

export interface CallerRef {
  callerKind: string
  callerName: string
  callerFile: string
  callerLine: number | null
  targetKind: string
  targetName: string
  targetFile: string
}

export interface StructuralDiff {
  /** Commit hash the diff was computed against */
  snapshotHash: string
  /** Files changed in this snapshot */
  changedFiles: string[]
  /** Symbols found in changed files (top N, prioritized by kind) */
  symbols: CgSymbol[]
  /** Symbol count per kind (for summary) */
  symbolCountByKind: Record<string, number>
  /** Most-referenced symbols in changed files (top 5) */
  topReferenced: { name: string; kind: string; callerCount: number }[]
  /** Files with callers into changed symbols */
  impactedFiles: string[]
}

export interface CgOptions {
  /** Max symbols to include in tag (default 100) */
  maxTagSymbols?: number
  /** Path to codegraph db (default {worktree}/.codegraph/codegraph.db) */
  dbPath?: string
}

// ---------------------------------------------------------------------------
// DB access
// ---------------------------------------------------------------------------

export function getCodegraphDbPath(worktree: string): string {
  return path.join(worktree, ".codegraph", "codegraph.db")
}

function openDb(dbPath: string, readonly = true): Database | null {
  if (!existsSync(dbPath)) return null
  try {
    const db = new Database(dbPath, { readonly })
    db.run("PRAGMA journal_mode=OFF")
    db.run("PRAGMA synchronous=OFF")
    return db
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Symbol queries
// ---------------------------------------------------------------------------

/** Symbol kinds ordered by structural importance (most → least). */
const KIND_PRIORITY: Record<string, number> = {
  class: 10,
  function: 9,
  method: 8,
  type_alias: 7,
  interface: 6,
  constant: 5,
  property: 4,
  enum: 3,
  variable: 2,
  import: 1,
}

function kindPriority(kind: string): number {
  return KIND_PRIORITY[kind] ?? 0
}

/**
 * Return all symbols in the given file paths, sorted by structural importance.
 * File paths should be relative to worktree root (as reported by fossil diff).
 */
export function symbolsInFilePaths(
  dbPath: string,
  filePaths: string[],
  opts?: { maxResults?: number },
): CgSymbol[] {
  const db = openDb(dbPath)
  if (!db || filePaths.length === 0) return []

  try {
    // Normalize paths
    const paths = filePaths.map((p) => p.replace(/\\/g, "/"))

    const placeholders = paths.map(() => "?").join(",")
    const query = `
      SELECT id, kind, name, qualified_name, file_path, language,
             start_line, end_line
      FROM nodes
      WHERE file_path IN (${placeholders})
        AND kind != 'file'
      ORDER BY
        CASE kind
          WHEN 'class' THEN 1
          WHEN 'function' THEN 2
          WHEN 'method' THEN 3
          WHEN 'type_alias' THEN 4
          WHEN 'interface' THEN 5
          WHEN 'constant' THEN 6
          WHEN 'property' THEN 7
          WHEN 'enum' THEN 8
          WHEN 'variable' THEN 9
          ELSE 10
        END,
        name
    `

    const rows = db.query(query).all(...paths) as any[]
    const symbols: CgSymbol[] = rows.map((r: any[]) => ({
      id: r[0] as string,
      kind: r[1] as string,
      name: r[2] as string,
      qualifiedName: (r[3] as string) ?? null,
      filePath: (r[4] as string).replace(/\\/g, "/"),
      language: (r[5] as string) ?? null,
      startLine: (r[6] as number) ?? null,
      endLine: (r[7] as number) ?? null,
    }))

    if (opts?.maxResults && symbols.length > opts.maxResults) {
      return symbols.slice(0, opts.maxResults)
    }
    return symbols
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Caller impact queries
// ---------------------------------------------------------------------------

/**
 * Find all nodes that reference (call/import/use) the given symbol IDs.
 * Returns deduplicated caller→target pairs.
 */
export function callersOf(
  dbPath: string,
  symbolIds: string[],
): CallerRef[] {
  const db = openDb(dbPath)
  if (!db || symbolIds.length === 0) return []

  try {
    const placeholders = symbolIds.map(() => "?").join(",")
    const query = `
      SELECT DISTINCT
        src.kind,
        src.name,
        src.file_path,
        src.start_line,
        tgt.kind,
        tgt.name,
        tgt.file_path
      FROM edges e
      JOIN nodes src ON e.source = src.id
      JOIN nodes tgt ON e.target = tgt.id
      WHERE e.kind = 'references'
        AND e.target IN (${placeholders})
      ORDER BY src.file_path, src.name
    `

    const rows = db.query(query).all(...symbolIds) as any[]

    const seen = new Set<string>()
    const callers: CallerRef[] = []

    for (const r of rows) {
      const key = `${r[2]}:${r[1]}->${r[6]}:${r[5]}`
      if (seen.has(key)) continue
      seen.add(key)

      callers.push({
        callerKind: r[0] as string,
        callerName: r[1] as string,
        callerFile: ((r[2] as string) ?? "").replace(/\\/g, "/"),
        callerLine: (r[3] as number) ?? null,
        targetKind: r[4] as string,
        targetName: r[5] as string,
        targetFile: ((r[6] as string) ?? "").replace(/\\/g, "/"),
      })
    }

    return callers
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Combined structural diff
// ---------------------------------------------------------------------------

/**
 * Compute a structural diff for a fossil snapshot.
 *
 * @param dbPath - Path to codegraph.db
 * @param changedFiles - List of relative file paths changed in this snapshot
 * @param snapshotHash - The fossil commit hash
 * @returns StructuralDiff with symbols, callers, and impact summary
 */
export function structuralDiff(
  dbPath: string,
  changedFiles: string[],
  snapshotHash: string,
): StructuralDiff {
  const symbols = symbolsInFilePaths(dbPath, changedFiles)

  // Count by kind
  const symbolCountByKind: Record<string, number> = {}
  for (const s of symbols) {
    symbolCountByKind[s.kind] = (symbolCountByKind[s.kind] ?? 0) + 1
  }

  // Top referenced symbols
  const symbolIds = symbols.map((s) => s.id)
  const callers = callersOf(dbPath, symbolIds)

  const refCount = new Map<string, { name: string; kind: string; callerCount: number }>()
  const impactedFiles = new Set<string>()

  for (const c of callers) {
    const targetKey = `${c.targetFile}:${c.targetName}`
    const entry = refCount.get(targetKey)
    if (entry) {
      entry.callerCount++
    } else {
      refCount.set(targetKey, {
        name: c.targetName,
        kind: c.targetKind,
        callerCount: 1,
      })
    }
    // Only count callers from OUTSIDE the changed files
    if (!changedFiles.some((f) => f.replace(/\\/g, "/") === c.callerFile)) {
      impactedFiles.add(c.callerFile)
    }
  }

  const topReferenced = [...refCount.values()]
    .sort((a, b) => b.callerCount - a.callerCount)
    .slice(0, 5)

  return {
    snapshotHash,
    changedFiles,
    symbols,
    symbolCountByKind,
    topReferenced,
    impactedFiles: [...impactedFiles].sort(),
  }
}

// ---------------------------------------------------------------------------
// Compact tag serialization (for fossil tag storage)
// ---------------------------------------------------------------------------

/**
 * Serialize a StructuralDiff into a compact string for fossil tag storage.
 *
 * Format (pipe-delimited sections):
 *   KINDS:fn=5,class=3,const=2|TOP:allowDestructiveCommands[fn],guardCommand[fn]|IMPACT:jobs/index.ts,constitution.ts
 *
 * KINDS: kind=count pairs
 * TOP:   name[kind] of most-important symbols (max ~20)
 * IMPACT: files outside the change set that reference changed symbols
 */
export function serializeForTag(diff: StructuralDiff, maxSymbols = 20): string {
  const parts: string[] = []

  // Kinds section
  const kindEntries = Object.entries(diff.symbolCountByKind)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")
  parts.push(`KINDS:${kindEntries}`)

  // Top symbols (prioritized, non-import)
  const topSymbols = diff.symbols
    .filter((s) => s.kind !== "import" && s.kind !== "file")
    .sort((a, b) => kindPriority(b.kind) - kindPriority(a.kind))
    .slice(0, maxSymbols)
    .map((s) => `${s.name}[${s.kind}@${s.filePath.split("/").pop()}]`)
    .join(",")
  parts.push(`TOP:${topSymbols}`)

  // Impact files
  if (diff.impactedFiles.length > 0) {
    const impactPaths = diff.impactedFiles
      .slice(0, 10)
      .map((f) => f.split("/").pop() ?? f)
      .join(",")
    parts.push(`IMPACT:${impactPaths}`)
  }

  return parts.join("|")
}

/**
 * Deserialize a fossil tag value back into a readable summary.
 */
export function deserializeTag(tagValue: string): string {
  const sections = tagValue.split("|")
  const result: string[] = []

  for (const section of sections) {
    const [key, value] = section.split(":", 2)
    if (!value) continue

    switch (key) {
      case "KINDS":
        result.push(`Symbols: ${value}`)
        break
      case "TOP":
        result.push(`Key: ${value}`)
        break
      case "IMPACT":
        result.push(`Impact: ${value}`)
        break
    }
  }

  return result.join(" | ")
}
