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

// ——— CodeGraph auto-init (simple spawn, no Effect services needed) ———

function initCodeGraphBg(): void {
  const dir = Global.Path.worktree || Global.Path.home
  const dbPath = path.join(dir, ".codegraph", "codegraph.db")

  try {
    if (require("fs").existsSync(dbPath)) return // already initialized
  } catch { /* ignore */ }

  // Find codegraph binary
  const isWin = process.platform === "win32"
  const cgName = `codegraph${isWin ? ".exe" : ""}`
  const execDir = path.dirname(process.execPath)
  const candidates = [
    path.join(execDir, "..", "node_modules", ".bin", cgName),
    path.join(Global.Path.home, "node_modules", ".bin", cgName),
    cgName,
  ]

  let cgBin = ""
  for (const c of candidates) {
    try { if (require("fs").existsSync(c)) { cgBin = c; break } } catch { cgBin = c; break }
  }
  if (!cgBin) return

  const child = spawn(cgBin, ["init", "--no-daemon"], { cwd: dir, stdio: "ignore", timeout: 120000 })
  child.on("error", () => { /* codegraph init failed silently — non-critical */ })
  child.unref()
}
