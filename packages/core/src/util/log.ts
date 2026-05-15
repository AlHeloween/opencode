import path from "path"
import fs from "fs/promises"
import { createWriteStream, mkdirSync } from "fs"
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

export async function init(options: Options = {}) {
  printLogs = options.print ?? false
  void cleanup(Global.Path.log)
  logpath = path.join(
    Global.Path.log,
    new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
  )
  await fs.truncate(logpath).catch(() => {
    collectBug("log.ts:init", "bug: failed to truncate log file [core/log]")
  })
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
    ? (msg: any) => { const r = _stderr(msg); fileWrite(msg).catch(() => {}); return r }
    : fileWrite
}

export async function reopen() {
  if (write === _stderr && !printLogs) return
  logpath = path.join(
    Global.Path.log,
    new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
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
    ? (msg: any) => { const r = _stderr(msg); fileWrite(msg).catch(() => {}); return r }
    : fileWrite
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
  } catch {}
}

function serializePayload(extra: Record<string, any>): { payload?: object; payload_id?: string } {
  const json = JSON.stringify(extra)
  if (json.length <= 100) return { payload: extra }
  const id = `l-${String(nextLogId).padStart(4, "0")}`
  const payloadPath = path.join(Global.Path.log, "payloads", `${id}.json`)
  fs.writeFile(payloadPath, json).catch(() => {})
  return { payload_id: id }
}

export function create(tags?: Record<string, any>) {
  tags = tags || {}

  const service = tags["service"]
  if (service && typeof service === "string") {
    const cached = loggers.get(service)
    if (cached) return cached
  }

  function build(level: Level, message: any, extra?: Record<string, any>) {
    const id = `l-${String(nextLogId++).padStart(4, "0")}`
    const caller = getCaller()
    const ts = new Date().toISOString().split(".")[0]
    const entry: Record<string, any> = { id, ts, level, message }
    if (caller) entry.caller = caller
    if (tags && Object.keys(tags).length > 0) Object.assign(entry, tags)
    if (extra) {
      const { payload, payload_id } = serializePayload(extra)
      if (payload) entry.payload = payload
      if (payload_id) entry.payload_id = payload_id
    }
    return JSON.stringify(entry) + "\n"
  }

  const result: Logger = {
    debug(message?: any, extra?: Record<string, any>) {
      write(build("DEBUG", message, extra))
    },
    info(message?: any, extra?: Record<string, any>) {
      write(build("INFO", message, extra))
    },
    error(message?: any, extra?: Record<string, any>) {
      write(build("ERROR", message, extra))
    },
    warn(message?: any, extra?: Record<string, any>) {
      if (typeof message === "string" && message.startsWith("bug:")) {
        const caller = getCaller() ?? "unknown"
        const key = caller + " " + message
        collectBug(key, message, extra)
      }
      write(build("WARN", message, extra))
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
