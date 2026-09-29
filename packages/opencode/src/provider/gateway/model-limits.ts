/**
 * Per-model concurrency ceilings (owner-provided 2026-09-29): how many
 * simultaneous streams the PROVIDER allows for a model. These are provider
 * facts, not our policy — they exist so we neither throttle below what the
 * provider allows nor dial beyond it.
 *
 *   deepseek-flash    2500 concurrent streams
 *   deepseek-v4-pro    500
 *
 * Consumers:
 *  - `h2-transport` grows its per-origin session pool to
 *    `ceil(ceiling / advertised maxConcurrentStreams)` sessions.
 *  - the gateway policy floor (adjustment-store) stops clamping below these.
 */
const MODEL_CONCURRENCY: Record<string, number> = {
  "deepseek/deepseek-flash": 2500,
  "deepseek/deepseek-v4-pro": 500,
}

export function modelConcurrencyLimit(providerID: string, modelID: string): number | undefined {
  return MODEL_CONCURRENCY[`${providerID}/${modelID.split(":")[0]}`]
}

/** Pull `provider=…` / `model=…` out of a gateway route key. */
export function routeKeyParts(key: string): { provider?: string; model?: string } {
  const provider = key.match(/provider=([^|]+)/)?.[1]
  const model = key.match(/model=([^|]+)/)?.[1]
  return { provider, model }
}
