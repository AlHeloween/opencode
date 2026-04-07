import { Effect, Layer, ServiceMap } from "effect"
import { wrapFetch, probeRoute, getGatewayStatus } from "./adaptive-client"
import * as Store from "./store"
import * as H2 from "./h2-transport"
import { Log } from "@/util/log"
import type { RouteKey } from "./route-key"

const log = Log.create({ prefix: "gateway/service" })
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface Interface {
  readonly wrap: (fetch: Fetcher) => Fetcher
  readonly probe: (baseUrl: string) => Effect.Effect<ProbeResult, Error>
  readonly getStatus: () => Effect.Effect<GatewayStatus>
  readonly getRoutes: () => Effect.Effect<RouteInfo[]>
  readonly shutdown: () => Effect.Effect<void, Error>
}

export interface ProbeResult {
  alpnNegotiated: string
  alpnAdvertised: string[]
  tlsVersion: string
  success: boolean
  error?: string
  latencyMs: number
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
  maxInflight: number
  maxStreams: number
}

export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Gateway") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      log.info("gateway service starting")
    })

    const wrap = (fetch: Fetcher) => wrapFetch(fetch as typeof globalThis.fetch) as Fetcher

    const probe = (baseUrl: string) =>
      Effect.tryPromise({
        try: () => probeRoute(baseUrl),
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
          maxInflight: r.adjustment.policy.maxInflight,
          maxStreams: r.adjustment.policy.maxStreams,
        }))
      })

    const shutdown = () =>
      Effect.tryPromise(() => Store.shutdown()).pipe(
        Effect.andThen(Effect.sync(() => {
          H2.closeAll()
        })),
      )

    yield* Effect.acquireRelease(
      Effect.sync(() => Store.init()),
      () => shutdown().pipe(Effect.ignore),
    )

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
