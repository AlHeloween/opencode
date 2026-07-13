import { Effect, Schema } from "effect"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import { Database } from "bun:sqlite"

import DESCRIPTION from "./codegraph.txt"

// ——— CodeGraph tool — uses bun:sqlite directly against .codegraph/codegraph.db
//     No external CLI needed for queries. Indexing (creating the database) is
//     handled by the bootstrap which runs `codegraph init` if the CLI is found.
// ———

const Mode = Schema.Literals(["explore", "search", "trace", "impact", "path"])

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Natural language question or symbol name(s) to search for." }),
  mode: Schema.optional(Mode).annotate({ description: "Analysis mode (default: explore)." }),
  path: Schema.optional(Schema.String).annotate({ description: "Project subdirectory to scope the query to." }),
  depth: Schema.optional(Schema.Number).annotate({ description: "Traversal depth (default: 2)." }),
})

type Metadata = { resultCount: number; mode: string; nodeCount: number; edgeCount: number; hasCodegraph: boolean }

interface NodeRow {
  id: string
  name: string
  kind: string
  file_path: string
  start_line: number
  end_line: number
  qualified_name: string
  language: string
}

/** Open the codegraph SQLite database, returning null if unavailable. */
function openDb(projectRoot: string): Database | null {
  try {
    const dbPath = path.join(projectRoot, ".codegraph", "codegraph.db")
    const { existsSync } = require("fs") as typeof import("fs")
    if (!existsSync(dbPath)) return null
    const db = new Database(dbPath, { readonly: true })
    db.run("PRAGMA journal_mode=WAL")
    return db
  } catch {
    return null
  }
}

/** Count total nodes and edges from stats table or fallback. */
function getStats(db: Database): { nodeCount: number; edgeCount: number } {
  try {
    const nc = db.prepare("SELECT COUNT(*) as c FROM nodes").get() as { c: number }
    const ec = db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number }
    return { nodeCount: nc.c, edgeCount: ec.c }
  } catch {
    return { nodeCount: 0, edgeCount: 0 }
  }
}

/** Search nodes by name (LIKE) with optional kind filtering. */
function searchNodes(db: Database, query: string, limit = 20): NodeRow[] {
  const terms = query.split(/\s+/).filter(Boolean).map(t => t.replace(/[%_\\]/g, "\\$&"))
  if (terms.length === 0) return []

  // Build OR condition across terms — match any term in name or qualified_name
  const conditions = terms.map(() => "(name LIKE ? OR qualified_name LIKE ?)")
  const sql = `SELECT id, name, kind, file_path, start_line, end_line, qualified_name, language
    FROM nodes
    WHERE kind NOT IN ('file','import')
      AND (${conditions.join(" OR ")})
    ORDER BY
      CASE
        WHEN kind IN ('function','method','class','interface','struct') THEN 0
        WHEN kind IN ('constant','variable','property','field') THEN 1
        ELSE 2
      END,
      LENGTH(name)
    LIMIT ?`
  const params: string[] = []
  for (const term of terms) {
    params.push(`%${term}%`, `%${term}%`)
  }
  params.push(String(limit))
  try {
    return db.prepare(sql).all(...params) as NodeRow[]
  } catch { return [] }
}

/** Get outgoing edges (callees) for a node. */
function getCallees(db: Database, nodeId: string, depth: number): NodeRow[] {
  const visited = new Set<string>()
  const results: NodeRow[] = []
  let current = [nodeId]
  for (let d = 0; d < depth && current.length > 0; d++) {
    const placeholders = current.map(() => "?").join(",")
    const rows = db.prepare(`
      SELECT DISTINCT n.id, n.name, n.kind, n.file_path, n.start_line, n.end_line, n.qualified_name, n.language
      FROM edges e JOIN nodes n ON n.id = e.target
      WHERE e.source IN (${placeholders}) AND e.kind IN ('calls','references')
    `).all(...current) as NodeRow[]
    const next: string[] = []
    for (const r of rows) {
      if (!visited.has(r.id)) {
        visited.add(r.id)
        results.push(r)
        next.push(r.id)
      }
    }
    current = next
  }
  return results
}

