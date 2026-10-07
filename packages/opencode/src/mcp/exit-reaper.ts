/**
 * Last-chance reaper: every local stdio MCP server's process TREE ends with this process, whatever exit it
 * takes.
 *
 * The MCP state finalizer (`mcp/index.ts`, `killTree`) runs when the instance is disposed — and a
 * `process.exit()` skips every finalizer. `opencode run` exits 1 straight from `execute` on a session error,
 * and codegraph's `serve --mcp` is only a proxy to a DETACHED per-project daemon that outlives its last client
 * by 300 s (codegraph `mcp/daemon.js` DEFAULT_IDLE_TIMEOUT_MS). Measured 2026-10-07 on the compiled candidate:
 * after a provider error the daemon `serve --mcp --path <workspace>` and its watchdog were alive 15 s after the
 * robot exited, holding the workspace (experiments_history/2026-10-07_codegraph-mcp-orphan/). The daemon is still a
 * descendant of the live server process here, so walking the tree from the server pid reaches it.
 *
 * The `exit` event fires on every exit that is not a hard kill and admits only synchronous work — hence
 * spawnSync. A transport whose process already closed reports `pid === null` and is skipped, so a reused pid is
 * never shot.
 */
import { spawnSync } from "child_process"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "mcp.exit-reaper" })

type Tracked = { readonly pid: number | null }

const live = new Set<Tracked>()
let armed = false

export function killTreeSync(pid: number) {
  if (process.platform === "win32") {
    // /T walks the tree by parent pid, which reaches a detached grandchild as long as its parent is alive.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
    return
  }
  const pids = [pid]
  for (let i = 0; i < pids.length; i++) {
    const out = spawnSync("pgrep", ["-P", String(pids[i])], { encoding: "utf8" }).stdout ?? ""
    pids.push(
      ...out
        .split("\n")
        .map((tok) => parseInt(tok, 10))
        .filter((n) => !Number.isNaN(n) && !pids.includes(n)),
    )
  }
  for (const p of pids) {
    try {
      process.kill(p, "SIGTERM")
    } catch (err) {
      log.debug("mcp exit-reaper kill failed", { pid: p, error: err })
    }
  }
}

function reap() {
  for (const t of live) {
    if (t.pid !== null) killTreeSync(t.pid)
  }
  live.clear()
}

/** Register a STARTED stdio transport; its process tree is killed when this process exits. */
export function track(transport: Tracked) {
  for (const t of live) if (t.pid === null) live.delete(t)
  live.add(transport)
  if (armed) return
  armed = true
  process.on("exit", reap)
}

export * as ExitReaper from "./exit-reaper"
