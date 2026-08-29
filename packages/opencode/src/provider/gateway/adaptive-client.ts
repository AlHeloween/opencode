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
import { collectReasoning, renderIntegrityReport, renderLineDiff, renderReasoningMarkdown } from "./raw-diff"
import path from "path"
import { EOL } from "os"
import fs from "fs"
import type { AsyncLogger, PerRequestLogger } from "./async-logger"
import { make as makeAsyncLogger, makePerRequest, readableResponseBody } from "./async-logger"
import type { ResolvedDebugConfig } from "./debug-config"

const log = Log.create({ service: "gateway.adaptive-client" })

const limiterState = Limiter.makeState()
const streamState = StreamBudget.makeState()
let loggingEnabled = false
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
  return debugConfig ?? { debug: false, logBodies: false, logResponseBodies: false, perRequest: false }
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

/**
 * Produce wire-format headers for logging: no auth, no internal x-opencode-*.
 * Matches both transport filters while keeping credentials out of diagnostics.
 */
function wireHeaders(headers: Record<string, string>): Record<string, string> {
  const withoutInternal = Object.fromEntries(
    Object.entries(headers).filter(([k]) => !k.toLowerCase().startsWith("x-opencode-")),
  )
  return sanitizeHeaders(withoutInternal)
}

/**
 * Parse a JSON string for embedding as a structured value in dumps.
 * Falls back to the original string if parsing fails.
 */
