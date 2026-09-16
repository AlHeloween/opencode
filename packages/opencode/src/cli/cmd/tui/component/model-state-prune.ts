/**
 * Classify stale entries in the worktree variant state (`state/model.json`).
 *
 * `variant` and `agentVariant` are append-only: `variant.set()` writes a key on
 * every choice and nothing ever removes one. Over time the file accumulates
 * entries for providers that no longer exist (the retired KAT-Coder line), for
 * one endpoint registered under several provider ids as it was renamed, and for
 * models that cannot have a variant at all — `ProviderTransform.variants()`
 * returns `{}` for qwen/kimi/minimax/deepseek-v3 families, so those keys are
 * inert by construction (2026-09-16, Alexander).
 *
 * Two tiers, deliberately not merged:
 *
 * - `inert` — the provider AND model are loaded right now and the model offers
 *   no variants. Removing these provably cannot lose a choice.
 * - `unresolved` — the key matches no loaded model. That is NOT proof of death:
 *   `sync.data.provider` carries the available providers, so an entry can be
 *   unresolved simply because its key is not configured in this session.
 *   Reported, never removed automatically.
 *
 * Keys are matched, never parsed. `agentVariant` keys are built as
 * `agentName/providerID/modelID` and both ids contain "/", so the composite key
 * cannot be split unambiguously — see the prefix walk in `matchAgentKey`.
 */
export type PruneReason = "no-variants" | "unresolved"

export interface PruneTarget {
  map: "variant" | "agentVariant"
  key: string
  value: string
  reason: PruneReason
}

export interface PruneReport {
  inert: PruneTarget[]
  unresolved: PruneTarget[]
}

interface ProviderLike {
  id: string
  models: Record<string, { variants?: Record<string, unknown> } | undefined>
}

/** modelKey -> how many variants the live model declares. */
function variantCounts(providers: readonly ProviderLike[]) {
  const counts = new Map<string, number>()
  for (const provider of providers) {
    for (const [modelID, info] of Object.entries(provider.models ?? {})) {
      counts.set(`${provider.id}/${modelID}`, Object.keys(info?.variants ?? {}).length)
    }
  }
  return counts
}

/**
 * Resolve `agentName/providerID/modelID` without splitting on "/".
 *
 * Tries each known agent name as a prefix and checks the remainder against the
 * live model keys. Returns the variant count, or undefined when no agent
 * prefix yields a known model.
 */
function matchAgentKey(key: string, agents: readonly string[], counts: Map<string, number>) {
  for (const agent of agents) {
    const prefix = `${agent}/`
    if (!key.startsWith(prefix)) continue
    const count = counts.get(key.slice(prefix.length))
    if (count !== undefined) return count
  }
  return undefined
}

export function classifyVariantState(
  state: {
    variant?: Record<string, string | undefined>
    agentVariant?: Record<string, string | undefined>
  },
  providers: readonly ProviderLike[],
  agents: readonly string[],
): PruneReport {
  const counts = variantCounts(providers)
  const report: PruneReport = { inert: [], unresolved: [] }

  const push = (map: PruneTarget["map"], key: string, value: string, count: number | undefined) => {
    if (count === undefined) {
      report.unresolved.push({ map, key, value, reason: "unresolved" })
      return
    }
    // A live model that declares variants is a real, usable choice.
    if (count > 0) return
    report.inert.push({ map, key, value, reason: "no-variants" })
  }

  for (const [key, value] of Object.entries(state.variant ?? {})) {
    if (typeof value !== "string") continue
    push("variant", key, value, counts.get(key))
  }
  for (const [key, value] of Object.entries(state.agentVariant ?? {})) {
    if (typeof value !== "string") continue
    push("agentVariant", key, value, matchAgentKey(key, agents, counts))
  }

  return report
}

/** Remove the given keys from one map, returning a new object. */
export function withoutKeys(
  entries: Record<string, string | undefined> | undefined,
  targets: readonly PruneTarget[],
  map: PruneTarget["map"],
): Record<string, string | undefined> {
  const drop = new Set(targets.filter((item) => item.map === map).map((item) => item.key))
  return Object.fromEntries(Object.entries(entries ?? {}).filter(([key]) => !drop.has(key)))
}

/** One-line summary for the confirmation dialog. */
export function pruneSummary(report: PruneReport): string {
  const parts = [`${report.inert.length} inert`]
  if (report.unresolved.length > 0) parts.push(`${report.unresolved.length} unresolved (kept)`)
  return parts.join(" · ")
}
