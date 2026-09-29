import http2 from "node:http2"
import { Readable } from "node:stream"
import * as Log from "@opencode-ai/core/util/log"
import type { MetricsResult } from "./metrics"
import * as M from "./metrics"
import { normalizeError, TransportError } from "./errors"
import type { NormalizedError } from "./errors"

const log = Log.create({ service: "gateway/h2" })

interface Waiter {
  resolve: () => void
  reject: (err: Error) => void
}

export interface H2Session {
  session: http2.ClientHttp2Session
  remoteMaxConcurrentStreams: number
  activeStreams: number
  createdAt: number
  lastUsedAt: number
  pingRttMs: number
}

/**
 * One warm pool per origin. Sessions are REUSED and never torn down on idle
 * (owner directive 2026-09-29: providers dislike dropped connections). A single
 * session carries at most the server's advertised maxConcurrentStreams — 128 on
 * api.deepseek.com, 100 on openrouter.ai (measured 2026-09-29) — so a large
 * concurrency ceiling is met by a POOL of kept-alive sessions, never by a fresh
 * connection per request.
 */
interface H2Pool {
  key: string
  baseUrl: string
  sessions: H2Session[]
  waitQueue: Waiter[]
  /** Session cap, derived from the caller's concurrency ceiling and the advertised
   *  per-session budget. Grows lazily, never shrinks; sessions are never evicted. */
  cap: number
}

const pools = new Map<string, H2Pool>()
/** Absolute guard against runaway dialing; the real cap comes from the ceiling. */
const HARD_MAX_SESSIONS_PER_ORIGIN = 64
/** A session idle longer than this gets one liveness ping before reuse. */
const H2_STALE_PING_MS = 30_000

function getPool(key: string, baseUrl: string): H2Pool {
  let pool = pools.get(key)
  if (!pool) {
    pool = { key, baseUrl, sessions: [], waitQueue: [], cap: 1 }
    pools.set(key, pool)
  }
  return pool
}

function pickSession(pool: H2Pool): H2Session | null {
  let best: H2Session | null = null
  for (const candidate of pool.sessions) {
    if (candidate.session.closed) continue
    if (candidate.activeStreams >= candidate.remoteMaxConcurrentStreams) continue
    if (!best || candidate.activeStreams < best.activeStreams) best = candidate
  }
  return best
}

function releaseSlot(pool: H2Pool, session: H2Session) {
  session.activeStreams = Math.max(0, session.activeStreams - 1)
  const next = pool.waitQueue.shift()
  if (next) next.resolve()
}

function rejectAllWaiters(pool: H2Pool, err: Error) {
  while (pool.waitQueue.length > 0) {
    pool.waitQueue.shift()!.reject(err)
  }
}

function removeSession(pool: H2Pool, session: H2Session) {
  session.activeStreams = 0
  pool.sessions = pool.sessions.filter((s) => s !== session)
}

async function acquireSlot(pool: H2Pool, concurrencyLimit: number | undefined): Promise<H2Session> {
  if (concurrencyLimit && concurrencyLimit > 0) {
    const perSession = pool.sessions.find((s) => !s.session.closed)?.remoteMaxConcurrentStreams ?? 100
    const wanted = Math.min(HARD_MAX_SESSIONS_PER_ORIGIN, Math.max(1, Math.ceil(concurrencyLimit / perSession)))
    if (wanted > pool.cap) pool.cap = wanted
  }
  for (;;) {
    const session = pickSession(pool)
    if (session) {
      if (Date.now() - session.lastUsedAt > H2_STALE_PING_MS) {
        const ok = await healthCheck(session, 3000)
        if (!ok) {
          log.debug("h2 health check failed — dropping session", { key: pool.key })
          removeSession(pool, session)
          session.session.close()
          continue
        }
      }
      session.activeStreams++
      session.lastUsedAt = Date.now()
      return session
    }
    const open = pool.sessions.filter((s) => !s.session.closed).length
    if (open < pool.cap) {
      const created = createSession(pool)
      if (created) {
        pool.sessions.push(created)
        created.activeStreams++
        return created
      }
      throw new Error("Failed to create H2 session")
    }
    await new Promise<void>((resolve, reject) => pool.waitQueue.push({ resolve, reject }))
  }
}

function getSessionKey(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    return `${url.protocol}//${url.hostname}:${url.port}`
  } catch {
    return baseUrl
  }
}

