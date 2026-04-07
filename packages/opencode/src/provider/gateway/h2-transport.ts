import http2 from "node:http2"
import { Log } from "@/util/log"
import type { MetricsResult } from "./metrics"
import * as M from "./metrics"
import { normalizeError } from "./errors"
import type { NormalizedError } from "./errors"

const log = Log.create({ prefix: "gateway/h2" })

export interface H2Session {
  session: http2.ClientHttp2Session
  remoteMaxConcurrentStreams: number
  activeStreams: number
  createdAt: number
  lastUsedAt: number
  pingRttMs: number
}

const sessions = new Map<string, H2Session>()
const MAX_IDLE_SESSIONS = 10

function getSessionKey(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    return `${url.protocol}//${url.hostname}:${url.port}`
  } catch {
    return baseUrl
  }
}

function getOrCreateSession(baseUrl: string): H2Session | null {
  const key = getSessionKey(baseUrl)
  const existing = sessions.get(key)
  if (existing && !existing.session.closed) {
    existing.lastUsedAt = Date.now()
    return existing
  }

  try {
    const url = new URL(baseUrl)
    const session = http2.connect(baseUrl)

    let remoteMaxStreams = 100

    session.on("remoteSettings", (settings: http2.Settings) => {
      if (settings.maxConcurrentStreams !== undefined) {
        remoteMaxStreams = settings.maxConcurrentStreams
        log.debug("h2 remote settings", {
          host: url.hostname,
          maxConcurrentStreams: remoteMaxStreams,
        })
      }
    })

    session.on("error", (err) => {
      log.debug("h2 session error", { host: url.hostname, error: err.message })
    })

    session.on("goaway", (errorCode, lastStreamID, opaqueData) => {
      log.debug("h2 goaway received", {
        host: url.hostname,
        errorCode,
        lastStreamID,
      })
      sessions.delete(key)
    })

    session.on("ping", () => {
      log.debug("h2 ping response", { host: url.hostname })
    })

    const h2Session: H2Session = {
      session,
      remoteMaxConcurrentStreams: remoteMaxStreams,
      activeStreams: 0,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      pingRttMs: 0,
    }

    if (sessions.size >= MAX_IDLE_SESSIONS) {
      const oldest = Array.from(sessions.entries()).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0]
      if (oldest) {
        oldest[1].session.close()
        sessions.delete(oldest[0])
      }
    }

    sessions.set(key, h2Session)
    return h2Session
  } catch (err) {
    log.debug("h2 session creation failed", { baseUrl, error: (err as Error).message })
    return null
  }
}

export interface H2RequestOptions {
  url: string
  baseUrl: string
  method: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface H2Response {
  status: number
  headers: Record<string, string>
  body: string
  metrics: MetricsResult
  requestId?: string
  error?: NormalizedError
}

export async function request(options: H2RequestOptions): Promise<H2Response> {
  const sample = M.makeSample(0, options.headers["x-request-id"])
  sample.queuedAt = Date.now()

  const session = getOrCreateSession(options.baseUrl)
  if (!session) {
    const err = new Error("Failed to create H2 session")
    const normalized = normalizeError(err)
    sample.endedAt = Date.now()
    throw {
      status: 0,
      headers: {},
      body: "",
      metrics: M.computeMetrics(sample),
      error: normalized,
      requestId: options.headers["x-request-id"],
    }
  }

  sample.socketAcquiredAt = Date.now()

  return new Promise<H2Response>((resolve) => {
    const url = new URL(options.url)
    const path = url.pathname + url.search

    const req = session.session.request({
      ":method": options.method,
      ":path": path,
      ...options.headers,
    })

    let bodyChunks: Buffer[] = []
    let firstChunk = true
    let status = 0
    let responseHeaders: Record<string, string> = {}

    req.on("response", (headers) => {
      sample.headersReceivedAt = Date.now()
      status = (headers[":status"] as unknown as number) || 0
      responseHeaders = { ...headers } as Record<string, string>
    })

    req.on("data", (chunk: Buffer) => {
      if (firstChunk) {
        sample.firstChunkAt = Date.now()
        firstChunk = false
      }
      sample.lastChunkAt = Date.now()
      sample.chunks++
      bodyChunks.push(chunk)
    })

    req.on("end", () => {
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
          req.destroy()
        },
        { once: true },
      )
    }
  })
}

export async function ping(baseUrl: string): Promise<number> {
  const session = getOrCreateSession(baseUrl)
  if (!session) return -1

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
  const key = getSessionKey(baseUrl)
  const session = sessions.get(key)
  return session?.remoteMaxConcurrentStreams ? session.remoteMaxConcurrentStreams : null
}

export function closeAll(): void {
  for (const [, session] of sessions) {
    session.session.close()
  }
  sessions.clear()
}
