import type { RouteKey } from "./route-key"
import { toRouteKeyString } from "./route-key"
import * as Classifier from "./classifier"
import * as Limiter from "./limiter"
import * as StreamBudget from "./stream-budget"
import * as Store from "./store"
import * as Metrics from "./metrics"
import { healthScore } from "./health-window"
import { Global } from "@/global"
import path from "path"
import fs from "fs"
import os from "os"

const limiterState = Limiter.makeState()
const streamState = StreamBudget.makeState()
const logDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
const logFilePath = path.join(logDir, "gateway.log")
let loggingEnabled = true
let logFormat: "json" | "text" = "json"

export function configureLogging(enabled: boolean, format: "json" | "text" = "json"): void {
  loggingEnabled = enabled
  logFormat = format
}

interface AdaptiveFetchOptions extends RequestInit {
  gatewayRouteKey?: RouteKey
  gatewayStream?: boolean
  gatewayTimeoutMs?: number
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized = { ...headers }
  for (const key of Object.keys(sanitized)) {
    if (
      key.toLowerCase().includes("auth") ||
      key.toLowerCase().includes("key") ||
      key.toLowerCase().includes("token")
    ) {
      sanitized[key] = "API_KEY"
    }
  }
  return sanitized
}

async function ensureLogDir(): Promise<void> {
  try {
    fs.accessSync(logDir)
  } catch {
    fs.mkdirSync(logDir, { recursive: true })
  }
}

function writeLog(entry: Record<string, unknown>): void {
  if (!loggingEnabled) return
  const line = logFormat === "json" ? JSON.stringify(entry) + "\n" : buildTextLog(entry) + "\n"
  try {
    fs.appendFileSync(logFilePath, line)
  } catch (err) {
    console.error("Gateway log write error:", err)
  }
}

function buildTextLog(entry: Record<string, unknown>): string {
  const timestamp = new Date().toISOString().split(".")[0]
  const level = (entry.level as string) || "INFO"
  const event = (entry.event as string) || ""
  const parts = [timestamp, level, event]

  const extras = Object.entries(entry)
    .filter(([key]) => !["level", "event", "timestamp"].includes(key))
    .map(([key, value]) => {
      if (value === null || value === undefined) return null
      if (typeof value === "object") return `${key}=${JSON.stringify(value)}`
      return `${key}=${value}`
    })
    .filter(Boolean)

  return [...parts, ...extras].join(" ")
}

