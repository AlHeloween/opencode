import type { GatewayConfig, GatewayModelConfig } from "./config-manager"

export interface ResolvedDebugConfig {
  debug: boolean
  logBodies: boolean
  perRequest: boolean
}

const DEFAULT_DEBUG_CONFIG: ResolvedDebugConfig = {
  debug: true,
  logBodies: true,
  perRequest: false,
}

export function resolveDebugConfig(
  globalConfig: GatewayConfig | undefined | null,
  modelConfig: GatewayModelConfig | undefined | null,
): ResolvedDebugConfig {
  const globalGateway = globalConfig?.gateway
  const modelGateway = modelConfig?.gateway

  return {
    debug: modelGateway?.debug ?? globalGateway?.debug ?? DEFAULT_DEBUG_CONFIG.debug,
    logBodies: modelGateway?.logging?.logBodies ?? globalGateway?.logging?.logBodies ?? DEFAULT_DEBUG_CONFIG.logBodies,
    perRequest:
      modelGateway?.logging?.perRequest ?? globalGateway?.logging?.perRequest ?? DEFAULT_DEBUG_CONFIG.perRequest,
  }
}
