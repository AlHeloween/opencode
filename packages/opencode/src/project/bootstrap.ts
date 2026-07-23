import { Plugin } from "../plugin"
import { Effect } from "effect"
import { Format } from "../format"
import { LSP } from "@/lsp/lsp"
import { File } from "../file"
import { Snapshot } from "../snapshot"
import * as Project from "./project"
import * as Vcs from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import * as Log from "@opencode-ai/core/util/log"
import { FileWatcher } from "@/file/watcher"
import { ShareNext } from "@/share/share-next"
import { Config } from "@/config/config"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { spawn } from "child_process"
import { which } from "@/util/which"

export const InstanceBootstrap = Effect.gen(function* () {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  // everything depends on config so eager load it for nice traces
  yield* Config.Service.use((svc) => svc.get())
  // Plugin can mutate config so it has to be initialized before anything else.
  yield* Plugin.Service.use((svc) => svc.init())
  yield* Effect.all(
    [
      LSP.Service,
      ShareNext.Service,
      Format.Service,
      File.Service,
      FileWatcher.Service,
      Vcs.Service,
      Snapshot.Service,
    ].map((s) => Effect.forkDetach(s.use((i) => i.init()))),
  ).pipe(Effect.withSpan("InstanceBootstrap.init"))

  // Auto-initialize CodeGraph index (fire-and-forget, non-blocking)
  initCodeGraphBg()

  yield* Bus.Service.use((svc) =>
    svc.subscribeCallback(Command.Event.Executed, async (payload) => {
      if (payload.properties.name === Command.Default.INIT) {
        Project.setInitialized(Instance.project.id)
      }
    }),
  )
}).pipe(Effect.withSpan("InstanceBootstrap"))

// ——— CodeGraph auto-init + MCP server (self-contained, no external CLI needed) ———

/**
 * Find the codegraph binary. Same resolution as tool/codegraph.ts:
 * PATH first, then sibling of the opencode executable.
 */
function findCodegraphBin(): string | null {
  const bin = which("codegraph")
  if (bin) return bin
  try {
    const exts = process.platform === "win32" ? [".exe", ".cmd", ".CMD"] : [""]
    const binDir = path.dirname(process.execPath)
    for (const ext of exts) {
      const sibling = path.join(binDir, `codegraph${ext}`)
      if (require("fs").existsSync(sibling)) return sibling
    }
  } catch { /* fall through */ }
  return null
}

function initCodeGraphBg(): void {
  const dir = Global.Path.worktree || Global.Path.home
  const cgDir = path.join(dir, ".codegraph")
  const dbPath = path.join(cgDir, "codegraph.db")

  const dbExists = (() => {
    try { return require("fs").existsSync(dbPath) }
    catch { return false }
  })()

  const cgBin = findCodegraphBin()

  // ——— Init (only if DB doesn't exist) ———
  if (!dbExists) {
    if (cgBin) {
      const isScript = process.platform === "win32" && (
        cgBin.toLowerCase().endsWith(".cmd") || cgBin.toLowerCase().endsWith(".bat")
      )
      const args = ["init"]
      const bin = isScript ? "cmd.exe" : cgBin
      if (isScript) args.unshift("/c", cgBin)
      const child = spawn(bin, args, { cwd: dir, stdio: "ignore", timeout: 120000 })
      child.on("error", () => { Log.Default.warn("bug: codegraph init failed") })
      child.unref()
    } else {
      // Self-contained init: create directory + empty schema via bun:sqlite
      Log.Default.debug("codegraph CLI not found — creating empty index via bun:sqlite")
      try {
        require("fs").mkdirSync(cgDir, { recursive: true })
        const { Database } = require("bun:sqlite") as typeof import("bun:sqlite")
        const db = new Database(dbPath)
        db.run("PRAGMA journal_mode=WAL")
        db.run(`CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
          qualified_name TEXT NOT NULL, file_path TEXT NOT NULL, language TEXT NOT NULL,
          start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
          start_column INTEGER NOT NULL, end_column INTEGER NOT NULL,
          docstring TEXT, signature TEXT, visibility TEXT,
          is_exported INTEGER DEFAULT 0, is_async INTEGER DEFAULT 0,
          is_static INTEGER DEFAULT 0, is_abstract INTEGER DEFAULT 0,
          decorators TEXT, type_parameters TEXT, return_type TEXT, updated_at INTEGER NOT NULL
        )`)
        db.run(`CREATE TABLE IF NOT EXISTS edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
          target TEXT NOT NULL, kind TEXT NOT NULL, metadata TEXT,
          line INTEGER, col INTEGER, provenance TEXT DEFAULT NULL
        )`)
        db.run("CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind)")
        db.run("CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON edges(target, kind)")
        try { db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
          id, name, qualified_name, docstring, signature, content='nodes', content_rowid='rowid'
        )`) } catch { /* FTS5 not available — queries still work via LIKE */ }
        db.run("CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, language TEXT NOT NULL, size INTEGER NOT NULL, modified_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, node_count INTEGER DEFAULT 0, errors TEXT)")
        db.run("CREATE TABLE IF NOT EXISTS project_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)")
        db.run("INSERT OR IGNORE INTO project_metadata (key, value, updated_at) VALUES ('index_state', 'empty', 1)")
        db.close()
        Log.Default.info("codegraph: empty index created — run 'codegraph init' with the CLI for full indexing")
      } catch (e) {
        Log.Default.warn("bug: codegraph self-init failed", { error: String(e) })
      }
    }
  }

  // MCP process is owned by opencode mcp.codegraph (stdio: codegraph serve --mcp).
  // Do NOT spawn a detached serve --mcp here — dual processes fight locks, and
  // while MCP is active SQLite/CLI are blocked. Soft-skip without MCP is forbidden
  // for codegraph tools; configure mcp.codegraph in opencode.json instead.
  if (cgBin && dbExists) {
    Log.Default.debug("codegraph: index present — live graph via mcp.codegraph only (no detached serve)")
  }
}