/** Get incoming edges (callers) for a node. */
function getCallers(db: Database, nodeId: string, depth: number): NodeRow[] {
  const visited = new Set<string>()
  const results: NodeRow[] = []
  let current = [nodeId]
  for (let d = 0; d < depth && current.length > 0; d++) {
    const placeholders = current.map(() => "?").join(",")
    const rows = db.prepare(`
      SELECT DISTINCT n.id, n.name, n.kind, n.file_path, n.start_line, n.end_line, n.qualified_name, n.language
      FROM edges e JOIN nodes n ON n.id = e.source
      WHERE e.target IN (${placeholders}) AND e.kind IN ('calls','references')
    `).all(...current) as NodeRow[]
    const next: string[] = []
    for (const r of rows) {
      if (!visited.has(r.id)) {
        visited.add(r.id)
        results.push(r)
        next.push(r.id)
      }
    }
    current = next
  }
  return results
}

/** BFS path between two node IDs. */
function findPath(db: Database, fromId: string, toId: string): Array<{ node: NodeRow; edgeKind: string }> | null {
  const visited = new Set<string>([fromId])
  const queue: Array<{ id: string; path: Array<{ node: NodeRow; edgeKind: string }> }> = [{ id: fromId, path: [] }]
  const nodeCache = new Map<string, NodeRow>()

  function getNode(id: string): NodeRow | null {
    if (nodeCache.has(id)) return nodeCache.get(id)!
    try {
      const row = db.prepare("SELECT id, name, kind, file_path, start_line, end_line, qualified_name, language FROM nodes WHERE id = ?").get(id) as NodeRow | null
      nodeCache.set(id, row!)
      return row
    } catch { return null }
  }

  while (queue.length > 0) {
    const { id, path } = queue.shift()!
    const edges = db.prepare(`
      SELECT e.target as target, e.kind as edge_kind
      FROM edges e
      WHERE e.source = ? AND e.kind IN ('calls','references')
    `).all(id) as Array<{ target: string; edge_kind: string }>

    for (const e of edges) {
      if (e.target === toId) {
        const targetNode = getNode(e.target)
        if (targetNode) return [...path, { node: targetNode, edgeKind: e.edge_kind }]
      }
      if (!visited.has(e.target)) {
        visited.add(e.target)
        const targetNode = getNode(e.target)
        if (targetNode) {
          queue.push({ id: e.target, path: [...path, { node: targetNode, edgeKind: e.edge_kind }] })
        }
      }
    }
  }
  return null
}

function runExplore(db: Database, query: string): string {
  const results = searchNodes(db, query, 20)
  if (results.length === 0) return "No results found."
  const lines: string[] = [`CodeGraph explore: "${query}" — ${results.length} result(s)`, ""]
  for (const n of results) {
    lines.push(`── ${n.kind} \`${n.name}\``)
    lines.push(`   ${n.file_path}:${n.start_line}–${n.end_line}`)
    lines.push(`   ${n.qualified_name}`)
    const callers = getCallers(db, n.id, 1)
    const callees = getCallees(db, n.id, 1)
    if (callers.length > 0) lines.push(`   callers: ${callers.length}`)
    if (callees.length > 0) lines.push(`   callees: ${callees.length}`)
    lines.push("")
  }
  return lines.join("\n")
}

function runSearch(db: Database, query: string): string {
  const results = searchNodes(db, query, 30)
  if (results.length === 0) return "No results found."
  return results.map((n, i) =>
    `${i + 1}. ${n.kind} \`${n.name}\`\n   ${n.file_path}:${n.start_line}–${n.end_line}\n   ${n.qualified_name}`
  ).join("\n\n")
}

