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
import { assembleMessage, renderIntegrityReport, renderLineDiff, renderRawWirePseudoDiff, renderResponseMarkdown } from "./raw-diff"
import path from "path"
import { EOL } from "os"
import fs from "fs"
import type { AsyncLogger, PerRequestLogger } from "./async-logger"
import { make as makeAsyncLogger, makePerRequest, readableResponseBody } from "./async-logger"
import type { ResolvedDebugConfig } from "./debug-config"
import { applyTemporaryDataAcquisition, parseTdaHeader } from "./tda"
import { exchangeStem, isoFileStamp, writeWireAttempt } from "./wire-capture"
import { GlobalBus } from "@/bus/global"

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
/** Previous raw-wire body for the two-level pseudo-diff. */
let prevWireBody: { requestId: string; body: unknown } | undefined

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

export type GatewayProtocol = "auto" | "h3" | "h2" | "http/1.1"

export type TransportProtocol = "h3" | "h2" | "http/1.1"

// Transport policy (owner directive 2026-09-24): attempt h3 first, downgrade
// to h2, keep http/1.1 strictly as the last resort — h1 is not a recommended
// rung. `auto` is the default for every provider: the first request probes h3
// and the outcome is cached per origin (h3UnavailableUntil), so an origin
// without QUIC pays for one failed probe per TTL, not per request.
// Verified per-provider rungs still ride `options.protocol` from the catalog
// (e.g. novita-ai h3), and an explicit user choice always wins over `auto`.
export function resolveGatewayProtocol(_provider: string, configured?: GatewayProtocol): GatewayProtocol {
  if (configured) return configured
  return "auto"
}

/** Ordered downgrade chain; an explicit h3 choice ignores the probe cache. */
export function protocolChain(configured: GatewayProtocol, h3CachedDead: boolean): TransportProtocol[] {
  if (configured === "http/1.1") return ["http/1.1"]
  if (configured === "h2") return ["h2", "http/1.1"]
  if (configured === "h3") return ["h3", "h2", "http/1.1"]
  return h3CachedDead ? ["h2", "http/1.1"] : ["h3", "h2", "http/1.1"]
}

/**
 * Downgrade decision per rung. h3 leaves on ANY transport failure: a QUIC
 * handshake failure normalizes to tls_error (`/handshake/` matches it) and
 * shouldFallbackToH1 refuses that category — reusing that rule here would
 * abort the request instead of trying h2. h2 keeps its established rule.
 */
export function shouldDowngrade(from: TransportProtocol, error: Errors.NormalizedError): boolean {
  if (error.category === "client_abort") return false
  if (from === "h3") return true
  if (from === "h2") return Errors.shouldFallbackToH1(error)
  return false
}

// Failed h3 probes are cached per origin: the next `auto` request skips QUIC
// for this long instead of paying for another fast-fail handshake.
const H3_PROBE_TTL_MS = 30 * 60 * 1000
// A probe must not stall a request if QUIC neither connects nor refuses.
const H3_PROBE_TIMEOUT_MS = 5000
const h3UnavailableUntil = new Map<string, number>()

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
 * Sensitive header NAME patterns whose VALUES are masked in captured logs.
 * The name is kept (owner decision 2026-09-24): a reader must see THAT a header
 * was present — `authorization: "***"` answers "was there auth?" where removal
 * cannot — and the redaction stays honest. `\btoken\b` matches a whole word, so
 * provider rate-limit headers like `x-ratelimit-remaining-tokens` survive
 * (substring matching used to drop them from every capture point).
 */
const SENSITIVE_HEADER_PATTERNS = [
  "auth",
  "authorization",
  "\\btoken\\b",
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

const MASKED_HEADER_VALUE = "***"

/**
 * Mask sensitive header VALUES in a copy of the set; names stay visible.
 * This prevents any OAuth/internal authentication data from reaching disk.
 */
const sensitiveRegex = new RegExp(SENSITIVE_HEADER_PATTERNS.map((p) => p.replace(/[-_]/g, "[-_]?")).join("|"), "i")

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = sensitiveRegex.test(key) ? MASKED_HEADER_VALUE : value
  }
  return sanitized
}