async function healthCheck(session: H2Session, timeoutMs: number): Promise<boolean> {
  try {
    const result = await Promise.race([
      new Promise<boolean>((resolve) => {
        session.session.ping((err) => {
          if (err) {
            log.debug("h2 health ping failed", { error: err.message })
            resolve(false)
          } else {
            resolve(true)
          }
        })
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ])
    return result
  } catch {
    return false
  }
}

function createSession(pool: H2Pool): H2Session | null {
  const url = new URL(pool.baseUrl)
  try {
    const session = http2.connect(pool.baseUrl)

    let remoteMaxStreams = 100
    let h2Session: H2Session | null = null

    session.on("remoteSettings", (settings: http2.Settings) => {
      if (settings.maxConcurrentStreams !== undefined) {
        remoteMaxStreams = settings.maxConcurrentStreams
        if (h2Session) h2Session.remoteMaxConcurrentStreams = settings.maxConcurrentStreams
        log.debug("h2 remote settings", {
          host: url.hostname,
          maxConcurrentStreams: remoteMaxStreams,
        })
      }
    })

    session.on("error", (err) => {
      log.debug("h2 session error", { host: url.hostname, error: err.message })
      if (h2Session) removeSession(pool, h2Session)
    })

    session.on("close", () => {
      if (h2Session) removeSession(pool, h2Session)
    })

    session.on("goaway", (errorCode, lastStreamID, opaqueData) => {
      log.debug("h2 goaway received", {
        host: url.hostname,
        errorCode,
        lastStreamID,
        opaqueData: opaqueData?.length ?? 0,
      })
      if (h2Session) removeSession(pool, h2Session)
    })

    session.on("ping", () => {
      log.debug("h2 ping response", { host: url.hostname })
    })

    h2Session = {
      session,
      remoteMaxConcurrentStreams: remoteMaxStreams,
      activeStreams: 0,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      pingRttMs: 0,
    }
    return h2Session
  } catch (err) {
    log.warn("bug: h2 session creation failed", { baseUrl: pool.baseUrl, error: (err as Error).message })
    return null
  }
}

function getResponseStatus(headers: http2.IncomingHttpHeaders): number {
  const status = headers[":status"]
  return typeof status === "number" ? status : Number(status) || 0
}

function toFetchHeaders(headers: http2.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(":") || value === undefined) continue
    result[key] = Array.isArray(value) ? value.join(", ") : String(value)
  }
  return result
}

export interface H2RequestOptions {
  url: string
  baseUrl: string
  method: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
  timeoutMs?: number
  /** Model concurrency ceiling (owner registry 2026-09-29): the pool grows to
   *  ceil(ceiling / advertised per-session budget) sessions to meet it. */
  concurrencyLimit?: number
  /** Raw-wire capture seam (T2): the pseudo-header set + body handed to node's http2. */
  onWire?: (headers: Record<string, string>, body?: string) => void
}

export interface H2Response {
  status: number
  headers: Record<string, string>
  body: string
  bodyStream?: ReadableStream<Uint8Array>
  metrics: MetricsResult
  requestId?: string
  error?: NormalizedError
}

