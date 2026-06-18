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

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "-")
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
  const now = Date.now()
  const entry = JSON.stringify({
    id: `l-${String(logIdCounter++).padStart(4, "0")}`,
    time_ms: now,
    ts: new Date(now).toISOString(),
    op: "log",
    level: "DEBUG",
    message: `dedup flush: ${totalSuppressed} entries suppressed (${uniqueKeys} unique keys in ${DEDUP_WINDOW_MS}ms)`,
    model: "system",
    session_id: "internal",
    caller: "renderer:dedup",
  }) + "\n"
  const filename = `${now}_log_system_internal.jsonl`
  appendFile(path.join(logDir, filename), entry, noop)
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
      dirsCreated = true
    }

    const now = Date.now()
    const model = (extra?.model as string) || "system"
    const sessionID = (extra?.session_id as string) || "internal"

    const entry: Record<string, unknown> = {
      id: `l-${String(logIdCounter++).padStart(4, "0")}`,
      time_ms: now,
      ts: new Date(now).toISOString(),
      op: "log",
      level: upperLevel,
      message,
      model: sanitize(model),
      session_id: sanitize(sessionID),
      caller: "renderer",
    }

    if (extra && Object.keys(extra).length > 0) {
      const dedupSafe = { ...extra }
      delete dedupSafe.caller
      delete dedupSafe.model
      delete dedupSafe.session_id
      if (Object.keys(dedupSafe).length > 0) {
        const payload = JSON.stringify(dedupSafe)
        if (payload.length > 500) {
          const pid = new Date().toISOString().replace(/:/g, "").replace("Z", "")
          entry.payload_id = pid
          const payloadName = `${now}_payload_${sanitize(model)}_${sanitize(sessionID)}_${pid}.json`
          appendFile(path.join(logDir, payloadName), payload, noop)
        } else {
          entry.payload = dedupSafe
        }
      }
    }

    const filename = `${now}_log_${sanitize(model)}_${sanitize(sessionID)}.jsonl`
    appendFile(path.join(logDir, filename), JSON.stringify(entry) + "\n", noop)
  } catch {
    // log write failure — silently ignore
  }
}

function noop() {}
