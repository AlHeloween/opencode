import type { Argv } from "yargs"
import { createInterface } from "readline"
import { statSync } from "fs"
import { Database } from "@/storage/db"
import { Database as BunDatabase } from "bun:sqlite"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { errorMessage } from "../../util/error"
import path from "path"

function resolveProjectDbPath(cwd: string): string {
  return Database.getProjectDbPath(cwd)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const QueryCommand = cmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query on the project database",
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("dir", {
        type: "string",
        describe: "Project directory (defaults to current working directory)",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: async (args: { query?: string; format: string; dir?: string }) => {
    const cwd = args.dir ?? process.cwd()
    const dbPath = resolveProjectDbPath(cwd)
    const query = args.query as string | undefined
    if (query) {
      const db = new BunDatabase(dbPath, { readonly: true })
      try {
        const result = db.query(query).all() as Record<string, unknown>[]
        if (args.format === "json") {
          console.log(JSON.stringify(result, null, 2))
        } else if (result.length > 0) {
          const keys = Object.keys(result[0])
          console.log(keys.join("\t"))
          for (const row of result) {
            console.log(keys.map((k) => row[k]).join("\t"))
          }
        }
      } catch (err) {
        UI.error(errorMessage(err))
        process.exit(1)
      }
      db.close()
      return
    }
    const db = new BunDatabase(dbPath, { readonly: true })
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    UI.println(`Connected to ${dbPath}`)
    UI.println("Enter SQL queries (empty line to exit):")
    const ask = (): Promise<void> =>
      new Promise((resolve) => {
        rl.question("sql> ", (line: string) => {
          const trimmed = line.trim()
          if (!trimmed) {
            rl.close()
            db.close()
            resolve()
            return
          }
          try {
            const result = db.query(trimmed).all() as Record<string, unknown>[]
            if (result.length === 0) {
              UI.println("(empty)")
            } else {
              const keys = Object.keys(result[0])
              UI.println(keys.join("\t"))
              for (const row of result) {
                UI.println(keys.map((k) => row[k]).join("\t"))
              }
            }
          } catch (err) {
            UI.error(errorMessage(err))
          }
          resolve(ask())
        })
      })
    await ask()
  },
})

const CompactCommand = cmd({
  command: "compact",
  describe: "reclaim disk space by vacuuming the database and checkpointing the WAL",
  builder: (yargs: Argv) => {
    return yargs.option("dir", {
      type: "string",
      describe: "Project directory (defaults to current working directory)",
    })
  },
  handler: (args: { dir?: string }) => {
    const cwd = args.dir ?? process.cwd()
    const dbPath = resolveProjectDbPath(cwd)

    let statBefore: ReturnType<typeof statSync>
    try {
      statBefore = statSync(dbPath)
    } catch {
      UI.error(`Database not found at ${dbPath}`)
      process.exit(1)
    }

    const db = new BunDatabase(dbPath)
    try {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)")
      db.run("VACUUM")
    } catch (err) {
      UI.error(errorMessage(err))
      process.exit(1)
    } finally {
      db.close()
    }

    const statAfter = statSync(dbPath)
    const saved = statBefore.size - statAfter.size
    const pct = statBefore.size > 0 ? ((saved / statBefore.size) * 100).toFixed(1) : "0.0"
    UI.println(
      `Compacted: ${formatBytes(statBefore.size)} → ${formatBytes(statAfter.size)} (${formatBytes(Math.abs(saved))} ${saved >= 0 ? "reclaimed" : "larger"}, ${pct}%)`,
    )
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the project database path",
  builder: (yargs: Argv) => {
    return yargs.option("dir", {
      type: "string",
      describe: "Project directory (defaults to current working directory)",
    })
  },
  handler: (args: { dir?: string }) => {
    const cwd = args.dir ?? process.cwd()
    console.log(resolveProjectDbPath(cwd))
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(CompactCommand).demandCommand()
  },
  handler: () => {},
})
