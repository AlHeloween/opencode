/**
 * The recommended GLOBAL seed model (owner spec, 2026-09-26): «не просто free, а модель
 * со зрением и максимально большим окном контента», while «Big-Pickle это fail protection
 * и не рекомендуется». Chooser only — the caller (TUI) writes the pick into the global
 * config layer; nothing here touches disk or config.
 */

export type SeedModelInfo = {
  cost?: { input?: number; output?: number }
  limit?: { context?: number }
  capabilities?: { input?: { image?: boolean }; toolcall?: boolean }
}

export type SeedProvider = { id: string; models: Record<string, SeedModelInfo> }

/** opencode zen — the provider the spec names. */
export const SEED_PROVIDER_ID = "opencode"

/** Fail protection only: never the recommended pick while anything else qualifies. */
export const FAIL_PROTECTION_MODEL_ID = "big-pickle"

const isFree = (m: SeedModelInfo) => m.cost !== undefined && (m.cost.input ?? 0) === 0 && (m.cost.output ?? 0) === 0
const hasVision = (m: SeedModelInfo) => m.capabilities?.input?.image === true
const canCallTools = (m: SeedModelInfo) => m.capabilities?.toolcall !== false

/**
 * Rank zen's free vision models by context (largest first; ties by id), then take the best
 * non-big-pickle entry. big-pickle is returned ONLY when it is the last qualifying model —
 * its «fail protection» role — and callers can name that case via `FAIL_PROTECTION_MODEL_ID`.
 */
export function pickFreeVisionModel(providers: SeedProvider[]): { providerID: string; modelID: string } | undefined {
  const zen = providers.find((provider) => provider.id === SEED_PROVIDER_ID)
  if (!zen) return undefined
  const ranked = Object.entries(zen.models)
    .filter(([, model]) => isFree(model) && hasVision(model) && canCallTools(model))
    .sort((a, b) => (b[1].limit?.context ?? 0) - (a[1].limit?.context ?? 0) || a[0].localeCompare(b[0]))
  const chosen = ranked.find(([id]) => id !== FAIL_PROTECTION_MODEL_ID) ?? ranked[0]
  return chosen ? { providerID: zen.id, modelID: chosen[0] } : undefined
}
