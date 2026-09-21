/**
 * Fill every settings layer — no runtime parent-search.
 *
 * Owner ruling (2026-09-19, restated with teeth 2026-09-20): «каждый конфиг если его нету
 * должен быть заполнен … всё заполнено, чёткий дубль», and «missing model at any config
 * settings from global till worktree and session — ANY — all tests failed». So:
 *
 *   global  ← the agent's declaration, else the build agent's, else REPORTED (never invented)
 *   worktree ← global          (at the moment the worktree state comes into existence)
 *   session  ← worktree        (at the moment the session comes into existence)
 *
 * and from then on a read is a PLAIN LOOKUP of one layer. «We must use only config from
 * session» — a parent is walked at FILL time, which is the only time a chain is allowed;
 * every reader afterwards takes the session's value and nothing else.
 *
 * These functions are the pure half: they decide WHAT to write and REPORT what could not be
 * resolved instead of leaving a silent hole. An unfilled layer is a bug to fix by filling,
 * not a state to display — which is why `unresolved` exists and why the tests fail on it.
 */
import { workspaceModelScope, type ModelRef, type SessionSettings } from "./session-settings"

/** The form every layer file stores: `providerID/modelID`. */
export function modelKey(model: ModelRef): string {
  return `${model.providerID}/${model.modelID}`
}

/** Parse the stored `providerID/modelID` form. Returns undefined for a malformed value. */
export function parseModelKey(value: string | undefined): ModelRef | undefined {
  if (!value) return undefined
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) }
}

/** Agents whose model this session does not hold. */
export function unfilledSessionAgents(settings: SessionSettings | null | undefined, agents: string[]): string[] {
  return agents.filter((name) => !settings?.agent?.[name]?.model)
}

/** Agents the worktree map does not hold for this workspace. */
export function unfilledWorkspaceAgents(
  workspaceAgent: Record<string, Record<string, ModelRef>>,
  workspaceID: string | undefined,
  agents: string[],
): string[] {
  const scope = workspaceModelScope(workspaceID)
  return agents.filter((name) => {
    const entry = workspaceAgent[scope]?.[name]
    return !entry?.providerID || !entry?.modelID
  })
}

/**
 * Write one agent's model into a session's settings.
 *
 * Deliberately NOT `setSessionAgentModel`: that one is the USER's explicit choice and pins
 * `agentVariant[agent/model] = "default"` to stop a stale selection from winning. A fill is
 * a COPY of the layer above, so pinning the sentinel would suppress the variant it just
 * copied — the fill would quieten the very setting it materialised. The variant is written
 * only when the source actually has one.
 */
export function withSessionAgentModel(
  settings: SessionSettings | null | undefined,
  agentName: string,
  model: string,
  variant?: string,
): SessionSettings {
  const agents = { ...(settings?.agent ?? {}) }
  const entry = { ...(agents[agentName] ?? {}), model }
  if (variant) entry.variant = variant
  agents[agentName] = entry
  return { ...settings, agent: agents }
}

/**
 * Fill a session from a per-agent source — the layer above it.
 *
 * `source` is a function rather than a map so the caller resolves each name through whatever
 * it has (worktree state, then the global agent config, then the build model) without this
 * module knowing about models or stores.
 */
export function fillSessionAgents(
  settings: SessionSettings | null | undefined,
  agents: string[],
  source: (name: string) => { model: string; variant?: string } | undefined,
): { settings: SessionSettings; filled: string[]; unresolved: string[] } {
  let next: SessionSettings = settings ?? {}
  const filled: string[] = []
  const unresolved: string[] = []
  for (const name of unfilledSessionAgents(settings, agents)) {
    const value = source(name)
    if (!value?.model) {
      unresolved.push(name)
      continue
    }
    next = withSessionAgentModel(next, name, value.model, value.variant)
    filled.push(name)
  }
  return { settings: next, filled, unresolved }
}

/** Fill the worktree map for one workspace; same contract and same refusal to guess. */
export function fillWorkspaceAgents(
  workspaceAgent: Record<string, Record<string, ModelRef>>,
  workspaceID: string | undefined,
  agents: string[],
  source: (name: string) => ModelRef | undefined,
): {
  workspaceAgent: Record<string, Record<string, ModelRef>>
  filled: string[]
  unresolved: string[]
} {
  const scope = workspaceModelScope(workspaceID)
  const next: Record<string, Record<string, ModelRef>> = { ...workspaceAgent }
  const bucket: Record<string, ModelRef> = { ...(workspaceAgent[scope] ?? {}) }
  const filled: string[] = []
  const unresolved: string[] = []
  for (const name of unfilledWorkspaceAgents(workspaceAgent, workspaceID, agents)) {
    const value = source(name)
    if (!value) {
      unresolved.push(name)
      continue
    }
    bucket[name] = value
    filled.push(name)
  }
  next[scope] = bucket
  return { workspaceAgent: next, filled, unresolved }
}
