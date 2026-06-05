import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@/storage/db"
import { Database as BunDatabase } from "bun:sqlite"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { errorMessage } from "../../util/error"
import path from "path"

function resolveProjectDbPath(cwd: string): string {
  return Database.getProjectDbPath(cwd)
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
    const child = spawn("sqlite3", [dbPath], {
      stdio: "inherit",
    })
    await new Promise((resolve) => child.on("close", resolve))
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
    return yargs.command(QueryCommand).command(PathCommand).demandCommand()
  },
  handler: () => {},
})
