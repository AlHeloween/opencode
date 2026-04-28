export interface RequestTrace {
  gatewayRequestId: string
  model: string
  provider: string
  startMs: number
  isStream: boolean
}

const activeRequests = new Map<string, RequestTrace>()

export function startTrace(
  correlationId: string,
  gatewayRequestId: string,
  model: string,
  provider: string,
  isStream: boolean,
): void {
  activeRequests.set(correlationId, {
    gatewayRequestId,
    model,
    provider,
    startMs: Date.now(),
    isStream,
  })
}

export function endTrace(correlationId: string): void {
  activeRequests.delete(correlationId)
}

export function getTrace(correlationId: string): RequestTrace | undefined {
  return activeRequests.get(correlationId)
}

export function getGatewayRequestId(correlationId: string): string | undefined {
  return activeRequests.get(correlationId)?.gatewayRequestId
}