export function wrapFetch(baseFetch: typeof globalThis.fetch) {
  const wrapped = async (input: string | URL | Request, init?: AdaptiveFetchOptions): Promise<Response> => {
    await Store.init()
    ensureLogDir()

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const startTime = Date.now()
    const requestId = crypto.randomUUID()
    const timeoutMs = init?.gatewayTimeoutMs || 120000
    const isStream = init?.gatewayStream || false

    const headers = (init?.headers as Record<string, string>) || {}
    const sanitizedHeaders = sanitizeHeaders(headers)

    const urlObj = new URL(url)
    const provider = headers["x-opencode-provider"] || "unknown"
    const model = headers["x-opencode-model"] || "unknown"
    const endpointKind = headers["x-opencode-endpoint-kind"] || "chat"

    const classifyInput: Classifier.ClassifyInput = {
      hasTools: headers["x-opencode-has-tools"] === "true",
      streaming: isStream,
      maxTokens: headers["x-opencode-max-tokens"] ? parseInt(headers["x-opencode-max-tokens"]) : undefined,
      contextTokens: headers["x-opencode-context-tokens"] ? parseInt(headers["x-opencode-context-tokens"]) : undefined,
      hasAttachments: headers["x-opencode-has-attachments"] === "true",
    }

    const shapeClass = Classifier.classify(classifyInput)
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`

    const routeKey: RouteKey = {
      provider,
      baseUrl,
      model,
      endpointKind: endpointKind as RouteKey["endpointKind"],
      stream: isStream,
      negotiatedProtocol: "unknown",
      requestShapeClass: shapeClass,
    }

    const keyStr = toRouteKeyString(routeKey)
    const adjustment = Store.getRoute(routeKey)
    const policy = adjustment.policy
    const score = healthScore(adjustment.health)

    writeLog({
      level: "INFO",
      event: "gateway.request.start",
      timestamp: Date.now(),
      requestId,
      url,
      method: (init?.method || "GET").toUpperCase(),
      provider,
      model,
      endpointKind,
      shapeClass,
      isStream,
      key: keyStr,
      healthScore: Math.round(score * 100) / 100,
      policy: {
        minLaunchIntervalMs: policy.minLaunchIntervalMs,
        maxInflight: policy.maxInflight,
        maxStreams: policy.maxStreams,
      },
    })

    const sample: Metrics.MetricsSample = {
      queuedAt: Date.now(),
      socketAcquiredAt: 0,
      headersReceivedAt: 0,
      firstChunkAt: 0,
      lastChunkAt: 0,
      endedAt: 0,
      chunks: 0,
      status: 0,
      requestId,
    }

    let launchSlot: Limiter.AcquireResult | null = null
    let streamSlot: StreamBudget.StreamAcquireResult | null = null

    try {
      const launchStart = Date.now()
      launchSlot = await Limiter.acquireWithBackoff(limiterState, policy, "launch", timeoutMs)
      const launchWaitMs = Date.now() - launchStart

      writeLog({
        level: "INFO",
        event: "gateway.limiter.acquire",
        timestamp: Date.now(),
        requestId,
        kind: "launch",
        waitMs: launchWaitMs,
        acquired: launchSlot.acquired,
      })

      if (!launchSlot.acquired) {
        writeLog({
          level: "ERROR",
          event: "gateway.limiter.rejected",
          timestamp: Date.now(),
          requestId,
          kind: "launch",
          timeoutMs,
          key: keyStr,
        })
        throw new Error(`Gateway launch timeout after ${timeoutMs}ms for ${keyStr}`)
      }

      if (isStream) {
        const streamStart = Date.now()
        const slot = await StreamBudget.acquireWithBackoff(streamState, policy, keyStr, timeoutMs)
        streamSlot = slot
        const streamWaitMs = Date.now() - streamStart

        writeLog({
          level: "INFO",
          event: "gateway.stream.acquire",
          timestamp: Date.now(),
          requestId,
          kind: "stream",
          waitMs: streamWaitMs,
          acquired: streamSlot.acquired,
        })

        if (!streamSlot.acquired) {
          Limiter.release(limiterState, launchSlot.slotId)
          writeLog({
            level: "ERROR",
            event: "gateway.stream.rejected",
            timestamp: Date.now(),
            requestId,
            kind: "stream",
            timeoutMs,
            key: keyStr,
          })
          throw new Error(`Gateway stream budget exhausted for ${keyStr}`)
        }
      }

      sample.socketAcquiredAt = Date.now()
      const fetchStart = Date.now()
      const response = await baseFetch(input, init)
      const fetchMs = Date.now() - fetchStart
      sample.headersReceivedAt = Date.now()
      sample.status = response.status

      if (response.body) {
        let firstChunk = true
        const trackedBody = response.body.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              if (firstChunk) {
                sample.firstChunkAt = Date.now()
                firstChunk = false
              }
              sample.lastChunkAt = Date.now()
              sample.chunks++
              controller.enqueue(chunk)
            },
            flush() {
              sample.endedAt = Date.now()
            },
          }),
        )

        return new Response(trackedBody, {
          status: response.status,
          headers: response.headers,
        })
      }

      sample.endedAt = Date.now()
      const success = response.status >= 200 && response.status < 300
      const metrics = Metrics.computeMetrics(sample)

      if (success) {
        Store.recordSuccess(routeKey, metrics.totalMs, metrics.ttftMs)

        writeLog({
          level: "INFO",
          event: "gateway.request.end",
          timestamp: Date.now(),
          requestId,
          status: response.status,
          fetchMs,
          metrics: {
            totalMs: metrics.totalMs,
            ttftMs: metrics.ttftMs,
            ttfbMs: metrics.ttfbMs,
            queuedMs: metrics.queuedMs,
            chunks: metrics.chunks,
            avgChunkGapMs: metrics.avgChunkGapMs,
          },
          healthScore: Math.round(healthScore(Store.getRoute(routeKey).health) * 100) / 100,
        })
      }

      return response
    } finally {
      if (streamSlot) {
        StreamBudget.release(streamState, streamSlot.slotId)
      }
      if (launchSlot) {
        Limiter.release(limiterState, launchSlot.slotId)
      }
    }
  }
  return wrapped
}

export async function probeRoute(_baseUrl: string): Promise<{ alpnNegotiated: string; success: boolean }> {
  return { alpnNegotiated: "http/1.1", success: true }
}

export function getGatewayStatus() {
  return {
    activeStreams: StreamBudget.getActiveStreams(streamState),
    inflightRequests: Limiter.getInflight(limiterState),
    h2Sessions: 0,
  }
}

export function logGatewayStatus(): void {
  const status = getGatewayStatus()
  const routes = Store.getAllRoutes()

  writeLog({
    level: "INFO",
    event: "gateway.status",
    timestamp: Date.now(),
    activeStreams: status.activeStreams,
    inflightRequests: status.inflightRequests,
    routeCount: routes.length,
    routes: routes.map((r) => ({
      provider: r.key.provider,
      model: r.key.model,
      shape: r.key.requestShapeClass,
      healthScore: Math.round(r.metrics.successRate * 100) / 100,
      confidence: Math.round(r.adjustment.confidence * 100) / 100,
      policy: {
        minLaunchIntervalMs: r.adjustment.policy.minLaunchIntervalMs,
        maxInflight: r.adjustment.policy.maxInflight,
        maxStreams: r.adjustment.policy.maxStreams,
      },
    })),
  })
}
