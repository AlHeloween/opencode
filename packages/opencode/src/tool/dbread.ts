import { Effect, Schema } from "effect"
import { Database as BunDatabase } from "bun:sqlite"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import * as Tool from "./tool"
import path from "path"
import { existsSync } from "fs"

import DESCRIPTION from "./dbread.txt"

const MAX_OUTPUT = 50 * 1024
const MAX_ROWS = 100

/** Map from friendly database name to path relative to .opencode/data/ */
const DB_ALIASES: Record<string, string> = {
  opencode: "opencode.db",
  memory: "memory/memory.db",
  jobs: "jobs.db",
}

export const Parameters = Schema.Struct({
  database: Schema.String.annotate({
    description:
      'Database name: "opencode" (main), "memory" (search index), "jobs" (background jobs), or a path relative to .opencode/data/',
  }),
  sql: Schema.String.annotate({
    description: "SELECT SQL query to execute (read-only)",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum rows to return (default: 100)",
  }),
})

type DbReadMeta = {
  database: string
  rows: number
  error: string
}

export const DbReadTool = Tool.define(
  "db-read",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { database: string; sql: string; limit?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "db-read",
            patterns: [params.database],
            always: ["*"],
            metadata: { database: params.database, sql: params.sql },
          })

          const ins = yield* InstanceState.context
          const dataDir = Global.Path.data

          // Resolve database path
          const dbAlias = DB_ALIASES[params.database]
          const relPath = dbAlias ?? params.database
          const dbPath = path.join(dataDir, relPath)

          // Security check: must be under .opencode/data/
          const normalizedPath = path.resolve(dbPath)
          const normalizedDataDir = path.resolve(dataDir)
          if (!normalizedPath.startsWith(normalizedDataDir)) {
            return {
              title: `dbread: ${params.database}`,
              metadata: { database: params.database, rows: 0, error: "path_escape" },
              output: `Error: database path must be under ${normalizedDataDir}`,
            }
          }

          if (!existsSync(dbPath)) {
            return {
              title: `dbread: ${params.database}`,
              metadata: { database: params.database, rows: 0, error: "not_found" },
              output: `Error: database not found at ${dbPath}`,
            }
          }

          // Validate SQL is read-only
          const sqlUpper = params.sql.trim().toUpperCase()
          if (!sqlUpper.startsWith("SELECT") && !sqlUpper.startsWith("PRAGMA") && !sqlUpper.startsWith("WITH")) {
            return {
              title: `dbread: ${params.database}`,
              metadata: { database: params.database, rows: 0, error: "write_rejected" },
              output: "Error: Only SELECT, PRAGMA, and WITH queries are allowed (read-only).",
            }
          }

          const maxRows = Math.min(params.limit ?? MAX_ROWS, MAX_ROWS)

          try {
            const db = new BunDatabase(dbPath, { readonly: true })
            try {
              const stmt = db.prepare(params.sql)
              const rows = stmt.all() as Record<string, unknown>[]

              if (rows.length === 0) {
                return {
                  title: `dbread: ${params.database}`,
                  metadata: { database: params.database, rows: 0, error: "" },
                  output: "Query returned 0 rows.",
                }
              }

              const limited = rows.slice(0, maxRows)
              const truncated = rows.length > maxRows

              // Format as table
              const columns = Object.keys(limited[0] ?? {})
              const colWidths = columns.map((col) =>
                Math.min(
                  Math.max(
                    col.length,
                    ...limited.map((r) => String(r[col] ?? "").length),
                  ),
                  80,
                ),
              )

              let output = `Database: ${params.database}\nPath: ${dbPath}\nQuery: ${params.sql}\nRows: ${limited.length}${truncated ? ` (showing first ${maxRows} of ${rows.length})` : ""}\n\n`

              // Header
              const header = columns
                .map((col, i) => col.padEnd(colWidths[i]))
                .join(" │ ")
              output += header + "\n"
              output += columns
                .map((col, i) => "─".repeat(colWidths[i]))
                .join("─┼─")
                + "\n"

              // Rows
              for (const row of limited) {
                const line = columns
                  .map((col, i) => {
                    const val = row[col]
                    const str = val === null ? "NULL" : val === undefined ? "" : String(val)
                    return str.padEnd(colWidths[i])
                  })
                  .join(" │ ")
                output += line + "\n"
              }

              // Truncate if too long
              if (output.length > MAX_OUTPUT) {
                output = output.slice(0, MAX_OUTPUT) + "\n... (output truncated)"
              }

              return {
                title: `dbread: ${params.database}`,
                metadata: {
                  database: params.database,
                  rows: limited.length,
                  error: "",
                },
                output,
              }
            } finally {
              db.close()
            }
          } catch (err) {
            return {
              title: `dbread: ${params.database}`,
              metadata: { database: params.database, rows: 0, error: "query_failed" },
              output: `Error executing query: ${err instanceof Error ? err.message : String(err)}`,
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
