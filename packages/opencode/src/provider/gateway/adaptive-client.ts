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
import { unifiedDiff } from "@/util/unified-diff"
import path from "path"
import fs from "fs"
import type { AsyncLogger, PerRequestLogger } from "./async-logger"
import { make as makeAsyncLogger, makePerRequest } from "./async-logger"
import type { ResolvedDebugConfig } from "./debug-config"

const log = Log.create({ service: "gateway.adaptive-client" })

const limiterState = Limiter.makeState()
const streamState = StreamBudget.makeState()
let loggingEnabled = true
let asyncLogger: AsyncLogger | undefined
let errorLogger: AsyncLogger | undefined
let perRequestLogger: PerRequestLogger | undefined
let debugConfig: ResolvedDebugConfig | null = null

/** Previous request body for per-request diff comparison. */
let prevRequestBody: { requestId: string; timestamp: number; body: string } | undefined

export function setDebugConfig(config: ResolvedDebugConfig): void {
  debugConfig = config
  if (config.perRequest && !perRequestLogger && loggingEnabled) {
    initLogger()
  }
}

export function getDebugConfig(): ResolvedDebugConfig {
  return debugConfig ?? { debug: true, logBodies: true, perRequest: false }
}

export function configureLogging(enabled: boolean, _format: "json" | "text" = "json"): void {
  loggingEnabled = enabled
}

type GatewayProtocol = "h2" | "http/1.1"

export function resolveGatewayProtocol(provider: string, configured?: GatewayProtocol): GatewayProtocol {
  return configured ?? (provider === "openai" ? "h2" : "http/1.1")
}

