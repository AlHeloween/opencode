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
 * Three tiers, deliberately not merged:
 *
 * - `inert` — the provider AND model are loaded right now and the model offers
 *   no variants. Removing these provably cannot lose a choice.
 * - `dead` — the provider id does not appear in the registry at all, so no key
 *   could ever make the entry apply. Decided against `provider_next.all`, the
 *   full catalogue, NOT against the connected subset.
 * - `unresolved` — the provider exists in the registry but is not configured
 *   here, or no registry was supplied. Reported, never removed: an entry can be
 *   unresolved simply because its key is absent from this machine.
 *
 * Keys are matched, never parsed. `agentVariant` keys are built as
 * `agentName/providerID/modelID` and both ids contain "/", so the composite key
 * cannot be split unambiguously — see the prefix walk in `matchAgentKey`.
 */
export type PruneReason = "no-variants" | "dead-provider" | "unresolved"

export interface PruneTarget {
  map: "variant" | "agentVariant"
  key: string
  value: string
  reason: PruneReason
}

export interface PruneReport {
  inert: PruneTarget[]
  dead: PruneTarget[]
  unresolved: PruneTarget[]
}

/** Everything it is safe to remove: provably inert, or provably unreachable. */
export function removable(report: PruneReport): PruneTarget[] {
  return [...report.inert, ...report.dead]
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

/**
 * Provider id of a model key. Unambiguous because a provider id never contains
 * "/" — unlike the agent/provider/model composite, which is why the agent
 * prefix must be stripped by matching first.
 */
function providerOf(modelKey: string) {
  const slash = modelKey.indexOf("/")
  return slash === -1 ? modelKey : modelKey.slice(0, slash)
}

function stripAgent(key: string, agents: readonly string[]) {
  for (const agent of agents) {
    const prefix = `${agent}/`
    if (key.startsWith(prefix)) return key.slice(prefix.length)
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
  /**
   * Every provider id the registry knows, connected or not
   * (`sync.data.provider_next.all`). Omit it and nothing is ever classified
   * dead — the caller then has no basis to distinguish "retired" from
   * "not configured here".
   */
  registryProviderIDs?: readonly string[],
): PruneReport {
  const counts = variantCounts(providers)
  const registry = registryProviderIDs ? new Set(registryProviderIDs) : undefined
  const report: PruneReport = { inert: [], dead: [], unresolved: [] }

  const push = (
    map: PruneTarget["map"],
    key: string,
    value: string,
    count: number | undefined,
    modelKey: string | undefined,
  ) => {
    if (count !== undefined) {
      // A live model that declares variants is a real, usable choice.
      if (count > 0) return
      report.inert.push({ map, key, value, reason: "no-variants" })
      return
    }
    // No key at all without a resolvable model part, and no verdict without a
    // registry to check against.
    if (registry && modelKey && !registry.has(providerOf(modelKey))) {
      report.dead.push({ map, key, value, reason: "dead-provider" })
      return
    }
    report.unresolved.push({ map, key, value, reason: "unresolved" })
  }

  for (const [key, value] of Object.entries(state.variant ?? {})) {
    if (typeof value !== "string") continue
    push("variant", key, value, counts.get(key), key)
  }
  for (const [key, value] of Object.entries(state.agentVariant ?? {})) {
    if (typeof value !== "string") continue
    push("agentVariant", key, value, matchAgentKey(key, agents, counts), stripAgent(key, agents))
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
  if (report.dead.length > 0) parts.push(`${report.dead.length} dead provider`)
  if (report.unresolved.length > 0) parts.push(`${report.unresolved.length} unconfigured (kept)`)
  return parts.join(" · ")
}
