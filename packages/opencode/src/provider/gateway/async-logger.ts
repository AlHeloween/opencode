import fs from "fs/promises"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "gateway.async-logger" })

export interface AsyncLogger {
  log: (entry: Record<string, unknown>) => void
  flush: () => Promise<void>
  dispose: () => Promise<void>
}

export function make(input: {
  path: string
  maxBuffer?: number
  intervalMs?: number
  maxBytes?: number
  keepBytes?: number
}): AsyncLogger {
  const maxBuffer = input.maxBuffer ?? 1000
  const intervalMs = input.intervalMs ?? 100
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
        await fs.writeFile(input.path, tail ? tail.replace(/\n*$/, "\n") : "")
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
      await fs.appendFile(input.path, batch.join("\n") + "\n")
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
