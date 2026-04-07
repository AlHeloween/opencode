import type { RouteKey } from "./route-key"
import { toRouteKeyString } from "./route-key"
import * as Classifier from "./classifier"
import * as Limiter from "./limiter"
import * as StreamBudget from "./stream-budget"
import * as Store from "./store"
import { healthScore } from "./health-window"
import { Log } from "@/util/log"

const log = Log.create({ prefix: "gateway/adaptive" })

const limiterState = Limiter.makeState()
const streamState = StreamBudget.makeState()

interface AdaptiveFetchOptions extends RequestInit {
  gatewayRouteKey?: RouteKey
  gatewayStream?: boolean
  gatewayTimeoutMs?: number
}

export function wrapFetch(baseFetch: typeof globalThis.fetch) {
  const wrapped = async (input: string | URL | Request, init?: AdaptiveFetchOptions): Promise<Response> => {
    await Store.init()

    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const timeoutMs = init?.gatewayTimeoutMs || 120000
    const isStream = init?.gatewayStream || false

    const urlObj = new URL(url)
    const provider = (init?.headers as Record<string, string>)?.["x-opencode-provider"] || "unknown"
    const model = (init?.headers as Record<string, string>)?.["x-opencode-model"] || "unknown"
    const endpointKind = (init?.headers as Record<string, string>)?.["x-opencode-endpoint-kind"] || "chat"

    const classifyInput: Classifier.ClassifyInput = {
      hasTools: (init?.headers as Record<string, string>)?.["x-opencode-has-tools"] === "true",
      streaming: isStream,
      maxTokens: (init?.headers as Record<string, string>)?.["x-opencode-max-tokens"]
        ? parseInt((init?.headers as Record<string, string>)["x-opencode-max-tokens"])
        : undefined,
      contextTokens: (init?.headers as Record<string, string>)?.["x-opencode-context-tokens"]
        ? parseInt((init?.headers as Record<string, string>)["x-opencode-context-tokens"])
        : undefined,
      hasAttachments: (init?.headers as Record<string, string>)?.["x-opencode-has-attachments"] === "true",
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

    try {
      const launchSlot = await Limiter.acquireWithBackoff(limiterState, policy, "launch", timeoutMs)
      if (!launchSlot.acquired) {
        throw new Error(`Gateway launch timeout after ${timeoutMs}ms for ${keyStr}`)
      }

      let streamSlot: StreamBudget.StreamAcquireResult | null = null
      if (isStream) {
        streamSlot = await StreamBudget.acquireWithBackoff(streamState, policy, keyStr, timeoutMs)
        if (!streamSlot.acquired) {
          Limiter.release(limiterState, launchSlot.slotId)
          throw new Error(`Gateway stream budget exhausted for ${keyStr}`)
        }
      }

      try {
        const response = await baseFetch(input, init)

        const success = response.status >= 200 && response.status < 300
        if (success) {
          Store.recordSuccess(routeKey, 0, 0)
        }

        return response
      } finally {
        if (streamSlot) {
          StreamBudget.release(streamState, streamSlot.slotId)
        }
        Limiter.release(limiterState, launchSlot.slotId)
      }
    } catch (err) {
      Store.recordError(routeKey, "unknown", 0)
      throw err
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
