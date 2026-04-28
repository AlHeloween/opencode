import type { RouteKey } from "./route-key"
import { toRouteKeyString } from "./route-key"
import * as Classifier from "./classifier"
import * as Limiter from "./limiter"
import * as StreamBudget from "./stream-budget"
import * as Store from "./store"
import * as Metrics from "./metrics"
import * as Errors from "./errors"
import * as H2 from "./h2-transport"
import * as H1 from "./h1-transport"
import { healthScore } from "./health-window"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import fs from "fs"
import os from "os"
import { Effect } from "effect"
import type { AsyncLogger } from "./async-logger"
import { make as makeAsyncLogger } from "./async-logger"
import type { ResolvedDebugConfig } from "./debug-config"

const log = Log.create({ service: "gateway.adaptive-client" })

const limiterState = Limiter.makeState()
const streamState = StreamBudget.makeState()
const logDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
const logFilePath = path.join(logDir, "gateway.log")
const errorLogFilePath = path.join(logDir, "gateway-errors.log")
let loggingEnabled = true
let logFormat: "json" | "text" = "json"
let asyncLogger: AsyncLogger | undefined
let errorLogger: AsyncLogger | undefined
let debugConfig: ResolvedDebugConfig | null = null

export function setDebugConfig(config: ResolvedDebugConfig): void {
  debugConfig = config
}

export function getDebugConfig(): ResolvedDebugConfig {
  return debugConfig ?? { debug: true, logBodies: true, maxBodySize: 10240 }
}

export function configureLogging(enabled: boolean, format: "json" | "text" = "json"): void {
  loggingEnabled = enabled
  logFormat = format
}

interface AdaptiveFetchOptions extends RequestInit {
  gatewayRouteKey?: RouteKey
  gatewayStream?: boolean
  gatewayTimeoutMs?: number
  gatewayProvider?: string
  gatewayModel?: string
  gatewayProtocol?: "h2" | "http/1.1"
}

/**
 * Sensitive header patterns to completely remove from logs.
 * These are opencode internal OAuth-related headers that must not be exposed.
 */
const SENSITIVE_HEADER_PATTERNS = [
  "auth",
  "authorization",
  "token",
  "access_token",
  "refresh_token",
  "client_secret",
  "client_id",
  "api_key",
  "apikey",
  "secret",
  "credential",
  "bearer",
  "oauth",
  "x-opencode-auth",
]

/**
 * Remove sensitive headers from the headers object entirely.
 * This prevents any OAuth/internal authentication data from appearing in logs.
 */
const sensitiveRegex = new RegExp(SENSITIVE_HEADER_PATTERNS.map((p) => p.replace(/[-_]/g, "[-_]?")).join("|"), "i")

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!sensitiveRegex.test(key)) {
      sanitized[key] = value
    }
  }
  return sanitized
}

function initLogger() {
  if (!asyncLogger && loggingEnabled) {
    fs.mkdirSync(logDir, { recursive: true })
    asyncLogger = makeAsyncLogger({
      path: logFilePath,
      maxBuffer: 5000,
      intervalMs: 100,
      maxBytes: 20 * 1024,
      keepBytes: 10 * 1024,
    })
  }
  if (!errorLogger && loggingEnabled) {
    fs.mkdirSync(logDir, { recursive: true })
    errorLogger = makeAsyncLogger({ path: errorLogFilePath, maxBuffer: 2000, intervalMs: 100 })
  }
}

function writeLog(entry: Record<string, unknown>): void {
  if (!loggingEnabled || !asyncLogger) return
  asyncLogger.log(entry)
}

function writeErrorLog(entry: Record<string, unknown>): void {
  if (!loggingEnabled || !errorLogger) return
  errorLogger.log(entry)
}

function truncateBody(body: string, maxSize: number): { preview: string; truncated: boolean; size: number } {
  if (body.length <= maxSize) {
    return { preview: body, truncated: false, size: body.length }
  }
  return { preview: body.slice(0, maxSize) + "...", truncated: true, size: body.length }
}

function getCallerStack(): string | undefined {
  try {
    return new Error().stack?.split("\n")[3]?.trim()
  } catch {
    return undefined
  }
}

