/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
export {}

declare global {
  var __gatewayFetch: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | undefined
  var __gatewayLiveStatus:
    | {
        activeStreams: number
        inflightRequests: number
        h2Sessions: number
        updatedAt: number
      }
    | undefined
  var __gatewayRoutes: Array<{ provider: string; protocol: string }> | undefined
  var __gatewayStatusInterval: ReturnType<typeof setInterval> | undefined
}
