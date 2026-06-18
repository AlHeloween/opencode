import path from "path"
import fs from "fs/promises"
import { createWriteStream, mkdirSync, type WriteStream } from "fs"
import * as Global from "../global"
import z from "zod"

export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
export type Level = z.infer<typeof Level>

const keep = 100

export type Logger = {
  debug(message?: any, extra?: Record<string, any>): void
  info(message?: any, extra?: Record<string, any>): void
  error(message?: any, extra?: Record<string, any>): void
  warn(message?: any, extra?: Record<string, any>): void
  tag(key: string, value: string): Logger
  clone(): Logger
  time(
    message: string,
    extra?: Record<string, any>,
  ): {
    stop(): void
    [Symbol.dispose](): void
  }
}

const loggers = new Map<string, Logger>()

export const Default = create({ service: "default" })

export interface Options {
  print?: boolean
}

const bugEntries = new Map<string, { id: string; message: string; count: number; payloads: unknown[] }>()
let nextBugId = 1

export function bugReport() {
  return [...bugEntries.values()]
    .map((b) => ({ id: b.id, message: b.message.replace(/^bug: /, ""), count: b.count, payloads: b.payloads }))
    .sort((a, b) => a.message.localeCompare(b.message))
}

function collectBug(key: string, message: string, extra?: Record<string, any>) {
  const existing = bugEntries.get(key)
  if (existing) {
    existing.count++
    if (extra) existing.payloads.push(extra)
  } else {
    bugEntries.set(key, {
      id: "bug-" + String(nextBugId++).padStart(4, "0"),
      message,
      count: 1,
      payloads: extra ? [extra] : [],
    })
  }
}

export function file() {
  return Global.Path.log
}

const _stderr = (msg: any) => {
  process.stderr.write(msg)
  return msg.length
}
let printLogs = false

// ── Flat file routing ─────────────────────────────────────────────────────────────
//
// All log/diff/payload files live in a single flat log/ directory.
// Naming: {time_ms}_{operation}_{model}_{session_id}.{ext}
//
// Streams are created lazily per (model, session_id, operation) tuple.
// The timestamp in the filename is the first-write time for that stream.

const contextStreams = new Map<string, WriteStream>()

/** Sanitize a string for safe use in filenames. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "-")
}

/** Build a flat-named log file path. */
export function logPath(op: "log" | "diff" | "payload", model: string, sessionID: string, ext: string, suffix?: string): string {
  const safeModel = sanitize(model || "system")
  const safeSid = sanitize(sessionID || "internal")
  const base = `${Date.now()}_${op}_${safeModel}_${safeSid}`
  const name = suffix ? `${base}_${suffix}.${ext}` : `${base}.${ext}`
  return path.join(Global.Path.log, name)
}

/** Stream key for deduplicating open file handles. */
function streamKey(model: string, sessionID: string, op: string): string {
  return `${sanitize(model)}:${sanitize(sessionID || "internal")}:${op}`
}

/** Get or create a write stream for the given (model, session_id, operation) context. */
function getOrCreateStream(model: string, sessionID: string, op: "log" | "diff" | "payload", ext: string): WriteStream {
  const key = streamKey(model, sessionID, op)
  const existing = contextStreams.get(key)
  if (existing) return existing
  const filepath = logPath(op, model, sessionID, ext)
  mkdirSync(Global.Path.log, { recursive: true })
  const stream = createWriteStream(filepath, { flags: "a" })
  contextStreams.set(key, stream)
  return stream
}

/** Close all streams for a given session. */
export function closeStreams(sessionID: string): void {
  const safeSid = sanitize(sessionID)
  for (const [key, stream] of contextStreams) {
    if (key.includes(`:${safeSid}:`)) {
      stream.end()
      contextStreams.delete(key)
    }
  }
}

/** Close all context streams (shutdown). */
function closeAllStreams(): void {
  for (const [, stream] of contextStreams) {
    stream.end()
  }
  contextStreams.clear()
}

// Backward-compat: initSession / closeSession removed; use closeStreams instead.
// These are intentionally absent — callers must migrate to the flat naming model.

function logError(msg: string, extra?: Record<string, any>) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    message: msg,
    ...extra,
  }) + "\n"
  fs.appendFile(path.join(Global.Path.log, "LoggerErrors.log"), entry).catch((e) => {
    process.stderr.write(`LoggerErrors.log write failed: ${String(e)}\n`)
  })
}