export function wrapFetch(baseFetch: typeof globalThis.fetch) {
  const wrapped = async (input: string | URL | Request, init?: AdaptiveFetchOptions): Promise<Response> => {
    await Store.init()
    initLogger()

    const startTime = Date.now()
    const requestId = crypto.randomUUID()
    const timeoutMs = init?.gatewayTimeoutMs || 600000
    const isStream = init?.gatewayStream || false

    const headers = (init?.headers as Record<string, string>) || {}

    // Handle OAuth token passthrough: if x-opencode-oauth-token is present, use it as Authorization
    const oauthToken = headers["x-opencode-oauth-token"] || headers["X-Opencode-Oauth-Token"]
    if (oauthToken) {
      headers["authorization"] = `Bearer ${oauthToken}`
    }

    // Handle ChatGPT-Account-Id for organization subscriptions
    const accountId = headers["x-opencode-account-id"] || headers["X-Opencode-Account-Id"]
    if (accountId) {
      headers["ChatGPT-Account-Id"] = accountId
    }

    // Handle OAuth URL rewrite for ChatGPT backend API
    const oauthUrl = headers["x-opencode-oauth-url"] || headers["X-Opencode-Oauth-Url"]
    if (oauthUrl) {
      input = oauthUrl
    }

    // Compute URL after potential OAuth rewrite
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url

    const urlObj = new URL(url)
    const provider = init?.gatewayProvider || headers["x-opencode-provider"] || "unknown"
    const model = init?.gatewayModel || headers["x-opencode-model"] || "unknown"
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

    // Determine protocol preference from model config, stored route adjustment, or global config
    const baseRouteKey: RouteKey = {
      provider,
      baseUrl,
      model,
      endpointKind: endpointKind as RouteKey["endpointKind"],
      stream: isStream,
      negotiatedProtocol: "unknown",
      requestShapeClass: shapeClass,
    }

    // Protocol resolution: model-level gateway.protocol > existing route adjustment > default to http/1.1
    const modelProtocol = init?.gatewayProtocol
    const existingAdjustment = Store.getRoute(baseRouteKey)
    const preferredProtocol: "h2" | "http/1.1" | "unknown" = modelProtocol
      ? modelProtocol
      : existingAdjustment.protocol.alpnNegotiated !== "unknown"
        ? (existingAdjustment.protocol.alpnNegotiated as "h2" | "http/1.1")
        : "http/1.1"

    // Determine streaming preference from stored route adjustment
    const streamingEnabled = Store.getStreamingEnabled(baseRouteKey)
    const effectiveStream = streamingEnabled ? isStream : false

    const routeKey: RouteKey = {
      ...baseRouteKey,
      negotiatedProtocol: preferredProtocol,
      stream: effectiveStream,
    }

    const keyStr = toRouteKeyString(routeKey)
    const adjustment = Store.getRoute(routeKey)
    const policy = adjustment.policy
    const score = healthScore(adjustment.health)

    const debugCfg = getDebugConfig()
    const bodyForLog =
      debugCfg.logBodies && init?.body ? truncateBody(String(init.body), debugCfg.maxBodySize) : undefined

    const sanitizedLogHeaders = sanitizeHeaders(headers)

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
        streamMinLaunchIntervalMs: policy.streamMinLaunchIntervalMs,
        maxInflight: policy.maxInflight,
        maxStreams: policy.maxStreams,
      },
      ...(debugCfg.debug && {
        headers: sanitizedLogHeaders,
        ...(bodyForLog && {
          bodyPreview: bodyForLog.preview,
          bodyTruncated: bodyForLog.truncated,
          bodySize: bodyForLog.size,
        }),
      }),
    })

    if (Store.isCircuitBreakerOpen(routeKey)) {
      writeLog({
        level: "ERROR",
        event: "gateway.circuit_breaker.open",
        timestamp: Date.now(),
        requestId,
        key: keyStr,
        healthScore: Math.round(score * 100) / 100,
      })
      throw new Error(`Circuit breaker open for ${keyStr}`)
    }

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
    let inflightSlot: Limiter.AcquireResult | null = null
    let streamSlot: StreamBudget.StreamAcquireResult | null = null

    try {
      const launchStart = Date.now()
      launchSlot = await Limiter.acquireWithBackoff(limiterState, routeKey, policy, "launch", timeoutMs, isStream)
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

      const inflightStart = Date.now()
      inflightSlot = await Limiter.acquireWithBackoff(limiterState, routeKey, policy, "inflight", timeoutMs, isStream)
      const inflightWaitMs = Date.now() - inflightStart

      writeLog({
        level: "INFO",
        event: "gateway.limiter.acquire",
        timestamp: Date.now(),
        requestId,
        kind: "inflight",
        waitMs: inflightWaitMs,
        acquired: inflightSlot.acquired,
      })

      if (!inflightSlot.acquired) {
        writeLog({
          level: "ERROR",
          event: "gateway.limiter.rejected",
          timestamp: Date.now(),
          requestId,
          kind: "inflight",
          timeoutMs,
          key: keyStr,
        })
        throw new Error(`Gateway inflight timeout after ${timeoutMs}ms for ${keyStr}`)
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
          Limiter.release(limiterState, routeKey, launchSlot.slotId)
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
      let response: Response
      let usedProtocol: "h2" | "http/1.1" = "http/1.1"
      let fetchError: unknown = null
      try {
        const fetchStart = Date.now()
        const protocolPref = Store.getProtocolPreference(routeKey)
        const useH2 = routeKey.negotiatedProtocol === "h2" && shouldUseH2(routeKey) && protocolPref === "h2"

        log.info("gateway.protocol.decision", {
          provider,
          model,
          configured: modelProtocol,
          negotiated: routeKey.negotiatedProtocol,
          stored: protocolPref,
          using: useH2 ? "h2" : "http/1.1",
          streaming: routeKey.stream,
        })

        if (asyncLogger) {
          asyncLogger.log({
            level: "INFO",
            event: "gateway.protocol.decision",
            provider,
            model,
            configured: modelProtocol,
            negotiated: routeKey.negotiatedProtocol,
            stored: protocolPref,
            using: useH2 ? "h2" : "http/1.1",
            streaming: routeKey.stream,
          })
        }

        if (useH2) {
          try {
            if (routeKey.stream) {
              const h2Result = await H2.requestStream({
                baseUrl,
                url,
                method: (init?.method as string) || "POST",
                headers: headers,
                body: init?.body as string,
              })
              usedProtocol = "h2"
              response = h2Result.response
              Store.recordProtocolSuccess(routeKey, "h2")
            } else {
              const h2Result = await H2.request({
                baseUrl,
                url,
                method: (init?.method as string) || "POST",
                headers: headers,
                body: init?.body as string,
              })

              if (h2Result.error) {
                if (Errors.shouldFallbackToH1(h2Result.error)) {
                  writeLog({
                    level: "WARN",
                    event: "gateway.protocol.fallback",
                    timestamp: Date.now(),
                    requestId,
                    provider,
                    model,
                    fromProtocol: "h2",
                    toProtocol: "http/1.1",
                    reason: h2Result.error.category,
                    message: h2Result.error.message,
                  })

                  Store.recordH2Failure(routeKey, `${h2Result.error.category}: ${h2Result.error.message}`)
                  H2.closeSession(baseUrl)

                  usedProtocol = "http/1.1"
                  const h1Result = await H1.request({
                    url,
                    method: (init?.method as string) || "POST",
                    headers,
                    body: init?.body as string | undefined,
                    signal: init?.signal ?? undefined,
                  })
                  response = new Response(h1Result.body, {
                    status: h1Result.status,
                    headers: h1Result.headers,
                  })
                } else {
                  Store.recordError(routeKey, h2Result.error.category, Date.now() - startTime)
                  Store.recordCircuitBreakerFailure(routeKey)
                  throw new Error(h2Result.error.message)
                }
              } else {
                usedProtocol = "h2"
                response = new Response(h2Result.body, {
                  status: h2Result.status,
                  headers: h2Result.headers,
                })
                Store.recordProtocolSuccess(routeKey, "h2")
              }
            }
          } catch (h2Err) {
            const normalized = Errors.normalizeError(h2Err)

            if (Errors.shouldFallbackToH1(normalized)) {
              writeLog({
                level: "WARN",
                event: "gateway.protocol.fallback",
                timestamp: Date.now(),
                requestId,
                provider,
                model,
                fromProtocol: "h2",
                toProtocol: "http/1.1",
                reason: normalized.category,
                message: normalized.message,
              })

              Store.recordH2Failure(routeKey, `${normalized.category}: ${normalized.message}`)
              H2.closeSession(baseUrl)

              usedProtocol = "http/1.1"
              const h1Result = await H1.request({
                url,
                method: (init?.method as string) || "POST",
                headers,
                body: init?.body as string | undefined,
                signal: init?.signal ?? undefined,
              })
              response = new Response(h1Result.body, {
                status: h1Result.status,
                headers: h1Result.headers,
              })
            } else {
              Store.recordError(routeKey, normalized.category, Date.now() - startTime)
              Store.recordCircuitBreakerFailure(routeKey)
              throw h2Err
            }
          }
        } else {
          usedProtocol = "http/1.1"
          const h1Result = await H1.request({
            url,
            method: (init?.method as string) || "POST",
            headers,
            body: init?.body as string | undefined,
            signal: init?.signal ?? undefined,
          })
          response = new Response(h1Result.body, {
            status: h1Result.status,
            headers: h1Result.headers,
          })
        }

        const fetchMs = Date.now() - fetchStart
        sample.headersReceivedAt = Date.now()
        sample.status = response.status
      } catch (err) {
        fetchError = err
        const normalized = Errors.normalizeError(err)
        Store.recordError(routeKey, normalized.category, Date.now() - startTime)
        Store.recordCircuitBreakerFailure(routeKey)
        Store.adaptRoutePolicy(routeKey, false, 0)

        const caller = getCallerStack()
        const errorEntry: Record<string, unknown> = {
          level: "ERROR",
          event: "gateway.request.error",
          timestamp: Date.now(),
          requestId,
          provider,
          model,
          category: normalized.category,
          retryable: normalized.retryable,
          message: normalized.message,
          caller,
        }

        writeLog(errorEntry)
        writeErrorLog(errorEntry)

        throw err
      }

      if (response.body) {
        let firstChunk = true
        const trackedBody = response.body.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              if (firstChunk) {
                sample.firstChunkAt = Date.now()
                firstChunk = false
                // Log when first chunk arrives (for streaming, this is TTFT)
                writeLog({
                  level: "INFO",
                  event: "gateway.stream.first_chunk",
                  timestamp: Date.now(),
                  requestId,
                  ttftMs: sample.firstChunkAt - sample.headersReceivedAt,
                })
              }
              sample.lastChunkAt = Date.now()
              sample.chunks++
              controller.enqueue(chunk)
            },
            flush() {
              sample.endedAt = Date.now()
              const metrics = Metrics.computeMetrics(sample)
              writeLog({
                level: "INFO",
                event: "gateway.request.end",
                timestamp: Date.now(),
                requestId,
                status: response.status,
                fetchMs: sample.headersReceivedAt - sample.socketAcquiredAt,
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
              Store.recordSuccess(routeKey, metrics.totalMs, metrics.ttftMs)
              Store.recordCircuitBreakerSuccess(routeKey)
              Store.adaptRoutePolicy(routeKey, true, healthScore(Store.getRoute(routeKey).health))
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
        Store.recordProtocolSuccess(routeKey, usedProtocol)
        Store.recordCircuitBreakerSuccess(routeKey)
        const postScore = healthScore(Store.getRoute(routeKey).health)
        Store.adaptRoutePolicy(routeKey, true, postScore)
      } else {
        const category =
          response.status === 429 ? "rate_or_rejection" : response.status >= 500 ? "server_5xx" : "unknown"
        Store.recordError(routeKey, category, metrics.totalMs)
        Store.recordCircuitBreakerFailure(routeKey)
        const postScore = healthScore(Store.getRoute(routeKey).health)
        Store.adaptRoutePolicy(routeKey, false, postScore)
      }

      return response
    } finally {
      if (streamSlot) {
        StreamBudget.release(streamState, streamSlot.slotId)
      }
      if (inflightSlot) {
        Limiter.release(limiterState, routeKey, inflightSlot.slotId)
      }
      if (launchSlot) {
        Limiter.release(limiterState, routeKey, launchSlot.slotId)
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
    inflightRequests: 0,
    h2Sessions: H2.getSessionCount(),
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
        streamMinLaunchIntervalMs: r.adjustment.policy.streamMinLaunchIntervalMs,
        maxInflight: r.adjustment.policy.maxInflight,
        maxStreams: r.adjustment.policy.maxStreams,
      },
    })),
  })
}

export { initLogger }

function shouldUseH2(routeKey: RouteKey): boolean {
  if (routeKey.negotiatedProtocol === "h2") return true
  const protocolPref = Store.getProtocolPreference(routeKey)
  return protocolPref === "h2"
}
