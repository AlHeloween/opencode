import { appendFile, mkdirSync } from "node:fs"
import path from "node:path"

let logIdCounter = 1

const DEDUP_WINDOW_MS = 5000
const dedupState = new Map<string, { count: number }>()
let dedupTimer: ReturnType<typeof setInterval> | undefined

function startDedupTimer() {
  if (dedupTimer) clearInterval(dedupTimer)
  dedupTimer = setInterval(flushDedup, DEDUP_WINDOW_MS)
}

function flushDedup() {
  if (dedupState.size === 0) return
  let totalSuppressed = 0
  let uniqueKeys = 0
  for (const [, state] of dedupState) {
    if (state.count > 1) {
      totalSuppressed += state.count - 1
      uniqueKeys++
    }
  }
  if (totalSuppressed === 0) { dedupState.clear(); return }
  const worktree = process.cwd()
  const logDir = path.join(worktree, ".opencode/data/log")
  const entry = JSON.stringify({
    id: `l-${String(logIdCounter++).padStart(4, "0")}`,
    caller: "renderer:dedup",
    ts: new Date().toISOString(),
    level: "DEBUG",
    message: `dedup flush: ${totalSuppressed} entries suppressed (${uniqueKeys} unique keys in ${DEDUP_WINDOW_MS}ms)`,
  }) + "\n"
  const date = new Date().toISOString().split(".")[0].replace(/:/g, "")
  appendFile(path.join(logDir, `${date}.log`), entry, noop)
  dedupState.clear()
}

let dirsCreated = false

startDedupTimer()

export function writeLogLine(worktree: string, level: string, message: string, extra?: Record<string, unknown>) {
  try {
    const upperLevel = level.toUpperCase()
    if (upperLevel !== "ERROR" && !(typeof message === "string" && message.startsWith("bug:"))) {
      const caller = extra?.caller ? String(extra.caller) : "renderer"
      const key = `${caller}|${upperLevel}|${message}`
      const existing = dedupState.get(key)
      if (existing) {
        existing.count++
        return
      }
      dedupState.set(key, { count: 1 })
    }

    const logDir = path.join(worktree, ".opencode/data/log")
    if (!dirsCreated) {
      mkdirSync(logDir, { recursive: true })
      mkdirSync(path.join(logDir, "payloads"), { recursive: true })
      dirsCreated = true
    }

    const entry: Record<string, unknown> = {
      id: `l-${String(logIdCounter++).padStart(4, "0")}`,
      caller: "renderer",
      ts: new Date().toISOString(),
      level: upperLevel,
      message,
    }

    if (extra && Object.keys(extra).length > 0) {
      const dedupSafe = { ...extra }
      delete dedupSafe.caller
      if (Object.keys(dedupSafe).length === 0) {
        // no payload to write
      } else {
        const payload = JSON.stringify(dedupSafe)
        if (payload.length > 500) {
          const pid = new Date().toISOString().replace(/:/g, "").replace("Z", "")
          entry.payload_id = pid
          appendFile(path.join(logDir, "payloads", `${pid}.json`), payload, noop)
        } else {
          entry.payload = dedupSafe
        }
      }
    }

  const date = new Date().toISOString().replace(/:/g, "").replace("Z", "")
    appendFile(path.join(logDir, `${date}.log`), JSON.stringify(entry) + "\n", noop)
  } catch {
    // log write failure — silently ignore
  }
}

function noop() {}
