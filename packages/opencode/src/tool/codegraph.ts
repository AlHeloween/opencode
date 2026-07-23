import { Effect, Schema } from "effect"
import path from "path"
import { existsSync } from "fs"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Tool from "./tool"
import {
  getCodegraphDbPath,
  symbolsInFilePaths,
  callersOf,
  type CgSymbol,
  type CallerRef,
} from "@/codegraph/reader"

import DESCRIPTION from "./codegraph.txt"

// ——— CodeGraph tool — reads codegraph.db directly (no CLI subprocess).
//     The MCP server (auto-started at bootstrap) keeps the DB fresh via
//     file watcher + 2s debounced incremental sync.  Direct SQLite reads
//     avoid CLI subprocess conflicts and are ~5ms vs ~100ms for CLI.
// ———

const Mode = Schema.Literals(["explore", "search", "trace", "impact", "path"])

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Natural language question or symbol name(s) to search for." }),
  mode: Schema.optional(Mode).annotate({ description: "Analysis mode (default: explore)." }),
  path: Schema.optional(Schema.String).annotate({ description: "Project subdirectory to scope the query to." }),
  depth: Schema.optional(Schema.Number).annotate({ description: "Traversal depth for trace/impact modes (default: 2)." }),
})

type Metadata = { resultCount: number; mode: string; hasCodegraph: boolean }

// ——— Direct SQLite queries (replacing CLI subprocess) ———

/** Search nodes by name (LIKE %query%). Returns formatted text. */
function searchByName(dbPath: string, query: string): string {
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite")
  const db = new Database(dbPath, { readonly: true })
  try {
    const like = `%${query.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`
    const rows = db
      .query(
        `SELECT kind, name, file_path, start_line
         FROM nodes
         WHERE name LIKE ? AND kind != 'file'
         ORDER BY
           CASE kind
             WHEN 'class' THEN 1 WHEN 'function' THEN 2 WHEN 'method' THEN 3
             WHEN 'type_alias' THEN 4 WHEN 'interface' THEN 5
             WHEN 'constant' THEN 6 ELSE 7
           END,
           name
         LIMIT 50`,
      )
      .all(like) as any[]

    if (rows.length === 0) return `No symbols found matching "${query}".`

    const lines: string[] = [`Found ${rows.length} symbol(s) matching "${query}":`, ""]
    for (const r of rows) {
      const kind = r[0] as string
      const name = r[1] as string
      const file = ((r[2] as string) ?? "").replace(/\\/g, "/")
      const line = r[3] as number | null
      const loc = line ? `:${line}` : ""
      lines.push(`  ${kind.padEnd(14)} ${name.padEnd(40)} ${file}${loc}`)
    }
    return lines.join("\n")
  } finally {
    db.close()
  }
}