function tryParseJSON(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * Collapse the SDK's dual reasoning dialect to the vendor-native single field:
 * assistant `reasoning` (+ duplicate `reasoning_details`) -> `reasoning_content`,
 * placed in the vendor-canonical position BEFORE `tool_calls` (thinking precedes
 * the calls it motivates). Key order is rebuilt; bodies stay minified.
 * Tool-call turns always carry the field — empty string when the model produced
 * no CoT at all (strict vendor paths 400 on a missing field).
 */
function rewriteReasoningContent(body: string): string {
  try {
    const parsed = JSON.parse(body) as { messages?: Array<Record<string, unknown>> }
    const messages = parsed.messages ?? []
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index]!
      if (message.role !== "assistant") continue
      const reasoning = typeof message.reasoning === "string" ? message.reasoning : undefined
      const details = Array.isArray(message.reasoning_details) ? message.reasoning_details : undefined
      const hasToolCalls = Array.isArray(message.tool_calls)
      if (reasoning === undefined && details === undefined && !hasToolCalls) continue
      const text =
        reasoning ??
        (details ?? []).map((detail) => (typeof (detail as any)?.text === "string" ? (detail as any).text : "")).join("")
      delete message.reasoning
      delete message.reasoning_details
      // Final answers without CoT carry no field at all.
      if (!text && !hasToolCalls) continue
      const value = text || ""
      // Vendor-canonical shape: {role, content, reasoning_content, tool_calls}.
      const rebuilt: Record<string, unknown> = {}
      let placed = false
      for (const [key, item] of Object.entries(message)) {
        if (key === "tool_calls" && !placed) {
          rebuilt.reasoning_content = value
          placed = true
        }
        if (key !== "reasoning_content") rebuilt[key] = item
      }
      if (!placed) rebuilt.reasoning_content = value
      messages[index] = rebuilt
    }
    return JSON.stringify(parsed)
  } catch {
    return body
  }
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

  export function requestMetadata(body: RequestInit["body"] | undefined): { model?: string; streaming: boolean } {
    if (typeof body !== "string") return { streaming: false }
    if (!body.trimStart().startsWith("{")) return { streaming: false }
    try {
      const parsed = JSON.parse(body) as unknown
      if (!parsed || typeof parsed !== "object") return { streaming: false }
      const value = parsed as { model?: unknown; stream?: unknown }
      return {
        ...(typeof value.model === "string" && { model: value.model }),
        streaming: value.stream === true,
      }
    } catch (error) {
      log.debug("gateway.stream.detect_failed", {
        error: error instanceof Error ? error.message : String(error),
      })
      return { streaming: false }
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
    // Vendor-native reasoning round-trip: the OpenRouter SDK dialect (v2 and v3
    // alike) emits `reasoning` + `reasoning_details` — two copies of the same
    // text on 100% of assistant messages (wire-proven 2026-08-28: 334k chars /
    // ~19% of the body duplicated). DeepSeek + Z.AI contracts define a single
    // native field `reasoning_content` (with tools: full round-trip mandatory;
    // without tools: ignored). Rewrite GLM/DeepSeek bodies here — the only seam
    // the SDKs leave us — so the wire carries exactly one reasoning field.
    if (typeof init?.body === "string" && /z-ai\/|glm|deepseek/i.test(String(init?.gatewayModel ?? ""))) {
      init = { ...init, body: rewriteReasoningContent(init.body) }
    }
      const metadata = requestMetadata(init?.body)
      const isStream = init?.gatewayStream ?? metadata.streaming

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
      const model = metadata.model || init?.gatewayModel || headers["x-opencode-model"] || "unknown"
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
    const captureRequestBody = debugCfg.logBodies || debugCfg.perRequest
    const captureResponseBody = debugCfg.logResponseBodies || debugCfg.perRequest
    const rawBody =
      captureRequestBody && init?.body
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
        type: "request",
        timestamp: startTime,
        id: requestId,
        method: (init?.method || "GET").toUpperCase(),
        url,
        headers: wireHeaders(headers),
        ...(rawBody && { body: rawBody }),
      })

      // Request-to-request diff: line-based over the PRETTY bodies (real
      // newlines, zero content filtering — special chars stay visible) plus a
      // short integrity report against the recommended wire flow. The old
      // byte-true report over one-line JSON was unreadable by eye — the
      // kernel triplication was found manually, not by it.
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
        const pretty = (raw: string): string => {
          const parsed = tryParseJSON(raw)
          return typeof parsed === "string" ? raw : JSON.stringify(parsed, null, 2)
        }
        const report =
          renderIntegrityReport({ body: tryParseJSON(rawBody) }) +
          renderLineDiff({
            prevId: prevRequestBody.requestId,
            prevRaw: pretty(prevRequestBody.body),
            currId: requestId,
            currRaw: pretty(rawBody),
          })
        fs.writeFileSync(diffPath, report + EOL)
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

      // ── Raw wire dump (debug) ──
      if (debugCfg.perRequest && init?.body) {
        try {
          const wireDir = path.join(
            process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway"),
            "raw-wire",
          )
          fs.mkdirSync(wireDir, { recursive: true })
          const d = new Date()
          const pad = (n: number, len = 2) => String(n).padStart(len, "0")
          const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
            `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}Z`
          const sanitizedId = String(requestId).replace(/[^a-zA-Z0-9_-]/g, "_")
          const bodyStr = typeof init.body === "string" ? init.body : JSON.stringify(init.body)
          fs.writeFileSync(
            path.join(wireDir, `${iso}-${sanitizedId}.json`),
            JSON.stringify({
              url,
              method: (init?.method || "POST").toUpperCase(),
              headers: wireHeaders(headers),
              body: tryParseJSON(bodyStr),
            }, null, 2).replace(/\n/g, EOL),
          )
        } catch (e) {
          log.debug("raw-wire dump failed", { error: String(e), requestId })
        }
      }
      // ── End raw wire dump ──

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

      const responseBodyChunks: Uint8Array[] = []
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
                if (captureResponseBody) {
                  responseBodyChunks.push(chunk)
                }
                controller.enqueue(chunk)
              },
              async flush() {
                sample.endedAt = Date.now()
                const metrics = Metrics.computeMetrics(sample)
                const endEntry: Record<string, unknown> = {
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
                }
                if (captureResponseBody && responseBodyChunks.length > 0) {
                  const decoder = new TextDecoder()
                  const fullRaw = responseBodyChunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode()
                  const raw = debugCfg.perRequest
                    ? fullRaw
                    : fullRaw.length > 65536
                      ? `${fullRaw.slice(0, 65536)}\n... (response body truncated at 64KB, total ${fullRaw.length} bytes)`
                      : fullRaw
                  if (raw !== fullRaw) {
                    endEntry.bodyTruncated = true
                  }
                  // Under perRequest the body lands in per-response files
                  // (.json metadata + .raw.txt literal) — no inline copy in
                  // the JSONL log (disk hygiene).
                  if (!debugCfg.perRequest) {
                    endEntry.body = raw
                  }
                  endEntry.bodySize = raw.length
                  // Write per-response JSON file (mirrors per-request)
                  if (debugCfg.perRequest) {
                    const responseLogDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
                    const d = new Date()
                    const pad = (n: number, len = 2) => String(n).padStart(len, "0")
                    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
                      `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}Z`
                    const sanitizedId = String(requestId).replace(/[^a-zA-Z0-9_-]/g, "_")
                    const responseDir = path.join(responseLogDir, "per-response")
                    fs.mkdirSync(responseDir, { recursive: true })
                    const responsePath = path.join(responseDir, `${iso}-${sanitizedId}.json`)
                    const resHeaders: Record<string, string> = {}
                    response.headers.forEach((v, k) => { resHeaders[k] = v })
                    // Write per-response capture: metadata JSON + the literal
                    // raw stream as a sidecar. No parsed `body` and no escaped
                    // `body_raw` in the JSON — both were re-serializations that
                    // doubled every file and could mask special characters.
                    fs.writeFileSync(responsePath, JSON.stringify({
                      type: "response",
                      timestamp: d.getTime(),
                      id: requestId,
                      status: response.status,
                      headers: wireHeaders(resHeaders),
                    }, null, 2).replace(/\n/g, EOL))
                    // Literal raw stream: the exact wire body with its own real
                    // newlines — no filtering, no re-serialization.
                    fs.writeFileSync(path.join(responseDir, `${iso}-${sanitizedId}.raw.txt`), fullRaw)
                    // Reasoning sidecar: assembled delta.reasoning / reasoning_details text.
                    const reasoning = collectReasoning(readableResponseBody(raw, isStream))
                    if (reasoning.text.trim().length > 0) {
                      fs.writeFileSync(
                        path.join(responseDir, `${iso}-${sanitizedId}.md`),
                        renderReasoningMarkdown({
                          id: requestId,
                          captured: iso,
                          status: response.status,
                          collect: reasoning,
                        }) + EOL,
                      )
                    }
                  }
                }
                writeLog(endEntry)
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

      const endEntry: Record<string, unknown> = {
        level: "INFO",
        event: "gateway.request.end",
        timestamp: Date.now(),
        requestId,
        status: response.status,
        noBody: true,
        metrics: {
          totalMs: metrics.totalMs,
          ttftMs: metrics.ttftMs,
          ttfbMs: metrics.ttfbMs,
          queuedMs: metrics.queuedMs,
          chunks: metrics.chunks,
          avgChunkGapMs: metrics.avgChunkGapMs,
        },
        healthScore: Math.round(healthScore(Store.getRoute(routeKey).health) * 100) / 100,
      }
      writeLog(endEntry)

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

