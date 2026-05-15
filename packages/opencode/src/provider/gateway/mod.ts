import { Effect, Layer, Context } from "effect"
import path from "path"
import {
  wrapFetch,
  getGatewayStatus,
  logGatewayStatus,
  configureLogging,
  setDebugConfig,
  initLogger,
} from "./adaptive-client"
import * as Store from "./store"
import * as H2 from "./h2-transport"
import * as Log from "@opencode-ai/core/util/log"
import type { RouteKey } from "./route-key"
import { probe as probeCapability, type ProbeResult } from "./capability-probe"
import { loadGatewayConfig } from "./config-manager"
import { resolveDebugConfig } from "./debug-config"
import { LogRotator } from "./log-rotator"
import { Global } from "@opencode-ai/core/global"

const log = Log.create({ service: "gateway/service" })
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface Interface {
  readonly wrap: (fetch: Fetcher) => Fetcher
  readonly probe: (baseUrl: string) => Effect.Effect<ProbeResult, Error>
  readonly getStatus: () => Effect.Effect<GatewayStatus>
  readonly getRoutes: () => Effect.Effect<RouteInfo[]>
  readonly shutdown: () => Effect.Effect<void, Error>
}

export interface GatewayStatus {
  activeStreams: number
  inflightRequests: number
  h2Sessions: number
}

export interface RouteInfo {
  key: RouteKey
  protocol: string
  confidence: number
  healthScore: number
  minLaunchIntervalMs: number
  streamMinLaunchIntervalMs: number
  maxInflight: number
  maxStreams: number
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Gateway") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      log.info("gateway service starting")
    })

    // Load gateway config and configure logging + protocol preference
    yield* Effect.tryPromise({
      try: async () => {
        const config = await loadGatewayConfig()
        const logging = config.gateway?.logging
        if (logging) {
          configureLogging(logging.enabled ?? true, logging.format ?? "json")
        }
        // Set debug config (per-model overrides global)
        const debugCfg = resolveDebugConfig(config, null)
        setDebugConfig(debugCfg)
        // Initialize async logger after logging config is loaded
        initLogger()
        // Initialize log rotator
        const rotator = new LogRotator(process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway"))
        await rotator.init()
      },
      catch: (err) => {
        log.warn("failed to load gateway config, using defaults", {
          error: err instanceof Error ? err.message : String(err),
        })
      },
    })

    const wrap = (fetch: Fetcher) => wrapFetch(fetch as typeof globalThis.fetch) as Fetcher
    ;globalThis.__gatewayFetch = wrap(globalThis.fetch as Fetcher)

    const probe = (baseUrl: string) =>
      Effect.tryPromise({
        try: () => probeCapability(baseUrl),
        catch: (err: unknown) => new Error(err instanceof Error ? err.message : String(err)),
      })

    const getStatus = () => Effect.succeed(getGatewayStatus())

    const getRoutes = () =>
      Effect.sync(() => {
        const routes = Store.getAllRoutes()
        return routes.map((r) => ({
          key: r.key,
          protocol: r.adjustment.protocol.alpnNegotiated,
          confidence: r.adjustment.confidence,
          healthScore: r.metrics.successRate,
          minLaunchIntervalMs: r.adjustment.policy.minLaunchIntervalMs,
          streamMinLaunchIntervalMs: r.adjustment.policy.streamMinLaunchIntervalMs,
          maxInflight: r.adjustment.policy.maxInflight,
          maxStreams: r.adjustment.policy.maxStreams,
        }))
      })

    const shutdown = () =>
      Effect.tryPromise(() => Store.shutdown()).pipe(
        Effect.andThen(
          Effect.sync(() => {
            H2.closeAll()
            // Clear periodic status logging
            if (globalThis.__gatewayStatusInterval) {
              clearInterval(globalThis.__gatewayStatusInterval)
              delete globalThis.__gatewayStatusInterval
            }
          }),
        ),
      )

    yield* Effect.acquireRelease(
      Effect.promise(() => Store.init()),
      () => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        return shutdown().pipe(Effect.ignore)
      },
    )

    // Start periodic status logging and live status updates every 5 seconds
    yield* Effect.sync(() => {
      const statusInterval = setInterval(() => {
        const status = getGatewayStatus()
        ;globalThis.__gatewayLiveStatus = {
          ...status,
          h2MaxConcurrentStreams: H2.getMaxRemoteConcurrentStreamsAcrossSessions(),
          updatedAt: Date.now(),
        }
        ;globalThis.__gatewayRoutes = Store.getAllRoutes().map((r) => ({
          provider: r.key.provider,
          protocol: r.adjustment.protocol.alpnNegotiated,
        }))
        logGatewayStatus()
      }, 5000)

      ;globalThis.__gatewayLiveStatus = { ...getGatewayStatus(), h2MaxConcurrentStreams: H2.getMaxRemoteConcurrentStreamsAcrossSessions(), updatedAt: Date.now() }
      ;globalThis.__gatewayRoutes = Store.getAllRoutes().map((r) => ({
        provider: r.key.provider,
        protocol: r.adjustment.protocol.alpnNegotiated,
      }))
      ;globalThis.__gatewayStatusInterval = statusInterval
    })

    return Service.of({
      wrap,
      probe,
      getStatus,
      getRoutes,
      shutdown,
    })
  }),
)

export const defaultLayer = layer