interface AdaptiveFetchOptions extends RequestInit {
  gatewayRouteKey?: RouteKey
  gatewayStream?: boolean
  gatewayTimeoutMs?: number
  gatewayProvider?: string
  gatewayModel?: string
  gatewayProtocol?: GatewayProtocol
  gatewayStreaming?: boolean
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
    const logDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
    const logFilePath = path.join(logDir, "gateway.log")
    fs.mkdirSync(logDir, { recursive: true })
    asyncLogger = makeAsyncLogger({
      path: logFilePath,
      maxBuffer: 5000,
      intervalMs: 100,
    })
  }
  if (!errorLogger && loggingEnabled) {
    const logDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
    const errorLogFilePath = path.join(logDir, "gateway-errors.log")
    fs.mkdirSync(logDir, { recursive: true })
    errorLogger = makeAsyncLogger({ path: errorLogFilePath, maxBuffer: 2000, intervalMs: 100 })
  }
  if (!perRequestLogger && loggingEnabled && debugConfig?.perRequest) {
    const logDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
    const perRequestDir = path.join(logDir, "per-request")
    perRequestLogger = makePerRequest({ dir: perRequestDir })
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

function bodyRequestsStream(body: RequestInit["body"] | undefined): boolean {
  if (typeof body !== "string") return false
  if (!body.trimStart().startsWith("{")) return false
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== "object") return false
    return (parsed as { stream?: unknown }).stream === true
  } catch (error) {
    log.debug("gateway.stream.detect_failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

function getCallerStack(): string | undefined {
  try {
    return new Error().stack?.split("\n")[3]?.trim()
  } catch (error) {
    log.debug("gateway.caller_stack.detect_failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

class CoalescingTransform {
  private buffer: Uint8Array[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly flushMs: number
  private readonly maxChunks: number

  constructor(opts: { flushMs?: number; maxChunks?: number } = {}) {
    this.flushMs = opts.flushMs ?? 50
    this.maxChunks = opts.maxChunks ?? 10
  }

  push(chunk: Uint8Array, controller: TransformStreamDefaultController) {
    this.buffer.push(chunk)
    if (this.buffer.length >= this.maxChunks) {
      this.flush(controller)
      return
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush(controller)
      }, this.flushMs)
    }
  }

  flush(controller: TransformStreamDefaultController) {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.length === 0) return
    const merged = new Uint8Array(this.buffer.reduce((sum, b) => sum + b.length, 0))
    let offset = 0
    for (const chunk of this.buffer) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.buffer.length = 0
    try {
      controller.enqueue(merged)
    } catch {
      /* stream cancelled */
    }
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

export function wrapFetch(_baseFetch: typeof globalThis.fetch) {
  const wrapped = async (input: string | URL | Request, init?: AdaptiveFetchOptions): Promise<Response> => {
    await Store.init()
    initLogger()

    const startTime = Date.now()
    const requestId = crypto.randomUUID()
    const timeoutMs = init?.gatewayTimeoutMs || 600000
    const isStream = init?.gatewayStream ?? bodyRequestsStream(init?.body)

    const headers = Object.fromEntries(new Headers(init?.headers ?? {}).entries())

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
    const endpointKind = (headers["x-opencode-endpoint-kind"] || "chat") as RouteKey["endpointKind"]

    const classifyInput: Classifier.ClassifyInput = {
      hasTools: headers["x-opencode-has-tools"] === "true",
      streaming: isStream,
      maxTokens: headers["x-opencode-max-tokens"] ? parseInt(headers["x-opencode-max-tokens"]) : undefined,
      contextTokens: headers["x-opencode-context-tokens"] ? parseInt(headers["x-opencode-context-tokens"]) : undefined,
      hasAttachments: headers["x-opencode-has-attachments"] === "true",
    }

    const shapeClass = Classifier.classify(classifyInput)
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`

    const modelProtocol = resolveGatewayProtocol(provider, init?.gatewayProtocol)

    const baseRouteKey: RouteKey = {
      provider,
      baseUrl,
      model,
      endpointKind: endpointKind,
      stream: isStream,
      requestShapeClass: shapeClass,
    }

    // Determine streaming preference from config or stored route adjustment
    const streamingEnabled = init?.gatewayStreaming ?? Store.getStreamingEnabled(baseRouteKey)
    const effectiveStream = streamingEnabled ? isStream : false

    const routeKey: RouteKey = {
      ...baseRouteKey,
      stream: effectiveStream,
    }

    const keyStr = toRouteKeyString(routeKey)
    const adjustment = Store.getRoute(routeKey)
    const policy = adjustment.policy
    const score = healthScore(adjustment.health)

    const debugCfg = getDebugConfig()
    const rawBody =
      debugCfg.logBodies && init?.body
        ? typeof init.body === "string"
          ? init.body
          : JSON.stringify(init.body)
        : undefined

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
      }),
    })

    if (perRequestLogger && debugCfg.perRequest) {
      perRequestLogger.log({
        level: "INFO",
        event: "gateway.request.per_request",
        timestamp: startTime,
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
        headers: sanitizedLogHeaders,
        ...(rawBody && { body: rawBody, bodySize: rawBody.length }),
      })

      // Write request-to-request git-format diff as a separate .diff file
      if (rawBody && prevRequestBody) {
        const logDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
        const diffDir = path.join(logDir, "per-request")
        fs.mkdirSync(diffDir, { recursive: true })
        const d = new Date(startTime)
        const pad = (n: number, len = 2) => String(n).padStart(len, "0")
        const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
          `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}Z`
        const sanitizedId = String(requestId).replace(/[^a-zA-Z0-9_-]/g, "_")
        const diffPath = path.join(diffDir, `${iso}-${sanitizedId}.diff`)
        const diffLabel = (id: string, ts: number) => `${id} ${new Date(ts).toISOString()}`
        const diffContent = unifiedDiff(
          prevRequestBody.body,
          rawBody,
          diffLabel(prevRequestBody.requestId, prevRequestBody.timestamp),
          diffLabel(requestId, startTime),
        )
        fs.writeFileSync(diffPath, diffContent + "\n")
      }
      prevRequestBody = { requestId, timestamp: startTime, body: rawBody ?? "" }
    }

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
      try {
        const useH2 = modelProtocol === "h2"

        log.info("gateway.protocol.decision", {
          provider,
          model,
          configured: modelProtocol,
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
                method: init?.method ?? "POST",
                headers: headers,
                body: typeof init?.body === "string" ? init.body : undefined,
              })
              usedProtocol = "h2"
              response = h2Result.response
            } else {
              const h2Result = await H2.request({
                baseUrl,
                url,
                method: init?.method ?? "POST",
                headers: headers,
                body: typeof init?.body === "string" ? init.body : undefined,
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

                  H2.closeSession(baseUrl)

                  usedProtocol = "http/1.1"
                  const h1Result = await H1.request({
                    url,
                    method: init?.method ?? "POST",
                    headers,
                    body: typeof init?.body === "string" ? init.body : undefined,
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

              H2.closeSession(baseUrl)

              usedProtocol = "http/1.1"
              const h1Result = await H1.request({
                url,
                method: init?.method ?? "POST",
                headers,
                body: typeof init?.body === "string" ? init.body : undefined,
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
            method: init?.method ?? "POST",
            headers,
            body: typeof init?.body === "string" ? init.body : undefined,
            signal: init?.signal ?? undefined,
          })
          response = new Response(h1Result.body, {
            status: h1Result.status,
            headers: h1Result.headers,
          })
        }

        sample.headersReceivedAt = Date.now()
        sample.status = response.status
      } catch (err) {
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
        const coalescer = new CoalescingTransform()
        const trackedBody = response.body
          .pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                coalescer.push(chunk, controller)
              },
              flush(controller) {
                coalescer.flush(controller)
              },
            }),
          )
          .pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                if (firstChunk) {
                  sample.firstChunkAt = Date.now()
                  firstChunk = false
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

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\opencode\\packages/opencode/src/provider/gateway/adaptive-client.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\opencode\\packages/opencode/src/provider/gateway/adaptive-client.ts.backup_20260517T202649_455778"
//   "created_at": "2026-05-17T12:26:49.472980+00:00"
//   "backup_hash": "63df25d91281247765b2c7c16b6ae0f1"
//   "new_hash": "fc0c52540e09934d517a42399f4eb6db"
//   "goal_id": "gateway_use_body_stream_detection"
//   "semantics": "Use explicit gateway stream flag when present, otherwise infer stream intent from JSON body."
//   "update_attrs": {"relative_path": "packages/opencode/src/provider/gateway/adaptive-client.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "const isStream = init?.gatewayStream || false", "replace_present": true}
//   "restore_cmd": "python -m adm --rollback \"D:\\zPython\\opencode\\packages/opencode/src/provider/gateway/adaptive-client.ts\""
// }
