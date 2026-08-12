import fs from "fs/promises"
import { EOL } from "os"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "gateway.async-logger" })

export interface AsyncLogger {
  log: (entry: Record<string, unknown>) => void
  flush: () => Promise<void>
  dispose: () => Promise<void>
}

export interface PerRequestLogger {
  log: (entry: Record<string, unknown>) => void
  dispose: () => Promise<void>
}

export function readableBody(body: unknown) {
  if (typeof body !== "string") return body
  if (!body.trimStart().startsWith("{")) return body
  try {
    return JSON.parse(body) as unknown
  } catch (error) {
    log.debug("failed to format gateway request body", {
      error: error instanceof Error ? error.message : String(error),
    })
    return body
  }
}

/**
 * Format response body for logging. For SSE streams, split into data: lines
 * without JSON-parsing (preserves \uXXXX escapes). For non-streams, delegate to readableBody.
 */
export function readableResponseBody(body: unknown, isStream: boolean): unknown {
  if (typeof body !== "string") return body
  if (!isStream) return readableBody(body)

  const chunks: string[] = []
  const lines = body.split("\n")
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const json = line.slice(6)
      if (json === "[DONE]") continue
      chunks.push(json)
    }
  }
  return chunks.length > 0 ? chunks : body
}

/**
 * Attempt to format a JSON string for readability while preserving original for fidelity.
 * Returns { formatted, raw } — formatted has line breaks, raw preserves \uXXXX.
 */
function formatBodyForLog(raw: string): { formatted: unknown; raw: string } {
  try {
    return { formatted: JSON.parse(raw) as unknown, raw }
  } catch {
    return { formatted: raw, raw }
  }
}

export function formatPerRequestEntry(entry: Record<string, unknown>) {
  const result = { ...entry }
  // If body is a string, provide both formatted (parsed, readable) and raw (unicode-preserved)
  if (typeof result.body === "string" && (result.body as string).trimStart().startsWith("{")) {
    const { formatted, raw } = formatBodyForLog(result.body as string)
    result.body = formatted
    result.body_raw = raw
  }
  return JSON.stringify(result, null, 2).replace(/\n/g, EOL)
}

export function make(input: {
  path: string
  maxBuffer?: number
  intervalMs?: number
  maxBytes?: number
  keepBytes?: number
}): AsyncLogger {
  const maxBuffer = input.maxBuffer ?? 1000
  const intervalMs = input.intervalMs ?? 500
  const maxBytes = input.maxBytes
  const keepBytes = input.keepBytes
  const queue: string[] = []
  let disposed = false
  let timer: ReturnType<typeof setInterval> | null = null
  let flushing = false

  const trim = async () => {
    if (!maxBytes || !keepBytes) return
    try {
      const stat = await fs.stat(input.path)
      if (stat.size <= maxBytes) return
      const len = Math.min(keepBytes, stat.size)
      const fh = await fs.open(input.path, "r")
      try {
        const buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, Math.max(0, stat.size - len))
        const raw = buf.toString("utf8")
        const idx = raw.indexOf("\n")
        const tail = idx === -1 ? raw : raw.slice(idx + 1)
        await fs.writeFile(input.path, tail ? tail.replace(/[\r\n]+$/, "") + EOL : "")
      } finally {
        await fh.close().catch((e) => { log.debug("failed to close file handle", { error: e instanceof Error ? e.message : String(e) }) })
      }
    } catch (e) {
      log.debug("failed to trim log file", { error: e instanceof Error ? e.message : String(e) })
    }
  }

  const flush = async () => {
    if (flushing) return
    if (queue.length === 0) return
    flushing = true
    const batch = queue.splice(0, maxBuffer)
    try {
      await fs.appendFile(input.path, batch.join(EOL) + EOL)
      await trim()
    } catch (e) {
      log.debug("failed to flush log entries", { error: e instanceof Error ? e.message : String(e) })
    }
    flushing = false
  }

  const finalFlush = async () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    await flush()
  }

  timer = setInterval(async () => {
    if (disposed) {
      finalFlush()
      return
    }
    await flush()
  }, intervalMs)

  return {
    log: (entry) => {
      const line = JSON.stringify(entry)
      queue.push(line)
      if (queue.length > maxBuffer * 2) {
        const excess = queue.length - maxBuffer
        queue.splice(0, excess)
      }
    },
    flush: () => flush(),
    dispose: () => finalFlush(),
  }
}

/**
 * Per-request logger that writes each gateway request to its own file.
 * Files are named `{time_ms}_req_{requestId}.json` under the configured directory.
 * Best-effort: write failures are logged to debug and silently ignored.
 */
export function makePerRequest(input: { dir: string }): PerRequestLogger {
  const dir = input.dir
  let disposed = false
  const pending = new Set<Promise<void>>()

  const ensureDir = (async () => {
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (e) {
      log.debug("failed to create per-request log dir", {
        error: e instanceof Error ? e.message : String(e),
        dir,
      })
    }
  })()

  return {
    log: (entry) => {
      if (disposed) return
      const ts = (entry.timestamp as number) ?? Date.now()
      const reqId = (entry.requestId as string) ?? "unknown"
      const sanitized = String(reqId).replace(/[^a-zA-Z0-9_-]/g, "-")
      const fileName = `${ts}_req_${sanitized}.json`
      const filePath = path.join(dir, fileName)

      const write = ensureDir.then(() =>
        fs.writeFile(filePath, formatPerRequestEntry(entry)).catch((e) => {
          log.debug("failed to write per-request log", {
            error: e instanceof Error ? e.message : String(e),
            filePath,
          })
        }),
      )

      pending.add(write)
      write.finally(() => pending.delete(write))
    },
    dispose: async () => {
      disposed = true
      await Promise.all(pending)
    },
  }
}