function runTrace(db: Database, query: string, depth: number): string {
  const results = searchNodes(db, query, 5)
  if (results.length === 0) return "No results found."
  const lines: string[] = [`CodeGraph trace: "${query}" (depth: ${depth})`, ""]
  for (const n of results) {
    lines.push(`══ ${n.kind} \`${n.name}\` — ${n.file_path}:${n.start_line}`)
    const callers = getCallers(db, n.id, depth)
    const callees = getCallees(db, n.id, depth)
    if (callers.length > 0) {
      lines.push(`  Callers (${callers.length}):`)
      for (const c of callers.slice(0, 10))
        lines.push(`    ← ${c.kind} \`${c.name}\` — ${c.file_path}:${c.start_line}`)
    }
    if (callees.length > 0) {
      lines.push(`  Callees (${callees.length}):`)
      for (const c of callees.slice(0, 10))
        lines.push(`    → ${c.kind} \`${c.name}\` — ${c.file_path}:${c.start_line}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

function runImpact(db: Database, query: string, depth: number): string {
  const results = searchNodes(db, query, 5)
  if (results.length === 0) return "No results found."
  const lines: string[] = [`CodeGraph impact: "${query}" (depth: ${depth})`, ""]
  for (const n of results) {
    const impacted = getCallees(db, n.id, depth)
    lines.push(`══ ${n.kind} \`${n.name}\` — ${n.file_path}:${n.start_line}`)
    lines.push(`  Impact radius: ${impacted.length} node(s)`)
    let count = 0
    for (const imp of impacted) {
      if (count >= 8) { lines.push(`  ... and ${impacted.length - count} more`); break }
      lines.push(`    ${imp.kind} \`${imp.name}\` — ${imp.file_path}:${imp.start_line}`)
      count++
    }
    lines.push("")
  }
  return lines.join("\n")
}

function runPath(db: Database, query: string): string {
  const parts = query.split("->").map(s => s.trim())
  if (parts.length < 2) return "Path syntax: <from> -> <to>"

  const fromResults = searchNodes(db, parts[0]!, 3)
  const toResults = searchNodes(db, parts[1]!, 3)
  if (fromResults.length === 0) return `No symbol found for "${parts[0]}"`
  if (toResults.length === 0) return `No symbol found for "${parts[1]}"`

  const from = fromResults[0]!
  const to = toResults[0]!
  const pathResult = findPath(db, from.id, to.id)

  const lines: string[] = [
    `CodeGraph path: "${parts[0]}" → "${parts[1]}"`,
    `  From: ${from.kind} \`${from.name}\` — ${from.file_path}:${from.start_line}`,
    `  To:   ${to.kind} \`${to.name}\` — ${to.file_path}:${to.start_line}`,
    "",
  ]
  if (!pathResult) {
    lines.push("  No path found between these symbols.")
    return lines.join("\n")
  }
  lines.push(`  Path (${pathResult.length} hop(s)):`)
  for (const hop of pathResult) {
    lines.push(`    → ${hop.node.kind} \`${hop.node.name}\` — ${hop.node.file_path}:${hop.node.start_line}  [via ${hop.edgeKind}]`)
  }
  return lines.join("\n")
}

export const CodeGraphTool = Tool.define(
  "codegraph",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "codegraph", patterns: [params.query], always: ["*"], metadata: { query: params.query, mode: params.mode, depth: params.depth, path: params.path } })
          const ins = yield* InstanceState.context
          const projectRoot = params.path ? (path.isAbsolute(params.path) ? params.path : path.resolve(ins.directory, params.path)) : ins.worktree
          yield* assertExternalDirectoryEffect(ctx, projectRoot, { kind: "directory" })
          const mode = params.mode ?? "explore"
          const depth = params.depth ?? 2

          // Open codegraph SQLite database directly via bun:sqlite — no external CLI needed
          const db = openDb(projectRoot)
          if (!db) return {
            title: "CodeGraph not initialized",
            metadata: { resultCount: 0, mode, nodeCount: 0, edgeCount: 0, hasCodegraph: false },
            output: `CodeGraph not initialized in "${projectRoot}". The bootstrap auto-initializes CodeGraph on startup if the codegraph CLI is available.`,
          }

          try {
            const stats = getStats(db)
            const output = (() => {
              switch (mode) {
                case "search": return runSearch(db, params.query)
                case "trace": return runTrace(db, params.query, depth)
                case "impact": return runImpact(db, params.query, depth)
                case "path": return runPath(db, params.query)
                default: return runExplore(db, params.query)
              }
            })()

            return {
              title: `CodeGraph: ${params.query.slice(0, 60)}`,
              metadata: {
                resultCount: (output.match(/\`[^`]+\`/g) || []).length,
                mode,
                nodeCount: stats.nodeCount,
                edgeCount: stats.edgeCount,
                hasCodegraph: true,
              },
              output,
            }
          } finally {
            db.close()
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export * as CodeGraph from "./codegraph"
