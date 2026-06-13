import path from "path"
import fs from "fs/promises"
import { createWriteStream, mkdirSync, type WriteStream } from "fs"
import * as Global from "../global"
import z from "zod"
import { Glob } from "./glob"

export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
export type Level = z.infer<typeof Level>

const keep = 10

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

let logpath = ""
export function file() {
  return logpath
}
const _stderr = (msg: any) => {
  process.stderr.write(msg)
  return msg.length
}
let write: (msg: any) => number | Promise<number> = _stderr
let printLogs = false

// Per-session log file routing — mirrors diffs/ layout:
//   log/{sessionID}/{ISO8601-start}.log
const sessionStreams = new Map<string, { logpath: string; stream: WriteStream }>()

export function initSession(sessionID: string): void {
  if (sessionStreams.has(sessionID)) return
  const dir = path.join(Global.Path.log, sessionID)
  mkdirSync(dir, { recursive: true })
  const spath = path.join(dir, new Date().toISOString().replace(/:/g, "").replace("Z", "") + ".log")
  const stream = createWriteStream(spath, { flags: "a" })
  sessionStreams.set(sessionID, { logpath: spath, stream })
}

export function closeSession(sessionID: string): void {
  const s = sessionStreams.get(sessionID)
  if (s) {
    s.stream.end()
    sessionStreams.delete(sessionID)
  }
}

function sessionWrite(sessionID: string, entry: string): void {
  const s = sessionStreams.get(sessionID)
  if (s) {
    s.stream.write(entry, (err) => {
      if (err) logError("session log write failed", { sessionID, error: String(err) })
    })
  }
}

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
  const entry = JSON.stringify({
    id: `l-${String(nextLogId++).padStart(4, "0")}`,
    caller: "log.ts:dedup",
    ts: new Date().toISOString(),
    level: "DEBUG",
    message: `dedup flush: ${totalSuppressed} entries suppressed (${uniqueKeys} unique keys in ${DEDUP_WINDOW_MS}ms)`,
  }) + "\n"
  write(entry)
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

export async function init(options: Options = {}) {
  printLogs = options.print ?? false
  void cleanup(Global.Path.log)
  logpath = path.join(
    Global.Path.log,
    new Date().toISOString().replace(/:/g, "").replace("Z", "") + ".log",
  )
  mkdirSync(Global.Path.log, { recursive: true })
  mkdirSync(path.join(Global.Path.log, "payloads"), { recursive: true })
  const stream = createWriteStream(logpath, { flags: "a" })
  const fileWrite = async (msg: any) => {
    return new Promise((resolve, reject) => {
      stream.write(msg, (err) => {
        if (err) reject(err)
        else resolve(msg.length)
      })
    })
  }
  write = printLogs
    ? (msg: any) => { const r = _stderr(msg); fileWrite(msg).catch((e) => logError("fileWrite failed", { error: String(e) })); return r }
    : fileWrite
  flushDedup()
  if (dedupTimer) clearInterval(dedupTimer)
  dedupTimer = setInterval(flushDedup, DEDUP_WINDOW_MS)
  dedupTimer.unref?.()
}

export async function reopen() {
  if (write === _stderr && !printLogs) return
  logpath = path.join(
    Global.Path.log,
    new Date().toISOString().replace(/:/g, "").replace("Z", "") + ".log",
  )
  mkdirSync(Global.Path.log, { recursive: true })
  mkdirSync(path.join(Global.Path.log, "payloads"), { recursive: true })
  const stream = createWriteStream(logpath, { flags: "a" })
  const fileWrite = async (msg: any) => {
    return new Promise((resolve, reject) => {
      stream.write(msg, (err) => {
        if (err) reject(err)
        else resolve(msg.length)
      })
    })
  }
  write = printLogs
    ? (msg: any) => { const r = _stderr(msg); fileWrite(msg).catch((e) => logError("reopen fileWrite failed", { error: String(e) })); return r }
    : fileWrite
  flushDedup()
  if (dedupTimer) clearInterval(dedupTimer)
  dedupTimer = setInterval(flushDedup, DEDUP_WINDOW_MS)
  dedupTimer.unref?.()
}

async function cleanup(dir: string) {
  const files = (
    await Glob.scan("????-??-??T??????.log", {
      cwd: dir,
      absolute: false,
      include: "file",
    }).catch(() => {
      collectBug("log.ts:cleanup", "bug: failed to scan log files during cleanup [core/log]")
      return []
    })
  )
    .filter((file) => path.basename(file) === file)
    .sort()
  if (files.length <= keep) return

  const doomed = files.slice(0, -keep)
  await Promise.all(doomed.map((file) => fs.unlink(path.join(dir, file)).catch(() => {
    collectBug("log.ts:cleanup", "bug: failed to unlink old log file [core/log]")
  })))
}

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

function serializePayload(extra: Record<string, any>): { payloadJson?: string; payload_id?: string } {
  const json = JSON.stringify(extra)
  if (json.length <= 500) return { payloadJson: json }
  const now = new Date()
  const id = now.toISOString().replace(/:/g, "").replace("Z", "")
  const payloadPath = path.join(Global.Path.log, "payloads", `${id}.json`)
  fs.writeFile(payloadPath, json).catch((e) => {
    logError("payload write failed", { path: payloadPath, error: String(e) })
  })
  return { payload_id: id }
}

export function create(tags?: Record<string, any>) {
  tags = tags || {}

  const service = tags["service"]
  if (service && typeof service === "string") {
    const cached = loggers.get(service)
    if (cached) return cached
  }

  function build(level: Level, message: any, extra?: Record<string, any>, caller?: string) {
    const id = `l-${String(nextLogId++).padStart(4, "0")}`
    const resolvedCaller = caller ?? getCaller()
    const ts = new Date().toISOString()
    const entry: Record<string, any> = { id, ts, level, message }
    if (resolvedCaller) entry.caller = resolvedCaller
    if (tags && Object.keys(tags).length > 0) Object.assign(entry, tags)
    let result = JSON.stringify(entry) + "\n"
    if (extra) {
      const { payloadJson, payload_id } = serializePayload(extra)
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

  const sidTag = (tags?.["session.id"] ?? tags?.["session_id"]) as string | undefined

  const routeWrite = (entry: string, extra?: Record<string, any>): void => {
    const sid = (sidTag ?? extra?.["session.id"] ?? extra?.["session_id"]) as string | undefined
    write(entry)
    if (sid) sessionWrite(sid, entry)
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
