import { appendFile, mkdirSync } from "node:fs"
import path from "node:path"

let logIdCounter = 1

export function writeLogLine(worktree: string, level: string, message: string, extra?: Record<string, unknown>) {
  try {
    const logDir = path.join(worktree, ".opencode/data/log")
    mkdirSync(logDir, { recursive: true })
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    mkdirSync(path.join(logDir, "payloads"), { recursive: true })

    const entry: Record<string, unknown> = {
      id: `l-${String(logIdCounter++).padStart(4, "0")}`,
      caller: "renderer",
      ts: new Date().toISOString().split(".")[0],
      level: level.toUpperCase(),
      message,
    }

    if (extra && Object.keys(extra).length > 0) {
      const payload = JSON.stringify(extra)
      if (payload.length > 100) {
        const pid = `l-${String(logIdCounter).padStart(4, "0")}`
        entry.payload_id = pid
        appendFile(path.join(logDir, "payloads", `${pid}.json`), payload, noop)
      } else {
        entry.payload = extra
      }
    }

    const date = new Date().toISOString().split(".")[0].replace(/:/g, "")
    appendFile(path.join(logDir, `${date}.log`), JSON.stringify(entry) + "\n", noop)
  } catch {
    // log write failure — silently ignore
  }
}

function noop() {}