// ── Deduplication ──────────────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 5000
const dedupState = new Map<string, { count: number; firstId: string; firstTs: string }>()
let dedupTimer: ReturnType<typeof setInterval> | undefined

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
  const now = Date.now()
  const entry = JSON.stringify({
    id: `l-${String(nextLogId++).padStart(4, "0")}`,
    time_ms: now,
    ts: new Date(now).toISOString(),
    op: "log",
    level: "DEBUG",
    message: `dedup flush: ${totalSuppressed} entries suppressed (${uniqueKeys} unique keys in ${DEDUP_WINDOW_MS}ms)`,
    model: "system",
    session_id: "internal",
    caller: "log.ts:dedup",
  }) + "\n"
  const stream = getOrCreateStream("system", "internal", "log", "jsonl")
  stream.write(entry, (err) => {
    if (err) logError("dedup flush write failed", { error: String(err) })
  })
  if (printLogs) _stderr(entry)
  dedupState.clear()
}

function tryDedup(key: string): boolean {
  const existing = dedupState.get(key)
  if (existing) {
    existing.count++
    return true
  }
  return false
}

function canDedup(level: Level, message: string): boolean {
  if (level === "ERROR") return false
  if (typeof message === "string" && message.startsWith("bug:")) return false
  return true
}

// ── Initialization ─────────────────────────────────────────────────────────────────

export async function init(options: Options = {}) {
  printLogs = options.print ?? false
  await cleanup(Global.Path.log)
  mkdirSync(Global.Path.log, { recursive: true })
  // Close any previous streams
  closeAllStreams()
  flushDedup()
  if (dedupTimer) clearInterval(dedupTimer)
  dedupTimer = setInterval(flushDedup, DEDUP_WINDOW_MS)
  dedupTimer.unref?.()
}

export async function reopen() {
  printLogs = printLogs // preserve
  mkdirSync(Global.Path.log, { recursive: true })
  closeAllStreams()
  flushDedup()
  if (dedupTimer) clearInterval(dedupTimer)
  dedupTimer = setInterval(flushDedup, DEDUP_WINDOW_MS)
  dedupTimer.unref?.()
}

async function cleanup(dir: string) {
  // Match flat-named files: {13-digit-ms}_{op}_{model}_{session_id}.{ext}
  const pattern = /^\d{13}_(log|diff|payload)_.+\.(jsonl|diff|json)$/
  let files: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    files = entries
      .filter((e) => e.isFile() && pattern.test(e.name))
      .map((e) => e.name)
      .sort()
  } catch {
    collectBug("log.ts:cleanup", "bug: failed to scan log files during cleanup [core/log]")
    return
  }
  if (files.length <= keep) return

  const doomed = files.slice(0, -keep)
  await Promise.all(doomed.map((file) => fs.unlink(path.join(dir, file)).catch(() => {
    collectBug("log.ts:cleanup", "bug: failed to unlink old log file [core/log]")
  })))
}

// ── Log entry building ─────────────────────────────────────────────────────────────

let nextLogId = 1

function getCaller(): string | undefined {
  try {
    const stack = new Error().stack?.split("\n")
    if (!stack) return undefined
    for (let i = 1; i < stack.length; i++) {
      const frame = stack[i]
      if (!frame) continue
      if (frame.includes("log.ts")) continue
      if (frame.includes("(native") || frame.includes("moduleEvaluation") || frame.includes("loadAndEvaluateModule")) continue
      const fileMatch = frame.match(/\(([^)]+)\)/) || frame.match(/at\s+(.+)/)
      const location = fileMatch?.[1]
      const parsed = location?.match(/(.+):(\d+):(\d+)/)
      if (parsed) {
        const file = parsed[1].split(/[\\/]/).pop()
        return `${file}:${parsed[2]}`
      }
    }
  } catch {
    logError("getCaller stack parsing failed")
  }
}

/** Resolve model from tags or extra context. Falls back to "system". */
function resolveModel(tags?: Record<string, any>, extra?: Record<string, any>): string {
  return (tags?.["model"] ?? tags?.["modelID"] ?? extra?.["model"] ?? extra?.["modelID"] ?? "system") as string
}

/** Resolve session ID from tags or extra context. Falls back to "internal". */
function resolveSessionID(tags?: Record<string, any>, extra?: Record<string, any>): string {
  return (tags?.["session.id"] ?? tags?.["session_id"] ?? extra?.["session.id"] ?? extra?.["session_id"] ?? "internal") as string
}