export async function request(options: H2RequestOptions): Promise<H2Response> {
  const sample = M.makeSample(0, options.headers["x-request-id"])
  sample.queuedAt = Date.now()

  const pool = getPool(getSessionKey(options.baseUrl), options.baseUrl)
  let session: H2Session
  try {
    session = await acquireSlot(pool, options.concurrencyLimit)
  } catch (err) {
    const normalized = normalizeError(err as Error)
    sample.endedAt = Date.now()
    throw new TransportError({
      status: 0,
      headers: {},
      body: "",
      metrics: M.computeMetrics(sample),
      error: normalized,
      requestId: options.headers["x-request-id"],
      cause: err,
    })
  }

  sample.socketAcquiredAt = Date.now()

  return new Promise<H2Response>((resolve, rejectPromise) => {
    const url = new URL(options.url)
    const path = url.pathname + url.search

    // Wire capture seam (T2): the pseudo-header set + headers exactly as
    // handed to the http2 stream. Captured before session.request.
    options.onWire?.({ ":method": options.method, ":path": path, ...options.headers }, options.body)

    const req = session.session.request({
      ":method": options.method,
      ":path": path,
      // Verbatim headers — no cutting (user directive 2026-09-07).
      ...options.headers,
    })

    let bodyChunks: Buffer[] = []
    let totalBytes = 0
    const maxBodyBytes = 10 * 1024 * 1024
    let firstChunk = true
    let status = 0
    let responseHeaders: Record<string, string> = {}
    let completed = false

    const cleanup = () => {
      releaseSlot(pool, session)
      req.removeAllListeners("response")
      req.removeAllListeners("data")
      req.removeAllListeners("end")
      req.removeAllListeners("error")
    }

    req.on("response", (headers) => {
      sample.headersReceivedAt = Date.now()
      status = getResponseStatus(headers)
      responseHeaders = toFetchHeaders(headers)
    })

    req.on("data", (chunk: Buffer) => {
      if (firstChunk) {
        sample.firstChunkAt = Date.now()
        firstChunk = false
      }
      sample.lastChunkAt = Date.now()
      sample.chunks++
      totalBytes += chunk.length
      if (totalBytes > maxBodyBytes) {
        if (!completed) {
          completed = true
          cleanup()
          req.destroy()
          const err = new Error(`Response body exceeds ${maxBodyBytes} byte limit`)
          const normalized = normalizeError(err)
          sample.endedAt = Date.now()
          resolve({
            status: 0,
            headers: {},
            body: "",
            metrics: M.computeMetrics(sample),
            error: normalized,
            requestId: options.headers["x-request-id"],
          })
        }
        return
      }
      bodyChunks.push(chunk)
    })

    req.on("end", () => {
      if (completed) return
      completed = true
      cleanup()
      sample.endedAt = Date.now()
      sample.status = status
      resolve({
        status,
        headers: responseHeaders,
        body: Buffer.concat(bodyChunks).toString("utf-8"),
        metrics: M.computeMetrics(sample),
        requestId: options.headers["x-request-id"],
      })
    })

    req.on("error", (err) => {
      if (completed) return
      completed = true
      cleanup()
      sample.endedAt = Date.now()
      sample.status = 0
      const normalized = normalizeError(err)
      log.debug("h2 request error", {
        url: options.url,
        category: normalized.category,
        error: normalized.message,
      })
      resolve({
        status: 0,
        headers: {},
        body: "",
        metrics: M.computeMetrics(sample),
        error: normalized,
        requestId: options.headers["x-request-id"],
      })
    })

    if (options.body) {
      req.end(options.body)
    } else {
      req.end()
    }

    if (options.signal) {
      options.signal.addEventListener(
        "abort",
        () => {
          if (!completed) {
            completed = true
            cleanup()
            // Graceful per-stream cancel: RST_STREAM(CANCEL) keeps the H2
            // session alive for other streams. req.destroy() would tear
            // down the whole connection (user directive 2026-09-09).
            closeStreamGracefully(req)
            sample.endedAt = Date.now()
            resolve({
              status: 0,
              headers: {},
              body: "",
              metrics: M.computeMetrics(sample),
              error: normalizeError(new Error("Request aborted")),
              requestId: options.headers["x-request-id"],
            })
          }
        },
        { once: true },
      )
    }
  })
}

/** Graceful H2 stream close: RST_STREAM(CANCEL); destroy only as last resort. */
function closeStreamGracefully(req: http2.ClientHttp2Stream): void {
  try {
    // Node http2: close(code) sends RST_STREAM with the code (8 = CANCEL).
    ;(req as any).close?.(http2.constants.NGHTTP2_CANCEL)
  } catch {
    // Fall back to hard destroy if close is unavailable/fails.
    req.destroy()
  }
}

