import type { GatewayConfig, GatewayModelConfig } from "./config-manager"

export interface ResolvedDebugConfig {
  debug: boolean
  logBodies: boolean
  maxBodySize: number
}

const DEFAULT_DEBUG_CONFIG: ResolvedDebugConfig = {
  debug: true,
  logBodies: true,
  maxBodySize: 10240,
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
    maxBodySize:
      modelGateway?.logging?.maxBodySize ?? globalGateway?.logging?.maxBodySize ?? DEFAULT_DEBUG_CONFIG.maxBodySize,
  }
}
