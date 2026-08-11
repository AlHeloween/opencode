import type { GatewayConfig, GatewayModelConfig } from "./config-manager"

export interface ResolvedDebugConfig {
  debug: boolean
  logBodies: boolean
  logResponseBodies: boolean
  perRequest: boolean
}

/** Runtime defaults when no gateway config exists. debug=true gives full diagnostics even before config is written. */
const DEFAULT_DEBUG_CONFIG: ResolvedDebugConfig = {
  debug: true,
  logBodies: false,
  logResponseBodies: false,
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
    logResponseBodies:
      modelGateway?.logging?.logResponseBodies ??
      globalGateway?.logging?.logResponseBodies ??
      DEFAULT_DEBUG_CONFIG.logResponseBodies,
    perRequest:
      modelGateway?.logging?.perRequest ?? globalGateway?.logging?.perRequest ?? DEFAULT_DEBUG_CONFIG.perRequest,
  }
}