function serializePayload(extra: Record<string, any>, model: string, sessionID: string): { payloadJson?: string; payload_id?: string } {
  const json = JSON.stringify(extra)
  if (json.length <= 500) return { payloadJson: json }
  const now = new Date()
  const pid = now.toISOString().replace(/:/g, "").replace("Z", "")
  const payloadPath = logPath("payload", model, sessionID, "json", pid)
  fs.writeFile(payloadPath, json).catch((e) => {
    logError("payload write failed", { path: payloadPath, error: String(e) })
  })
  return { payload_id: pid }
}

export function create(tags?: Record<string, any>) {
  tags = tags || {}

  const service = tags["service"]
  if (service && typeof service === "string") {
    const cached = loggers.get(service)
    if (cached) return cached
  }

  function build(level: Level, message: any, extra?: Record<string, any>, caller?: string) {
    const now = Date.now()
    const id = `l-${String(nextLogId++).padStart(4, "0")}`
    const resolvedCaller = caller ?? getCaller()
    const model = resolveModel(tags, extra)
    const sessionID = resolveSessionID(tags, extra)
    const entry: Record<string, any> = {
      id,
      time_ms: now,
      ts: new Date(now).toISOString(),
      op: "log",
      level,
      message,
      model,
      session_id: sessionID,
    }
    if (resolvedCaller) entry.caller = resolvedCaller
    if (tags && Object.keys(tags).length > 0) {
      // Include service and other tags (but not internal routing keys already in entry)
      for (const [key, value] of Object.entries(tags)) {
        if (key === "model" || key === "modelID" || key === "session.id" || key === "session_id") continue
        entry[key] = value
      }
    }
    let result = JSON.stringify(entry) + "\n"
    if (extra) {
      const { payloadJson, payload_id } = serializePayload(extra, model, sessionID)
      if (payloadJson) {
        entry.payload = JSON.parse(payloadJson)
        result = JSON.stringify(entry) + "\n"
        return result
      }
      if (payload_id) {
        entry.payload_id = payload_id
        result = JSON.stringify(entry) + "\n"
        return result
      }
    }
    return result
  }

  const routeWrite = (entry: string, extra?: Record<string, any>): void => {
    const model = resolveModel(tags, extra)
    const sessionID = resolveSessionID(tags, extra)
    if (printLogs) _stderr(entry)
    const stream = getOrCreateStream(model, sessionID, "log", "jsonl")
    stream.write(entry, (err) => {
      if (err) logError("log stream write failed", { model, sessionID, error: String(err) })
    })
  }

  const result: Logger = {
    debug(message?: any, extra?: Record<string, any>) {
      const msg = String(message ?? "")
      let caller: string | undefined
      if (canDedup("DEBUG", msg)) {
        caller = getCaller()
        const key = `${caller}|DEBUG|${msg}`
        if (dedupState.has(key)) { tryDedup(key); return }
        dedupState.set(key, { count: 1, firstId: "", firstTs: new Date().toISOString() })
      }
      routeWrite(build("DEBUG", message, extra, caller), extra)
    },
    info(message?: any, extra?: Record<string, any>) {
      const msg = String(message ?? "")
      let caller: string | undefined
      if (canDedup("INFO", msg)) {
        caller = getCaller()
        const key = `${caller}|INFO|${msg}`
        if (dedupState.has(key)) { tryDedup(key); return }
        dedupState.set(key, { count: 1, firstId: "", firstTs: new Date().toISOString() })
      }
      routeWrite(build("INFO", message, extra, caller), extra)
    },
    error(message?: any, extra?: Record<string, any>) {
      routeWrite(build("ERROR", message, extra), extra)
    },
    warn(message?: any, extra?: Record<string, any>) {
      if (typeof message === "string" && message.startsWith("bug:")) {
        const caller = getCaller() ?? "unknown"
        const key = caller + " " + message
        collectBug(key, message, extra)
      }
      routeWrite(build("WARN", message, extra), extra)
    },
    tag(key: string, value: string) {
      if (tags) tags[key] = value
      return result
    },
    clone() {
      return create({ ...tags })
    },
    time(message: string, extra?: Record<string, any>) {
      const now = Date.now()
      result.info(message, { status: "started", ...extra })
      function stop() {
        result.info(message, {
          status: "completed",
          duration: Date.now() - now,
          ...extra,
        })
      }
      return {
        stop,
        [Symbol.dispose]() {
          stop()
        },
      }
    },
  }

  if (service && typeof service === "string") {
    loggers.set(service, result)
  }

  return result
}