export async function requestStream(
  options: H2RequestOptions,
): Promise<{ response: Response; metrics: MetricsResult }> {
  const sample = M.makeSample(0, options.headers["x-request-id"])
  sample.queuedAt = Date.now()

  const pool = getPool(getSessionKey(options.baseUrl), options.baseUrl)
  let session: H2Session
  try {
    session = await acquireSlot(pool, options.concurrencyLimit)
  } catch (err) {
    sample.endedAt = Date.now()
    throw new Error(`Failed to acquire H2 stream slot: ${(err as Error).message}`)
  }

  sample.socketAcquiredAt = Date.now()

  return new Promise<{ response: Response; metrics: MetricsResult }>((resolve, reject) => {
    const url = new URL(options.url)
    const path = url.pathname + url.search

    // Wire capture seam (T2): the pseudo-header set + headers exactly as
    // handed to the http2 stream. Captured before session.request.
    options.onWire?.({ ":method": options.method, ":path": path, ...options.headers }, options.body)

    const req = session.session.request({
      ":method": options.method,
      ":path": path,
      // Verbatim headers — no cutting (user directive 2026-09-07).
      ...options.headers,
    })

    let firstChunk = true
    let status = 0
    let responseHeaders: Record<string, string> = {}
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    let streamDone = false
    let settled = false

    const decrement = () => {
      if (streamDone) return
      streamDone = true
      releaseSlot(pool, session)
    }

    const settle = () => {
      if (settled) return
      settled = true
      const safeStatus = status >= 200 && status <= 599 ? status : 200
      resolve({
        response: new Response(readable, {
          status: safeStatus,
          headers: responseHeaders,
        }),
        metrics: M.computeMetrics(sample),
      })
    }

    req.on("response", (headers) => {
      sample.headersReceivedAt = Date.now()
      status = getResponseStatus(headers)
      responseHeaders = toFetchHeaders(headers)
      sample.status = status
      settle()
    })

    req.on("data", (chunk: Buffer) => {
      if (firstChunk) {
        sample.firstChunkAt = Date.now()
        firstChunk = false
      }
      sample.lastChunkAt = Date.now()
      sample.chunks++
      writer.write(new Uint8Array(chunk)).catch((e) => {
        log.warn("bug: h2 stream write failed", { error: String(e) })
        req.destroy()
      })
    })

    req.on("end", async () => {
      decrement()
      sample.endedAt = Date.now()
      sample.status = status
      await writer.close()
      settle()
    })

    req.on("error", async (err) => {
      decrement()
      sample.endedAt = Date.now()
      sample.status = 0
      const normalized = normalizeError(err)
      const error = new Error(`H2 stream request failed: ${normalized.message}`, { cause: err })
      log.debug("h2 stream request error", {
        url: options.url,
        category: normalized.category,
        error: normalized.message,
      })
      await writer.abort(error).catch((abortError) => {
        log.debug("h2 stream abort failed", { error: String(abortError) })
      })
      if (!settled) reject(error)
    })

    if (options.body) {
      req.end(options.body)
    } else {
      req.end()
    }

    if (options.signal) {
      options.signal.addEventListener(
        "abort",
        () => {
          decrement()
          // Graceful per-stream cancel: RST_STREAM(CANCEL) keeps the H2
          // session alive for other streams (user directive 2026-09-09).
          closeStreamGracefully(req)
          const error = new Error("Request aborted")
          writer.abort(error).catch((e) => { log.debug("writer abort failed", { error: String(e) }) })
          if (!settled) reject(error)
        },
        { once: true },
      )
    }
  })
}

export async function ping(baseUrl: string): Promise<number> {
  const pool = getPool(getSessionKey(baseUrl), baseUrl)
  const session = pickSession(pool) ?? createSession(pool)
  if (!session) return -1
  if (!pool.sessions.includes(session)) pool.sessions.push(session)

  return new Promise<number>((resolve) => {
    const start = Date.now()
    session.session.ping((err, duration, payload) => {
      if (err) {
        log.debug("h2 ping failed", { baseUrl, error: err.message })
        resolve(-1)
      } else {
        const rtt = duration
        session.pingRttMs = rtt
        resolve(rtt)
      }
    })
  })
}

export function getRemoteMaxConcurrentStreams(baseUrl: string): number | null {
  const pool = pools.get(getSessionKey(baseUrl))
  const session = pool?.sessions.find((s) => !s.session.closed)
  return session?.remoteMaxConcurrentStreams ? session.remoteMaxConcurrentStreams : null
}

export function getMaxRemoteConcurrentStreamsAcrossSessions(): number {
  let max = 0
  for (const pool of pools.values()) {
    for (const session of pool.sessions) {
      if (session.remoteMaxConcurrentStreams > max) {
        max = session.remoteMaxConcurrentStreams
      }
    }
  }
  return max || 100
}

export function closeAll(): void {
  for (const pool of pools.values()) {
    for (const session of pool.sessions) {
      session.session.close()
    }
    rejectAllWaiters(pool, new Error("H2 sessions closed"))
    pool.sessions = []
  }
}

/** Close every session of one origin's pool. Used by the downgrade path only —
 *  a healthy pool is never torn down on idle (owner directive 2026-09-29). */
export function closeSession(baseUrl: string): void {
  const pool = pools.get(getSessionKey(baseUrl))
  if (!pool) return
  for (const session of pool.sessions) {
    session.session.close()
  }
  rejectAllWaiters(pool, new Error("H2 session closed"))
  pool.sessions = []
}

export function isSessionHealthy(baseUrl: string): boolean {
  const pool = pools.get(getSessionKey(baseUrl))
  return pool ? pool.sessions.some((s) => !s.session.closed) : false
}

export function getSessionCount(): number {
  let total = 0
  for (const pool of pools.values()) total += pool.sessions.length
  return total
}