/** Find callees of a symbol (reverse of callersOf — edges where source = our symbol). */
function calleesOf(dbPath: string, symbolName: string): CallerRef[] {
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite")
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db
      .query(
        `SELECT DISTINCT
           src.kind, src.name, src.file_path, src.start_line,
           tgt.kind, tgt.name, tgt.file_path
         FROM edges e
         JOIN nodes src ON e.source = src.id
         JOIN nodes tgt ON e.target = tgt.id
         WHERE e.kind = 'references'
           AND src.name = ?
         ORDER BY tgt.kind, tgt.name
         LIMIT 50`,
      )
      .all(symbolName) as any[]

    const seen = new Set<string>()
    const result: CallerRef[] = []
    for (const r of rows) {
      const key = `${r[2]}:${r[1]}->${r[6]}:${r[5]}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        callerKind: r[0] as string,
        callerName: r[1] as string,
        callerFile: ((r[2] as string) ?? "").replace(/\\/g, "/"),
        callerLine: (r[3] as number) ?? null,
        targetKind: r[4] as string,
        targetName: r[5] as string,
        targetFile: ((r[6] as string) ?? "").replace(/\\/g, "/"),
      })
    }
    return result
  } finally {
    db.close()
  }
}

/** Find node IDs by name (returns IDs for use with callersOf). */
function findNodeIdsByName(dbPath: string, name: string): string[] {
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite")
  const db = new Database(dbPath, { readonly: true })
  try {
    return (
      db.query("SELECT id FROM nodes WHERE name = ?").all(name) as any[]
    ).map((r: any) => r[0] as string)
  } finally {
    db.close()
  }
}

/** Format caller references as readable text. */
function formatCallers(callers: CallerRef[], label: string): string {
  if (callers.length === 0) return `${label}: (none)`
  const lines: string[] = [`${label} (${callers.length}):`]
  for (const c of callers.slice(0, 30)) {
    const file = c.callerFile.split("/").pop() ?? c.callerFile
    const line = c.callerLine ? `:${c.callerLine}` : ""
    lines.push(`  ${c.callerKind.padEnd(14)} ${c.callerName.padEnd(40)} ${file}${line}`)
  }
  if (callers.length > 30) lines.push(`  ... and ${callers.length - 30} more`)
  return lines.join("\n")
}

// ——— Tool definition ———

export const CodeGraphTool = Tool.define(
  "codegraph",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "codegraph",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              mode: params.mode,
              depth: params.depth,
              path: params.path,
            },
          })
          const ins = yield* InstanceState.context
          const mode = params.mode ?? "explore"
          const projectRoot = ins.worktree
          yield* assertExternalDirectoryEffect(ctx, projectRoot, { kind: "directory" })

          // Verify the index exists
          const dbPath = getCodegraphDbPath(projectRoot)
          if (!existsSync(dbPath)) {
            return {
              title: "CodeGraph not initialized",
              metadata: { resultCount: 0, mode, hasCodegraph: false },
              output: `No .codegraph/ index found in "${projectRoot}". The codegraph MCP server will auto-index on startup.`,
            }
          }

          try {
            let output: string

            switch (mode) {
              case "search": {
                // Symbol name search
                output = searchByName(dbPath, params.query)
                break
              }

              case "trace": {
                // Callers + callees of a named symbol
                const ids = findNodeIdsByName(dbPath, params.query)
                const callers = ids.length > 0 ? callersOf(dbPath, ids) : []
                const callees = calleesOf(dbPath, params.query)
                output = [
                  `Trace: ${params.query}`,
                  "",
                  formatCallers(callers, "## Callers"),
                  "",
                  formatCallers(callees, "## Callees"),
                ].join("\n")
                break
              }

              case "impact": {
                // What is impacted by changing this symbol
                const ids = findNodeIdsByName(dbPath, params.query)
                if (ids.length === 0) {
                  output = `Symbol "${params.query}" not found in index.`
                } else {
                  const callers = callersOf(dbPath, ids)
                  const impactedFiles = new Set<string>()
                  for (const c of callers) impactedFiles.add(c.callerFile)
                  output = [
                    `Impact analysis: ${params.query}`,
                    "",
                    `${callers.length} caller(s) across ${impactedFiles.size} file(s) would be affected.`,
                    "",
                    formatCallers(callers, "## Direct callers"),
                    "",
                    "## Impacted files",
                    ...[...impactedFiles].sort().map((f) => `  ${f}`),
                  ].join("\n")
                }
                break
              }

              case "path": {
                // Path finding between two symbols — not supported by direct DB reads.
                // The codegraph MCP server supports this, but it requires graph traversal.
                output =
                  `Path finding between symbols requires the codegraph CLI or MCP server.\n` +
                  `Try "trace" mode on each symbol individually, or use the CLI:\n` +
                  `  codegraph explore "${params.query}"`
                break
              }

              default: {
                // explore — search by name + show callers
                const ids = findNodeIdsByName(dbPath, params.query)
                if (ids.length === 0) {
                  // Try broader search
                  output = searchByName(dbPath, params.query)
                } else {
                  const callers = callersOf(dbPath, ids)
                  const callees = calleesOf(dbPath, params.query)
                  output = [
                    `Explore: ${params.query}`,
                    "",
                    `Found ${ids.length} matching symbol(s).`,
                    "",
                    searchByName(dbPath, params.query),
                    callers.length > 0 ? "\n" + formatCallers(callers, "## Callers") : "",
                    callees.length > 0 ? "\n" + formatCallers(callees, "## Callees") : "",
                  ]
                    .filter(Boolean)
                    .join("\n")
                }
                break
              }
            }

            return {
              title: `CodeGraph ${mode}: ${params.query.slice(0, 60)}`,
              metadata: {
                resultCount: output.split("\n").filter((l) => l.trim()).length,
                mode,
                hasCodegraph: true,
              },
              output,
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return {
              title: `CodeGraph error`,
              metadata: { resultCount: 0, mode, hasCodegraph: true },
              output: `CodeGraph query failed: ${message}`,
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export * as CodeGraph from "./codegraph"