/**
 * Produce wire-format headers for LOGGING only: internal x-opencode-* names
 * are dropped, sensitive VALUES masked (names kept). Transports send the real
 * headers VERBATIM (no filtering, user directive 2026-09-07); this view exists
 * solely for diagnostics.
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
 *
 * A body that ALREADY carries native `reasoning_content` — every DeepSeek SDK
 * request does, the provider writes the field itself — has no dialect to
 * collapse. Such a message is passed through, not rebuilt from the absent
 * `reasoning`/`reasoning_details` pair: reading those on a native body yields
 * "", and writing that back erased the real chain of thought on every
 * tool-call turn (measured 2026-09-15: 32 messages entered the provider with
 * text, 0 left this function with any).
 */
export function rewriteReasoningContent(body: string): string {
  try {
    const parsed = JSON.parse(body) as { messages?: Array<Record<string, unknown>> }
    const messages = parsed.messages ?? []
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index]!
      if (message.role !== "assistant") continue
      const reasoning = typeof message.reasoning === "string" ? message.reasoning : undefined
      const details = Array.isArray(message.reasoning_details) ? message.reasoning_details : undefined
      const native = typeof message.reasoning_content === "string" ? message.reasoning_content : undefined
      const hasToolCalls = Array.isArray(message.tool_calls)
      if (reasoning === undefined && details === undefined && native === undefined && !hasToolCalls) continue
      const dialect =
        reasoning ??
        (details ?? []).map((detail) => (typeof (detail as any)?.text === "string" ? (detail as any).text : "")).join("")
      // The dialect wins when it carries text; otherwise keep the native field.
      // `||` not `??` on purpose — an empty dialect must not outrank real CoT.
      const text = dialect || native || ""
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
      // Faithful round-trip: EVERY Z.AI/GLM assistant stream carries content ""
      // deltas — the opening delta and the closing deltas at finish_reason
      // (live capture e8e488a8: even a no-CoT turn with reasoning_tokens=0
      // closes with content:""). Message-level content for a no-text turn is
      // therefore ALWAYS ""; the SDK's `text || null` (dist/index.js:3204)
      // destroys it into null. Null appears only in mid-stream tool-call
      // deltas, which never define message-level content — restore ""
      // unconditionally: input "" -> output "".
      if (rebuilt.content === null || rebuilt.content === undefined) {
        rebuilt.content = ""
      }
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
    // Three-point capture key (T4): every point of one exchange writes under a
    // single stem so intent / sent / received sort and match together.
    const startIso = isoFileStamp(startTime)
    const stem = exchangeStem(startIso, requestId)
    // Intent snapshot (T1): taken HERE — before the reasoning rewrite below and
    // before credential/TDA consumption — the verbatim record of what we were
    // asked to send. Masking happens at write time only; the wire is untouched.
    const intentHeaders: Record<string, string> = Object.fromEntries(new Headers(init?.headers ?? {}).entries())
    const intentBody =
      typeof init?.body === "string"
        ? init.body
        : init?.body !== undefined && init?.body !== null
          ? JSON.stringify(init.body)
          : undefined
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

    const headers: Record<string, string> = { ...intentHeaders }

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

    // Consumed credential inputs are removed from the outgoing set (they were
    // folded into real headers above; duplicating a bearer under a nonstandard
    // name would leak it into provider request logs). Correlation headers
    // (x-opencode-session/request/project/client, x-request-id, x-session-id…)
    // stay verbatim — transports do not filter anything (user directive 2026-09-07).
    delete headers["x-opencode-oauth-token"]
    delete headers["X-Opencode-Oauth-Token"]
    delete headers["x-opencode-account-id"]
    delete headers["X-Opencode-Account-Id"]
    delete headers["x-opencode-oauth-url"]
    delete headers["X-Opencode-Oauth-Url"]

    // Temporary data acquisition: the runtime OWNS the set and hands it over in a header; this layer
    // WITHHOLDS what has been released or let expire and leaves everything else as it was. Withholding
    // needs no payload source — the payload is already in the body — and re-attaching from here would
    // mean the gateway holding image bytes, which the design refuses. It runs AFTER the reasoning
    // rewrite so it sees the body that will actually go out, and it applies only when the runtime
    // declared a set: the ABSENCE of the header is the flag being off, so the switch stays where the
    // authority is — and the transform can short-circuit to zero cost when nothing is held.
    const tda = parseTdaHeader(headers["x-opencode-tda"])
    if (tda && typeof init?.body === "string") {
      init = { ...init, body: applyTemporaryDataAcquisition(init.body, tda.set, tda.turn) }
    }
    // Consumed like the credential headers above: it has been folded into the body, and an instruction
    // the provider can read is noise at best.
    delete headers["x-opencode-tda"]

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
    // Master switch: gateway.logging.enabled silences ALL diagnostic IO.
    // Without this gate the perRequest body capture (memory + per-response
    // files) and the raw-wire dumps ran even with logging disabled —
    // "пожизненная отладка" (2026-09-02, Alexander). The per-request diff
    // chain was already doubly gated (perRequestLogger needs enabled); these
    // two were not.
    const captureResponseBody = loggingEnabled && (debugCfg.logResponseBodies || debugCfg.perRequest)

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
        fileName: `${stem}.json`,
        method: (init?.method || "GET").toUpperCase(),
        url,
        // The INTENT record: incoming headers BEFORE credential consumption —
        // names kept (incl. x-opencode-*), secret values masked (T5); the body
        // is the VERBATIM incoming string. Parse/pretty are derived views
        // (the .diff sidecar), never the stored record.
        headers: sanitizeHeaders(intentHeaders),
        ...(intentBody !== undefined && { body: intentBody }),
      })

      // Request-to-request diff: line-based over the PRETTY forms derived from
      // the verbatim intent strings (real newlines, zero content filtering —
      // special chars stay visible). The wire-shape integrity report lives on
      // the raw-wire side, where the ACTUAL outgoing body is the subject.
      if (prevRequestBody && intentBody !== undefined) {
        const logDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
        const diffDir = path.join(logDir, "per-request")
        fs.mkdirSync(diffDir, { recursive: true })
        const pretty = (raw: string): string => {
          const parsed = tryParseJSON(raw)
          return typeof parsed === "string" ? raw : JSON.stringify(parsed, null, 2)
        }
        const report = renderLineDiff({
          prevId: prevRequestBody.requestId,
          prevRaw: pretty(prevRequestBody.body),
          currId: requestId,
          currRaw: pretty(intentBody),
        })
        fs.writeFileSync(path.join(diffDir, `${stem}.diff`), report + EOL)
      }
      if (intentBody !== undefined) prevRequestBody = { requestId, timestamp: startTime, body: intentBody }
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
      let response!: Response
      let usedProtocol: TransportProtocol = "http/1.1"
      let servedAttempt = 0

      // ── Wire capture (one record per ATTEMPT) ──
      // Written from INSIDE the transport seam — h3 at its fetch call below;
      // h2 inside the transport with the pseudo-header set it hands to node;
      // h1 inside the transport (its options carry `onWire`). Requires the
      // master switch too — enabled=false must stop capture, not just the
      // event logs (2026-09-02, Alexander).
      const captureWire = debugCfg.perRequest && loggingEnabled
      const wireDir = path.join(
        process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway"),
        "raw-wire",
      )
      let wireAttempt = 0
      const captureWireAttempt = (
        protocol: TransportProtocol,
        wireHeaderSet: Record<string, string>,
        wireBody: string | ArrayBuffer | Uint8Array | undefined,
      ): void => {
        if (!captureWire || wireBody === undefined) return
        wireAttempt++
        const bodyStr = typeof wireBody === "string" ? wireBody : JSON.stringify(wireBody)
        writeWireAttempt({
          dir: wireDir,
          stem,
          requestId,
          attempt: wireAttempt,
          protocol,
          url,
          method: (init?.method || "POST").toUpperCase(),
          headers: sanitizeHeaders(wireHeaderSet),
          body: bodyStr,
        })
        // Derived views (never stored instead of the verbatim record): the
        // wire-shape integrity report plus the two-level pseudo-diff vs the
        // previous wire body. LEVEL 1 — JSON structure; LEVEL 2 — messages
        // rendered as MD; unchanged messages collapse to one line.
        try {
          const parsed = tryParseJSON(bodyStr)
          const parts: string[] = [renderIntegrityReport({ body: parsed })]
          if (prevWireBody) {
            parts.push(
              renderRawWirePseudoDiff({
                prevId: prevWireBody.requestId,
                currId: String(requestId),
                prev: prevWireBody.body,
                curr: parsed,
              }),
            )
          }
          fs.mkdirSync(wireDir, { recursive: true })
          fs.writeFileSync(path.join(wireDir, `${stem}-attempt${wireAttempt}.diff`), parts.join(""))
        } catch (e) {
          log.warn("bug: raw-wire derived view failed", {
            error: e instanceof Error ? e.message : String(e),
            requestId,
          })
        }
        prevWireBody = { requestId, body: tryParseJSON(bodyStr) }
      }
      // Error responses that never reach the body pipeline (h3 5xx, h2
      // non-stream TransportError) still get a per-response record (T3): the
      // body a provider returned to explain a failure is diagnostic gold.
      const captureErrorResponse = (input: {
        attempt: number
        protocol: TransportProtocol
        status: number
        headers: Record<string, string>
        body: string
      }): void => {
        if (!debugCfg.perRequest || !loggingEnabled) return
        try {
          const errorDir = path.join(
            process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway"),
            "per-response",
          )
          fs.mkdirSync(errorDir, { recursive: true })
          const errorStem = `${stem}-attempt${input.attempt}`
          fs.writeFileSync(
            path.join(errorDir, `${errorStem}.json`),
            JSON.stringify({
              type: "response",
              timestamp: Date.now(),
              id: requestId,
              status: input.status,
              state: "error",
              protocol: input.protocol,
              headers: sanitizeHeaders(input.headers),
              message: null,
            }, null, 2).replace(/\n/g, EOL),
          )
          // Literal error body: the exact bytes the provider returned — no
          // parse, no assembly (there is no assistant message in it).
          fs.writeFileSync(path.join(errorDir, `${errorStem}.raw.txt`), input.body)
        } catch (e) {
          log.warn("bug: per-response error capture failed", {
            error: e instanceof Error ? e.message : String(e),
            requestId,
          })
        }
      }
      // ── End wire capture ──

      try {
        // Downgrade chain (owner directive 2026-09-24): h3 -> h2 -> http/1.1.
        // `auto` probes h3 first; an origin whose h3 probe failed is skipped
        // for H3_PROBE_TTL_MS — the failure was transport-level, so h2 is
        // attempted next and h1 remains the last resort.
        const h3CachedDead = modelProtocol === "auto" && (h3UnavailableUntil.get(baseUrl) ?? 0) > Date.now()
        const chain = protocolChain(modelProtocol, h3CachedDead)

        log.info("gateway.protocol.decision", {
          provider,
          model,
          configured: modelProtocol,
          using: chain[0],
          chain: chain.join(">"),
          streaming: routeKey.stream,
        })

        if (asyncLogger) {
          asyncLogger.log({
            level: "INFO",
            event: "gateway.protocol.decision",
            provider,
            model,
            configured: modelProtocol,
            using: chain[0],
            chain: chain.join(">"),
          })
        }

        let attemptFailure: unknown = null

        for (let i = 0; i < chain.length; i++) {
          const protocol = chain[i]
          try {
            if (protocol === "h3") {
              // Bun pinned-protocol fetch ({ protocol: "http3" }), experimental
              // client (1.3.14+); proven live on api.novita.ai and api.openai.com.
              // Under `auto` the probe is bounded so a hanging QUIC attempt
              // cannot stall the request; an explicit h3 rides the caller signal.
              const timeout = modelProtocol === "auto" ? AbortSignal.timeout(H3_PROBE_TIMEOUT_MS) : undefined
              const probeSignals: AbortSignal[] = []
              if (init?.signal) probeSignals.push(init.signal)
              if (timeout) probeSignals.push(timeout)
              const signal =
                probeSignals.length === 0 ? undefined : probeSignals.length === 1 ? probeSignals[0] : AbortSignal.any(probeSignals)
              const h3Body = typeof init?.body === "string" ? init.body : undefined
              captureWireAttempt("h3", headers, h3Body)
              const h3Res = await fetch(url, {
                method: init?.method ?? "POST",
                headers,
                body: h3Body,
                signal,
                // @ts-expect-error Bun-specific RequestInit extension (blog 1.3.14)
                protocol: "http3",
              })
              // Hard 5xx is transport-class; 4xx is a real client-side answer.
              // The 5xx body is read BEFORE the throw — otherwise the one
              // response that explains the downgrade is discarded (T3).
              if (h3Res.status >= 500) {
                const errorBody = await h3Res.text().catch((e) => {
                  log.debug("gateway.h3_error_body_read_failed", { error: String(e), requestId })
                  return ""
                })
                captureErrorResponse({
                  attempt: wireAttempt || i + 1,
                  protocol: "h3",
                  status: h3Res.status,
                  headers: Object.fromEntries(h3Res.headers.entries()),
                  body: errorBody,
                })
                throw new Error(`h3 upstream ${h3Res.status}`)
              }
              response = h3Res
            } else if (protocol === "h2") {
              if (routeKey.stream) {
                const h2Result = await H2.requestStream({
                  baseUrl,
                  url,
                  method: init?.method ?? "POST",
                  headers: headers,
                  body: typeof init?.body === "string" ? init.body : undefined,
                  onWire: (wireHeaderSet, wireBody) => captureWireAttempt("h2", wireHeaderSet, wireBody),
                })
                response = h2Result.response
              } else {
                const h2Result = await H2.request({
                  baseUrl,
                  url,
                  method: init?.method ?? "POST",
                  headers: headers,
                  body: typeof init?.body === "string" ? init.body : undefined,
                  onWire: (wireHeaderSet, wireBody) => captureWireAttempt("h2", wireHeaderSet, wireBody),
                })
                if (h2Result.error) {
                  captureErrorResponse({
                    attempt: wireAttempt || i + 1,
                    protocol: "h2",
                    status: h2Result.status,
                    headers: h2Result.headers,
                    body: typeof h2Result.body === "string" ? h2Result.body : "",
                  })
                  throw new Errors.TransportError({
                    status: h2Result.status,
                    headers: h2Result.headers,
                    body: h2Result.body,
                    metrics: h2Result.metrics,
                    error: h2Result.error,
                    requestId: h2Result.requestId,
                  })
                }
                response = new Response(h2Result.body, {
                  status: h2Result.status,
                  headers: h2Result.headers,
                })
              }
            } else {
              const h1Result = await H1.request({
                url,
                method: init?.method ?? "POST",
                headers,
                body: typeof init?.body === "string" ? init.body : undefined,
                signal: init?.signal ?? undefined,
                onWire: (wireHeaderSet, wireBody) => captureWireAttempt("http/1.1", wireHeaderSet, wireBody),
              })
              response = new Response(h1Result.body, {
                status: h1Result.status,
                headers: h1Result.headers,
              })
            }
            usedProtocol = protocol
            servedAttempt = wireAttempt > 0 ? wireAttempt : i + 1
            if (protocol === "h3") h3UnavailableUntil.delete(baseUrl)
            break
          } catch (err) {
            const normalized = err instanceof Errors.TransportError ? err.error : Errors.normalizeError(err)
            if (normalized.category === "client_abort") throw err
            if (protocol === "h3" && modelProtocol === "auto") {
              h3UnavailableUntil.set(baseUrl, Date.now() + H3_PROBE_TTL_MS)
            }
            const next = chain[i + 1]
            if (!next || !shouldDowngrade(protocol, normalized)) {
              attemptFailure = err
              break
            }
            writeLog({
              level: "WARN",
              event: "gateway.protocol.fallback",
              timestamp: Date.now(),
              requestId,
              provider,
              model,
              fromProtocol: protocol,
              toProtocol: next,
              reason: normalized.category,
              message: normalized.message,
            })
            if (protocol === "h2") H2.closeSession(baseUrl)
          }
        }

        if (attemptFailure) throw attemptFailure

        // The gateway runs in the server worker. Publish the successful rung
        // through the existing worker-to-TUI event bridge, correlated to the
        // request that produced the visible assistant turn.
        const clientRequestID = intentHeaders["x-request-id"]
        if (clientRequestID) {
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: "gateway.protocol.selected",
              properties: {
                requestID: clientRequestID,
                providerID: provider,
                modelID: init?.gatewayModel || model,
                protocol: usedProtocol,
                at: Date.now(),
              },
            },
          })
        }

        sample.headersReceivedAt = Date.now()
        sample.status = response.status
      } catch (err) {
        const normalized = Errors.normalizeError(err)
        // Client-initiated abort is not a provider fault: no health error,
        // no circuit-breaker failure, no route policy downgrade.
        if (normalized.category !== "client_abort") {
          Store.recordError(routeKey, normalized.category, Date.now() - startTime)
          Store.recordCircuitBreakerFailure(routeKey)
          Store.adaptRoutePolicy(routeKey, false, 0)
        }

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
        let ended = false
        const coalescer = new CoalescingTransform()
        const finalizeResponse = (state: "complete" | "aborted" | "error") => {
          if (ended) return
          ended = true
          sample.endedAt = Date.now()
          const metrics = Metrics.computeMetrics(sample)
          const endEntry: Record<string, unknown> = {
            level: "INFO",
            event: "gateway.request.end",
            timestamp: Date.now(),
            requestId,
            status: response.status,
            state,
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
            // Per-response capture (T3): one file set per ATTEMPT that produced
            // a response; `state` records HOW the stream ended — an abort or a
            // mid-stream source error still leaves everything that arrived.
            if (debugCfg.perRequest) {
              try {
                const responseLogDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
                const responseDir = path.join(responseLogDir, "per-response")
                fs.mkdirSync(responseDir, { recursive: true })
                const responseStem = `${stem}-attempt${servedAttempt || 1}`
                const resHeaders: Record<string, string> = {}
                response.headers.forEach((v, k) => { resHeaders[k] = v })
                // Metadata + FULL assembled message in the JSON, literal raw
                // stream sidecar, and the human-readable assembled report. No
                // delta noise, no escaped duplicates.
                const assembled = assembleMessage(readableResponseBody(raw, isStream))
                fs.writeFileSync(path.join(responseDir, `${responseStem}.json`), JSON.stringify({
                  type: "response",
                  timestamp: Date.now(),
                  id: requestId,
                  status: response.status,
                  state,
                  headers: wireHeaders(resHeaders),
                  message: {
                    content: assembled.content,
                    reasoning_content: assembled.reasoning,
                    tool_calls: assembled.toolCalls,
                    finish_reason: assembled.finishReason,
                    usage: assembled.usage,
                  },
                }, null, 2).replace(/\n/g, EOL))
                // Literal raw stream: the exact bytes as they arrived (captured
                // pre-coalesce), with their own real newlines — no filtering,
                // no re-serialization.
                fs.writeFileSync(path.join(responseDir, `${responseStem}.raw.txt`), fullRaw)
                fs.writeFileSync(
                  path.join(responseDir, `${responseStem}.md`),
                  renderResponseMarkdown({
                    id: requestId,
                    captured: responseStem,
                    status: response.status,
                    message: assembled,
                  }) + EOL,
                )
              } catch (e) {
                log.warn("bug: per-response capture failed", {
                  error: e instanceof Error ? e.message : String(e),
                  requestId,
                  state,
                })
              }
            }
          }
          writeLog(endEntry)
          if (state === "complete") {
            Store.recordSuccess(routeKey, metrics.totalMs, metrics.ttftMs)
            Store.recordCircuitBreakerSuccess(routeKey)
            Store.adaptRoutePolicy(routeKey, true, healthScore(Store.getRoute(routeKey).health))
          }
        }
        const source = response.body
          .pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                // Pre-coalesce capture (T3): bytes land here as they arrive, so
                // an aborted stream still has everything that reached us — the
                // coalescer's pending buffer is not needed to flush first.
                if (captureResponseBody) responseBodyChunks.push(chunk)
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
                finalizeResponse("complete")
              },
            }),
          )
        // Terminal observer (T3): a consumer cancel (user stop, session
        // interrupt) or a source error ends the exchange without `flush()`
        // running — each records its terminal state instead of losing the
        // capture. Backpressure is preserved: one upstream read per pull.
        const reader = source.getReader()
        const trackedBody = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read()
              if (done) {
                controller.close()
                return
              }
              controller.enqueue(value)
            } catch (error) {
              finalizeResponse("error")
              controller.error(error)
            }
          },
          async cancel(reason) {
            finalizeResponse("aborted")
            await reader.cancel(reason).catch((e) => {
              log.debug("gateway.stream.cancel_failed", {
                error: e instanceof Error ? e.message : String(e),
                requestId,
              })
            })
          },
        })

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
