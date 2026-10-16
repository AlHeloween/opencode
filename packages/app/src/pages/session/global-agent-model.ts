/**
 * Pure global agent-model merge for the web model dialog (t59 W4).
 *
 * Mirrors the TUI writer `writeGlobalAgentField`
 * (`tui/context/local.tsx:626-658`): read the global config, spread `.data`,
 * merge `agent.<name>.model` in `provider/model` spelling (`variant: null`
 * deletes the key), write the whole object back through
 * `global.config.update`. Same shape, same route — a layer written through
 * any other shape gets overwritten or rejected.
 */

type AgentEntry = Record<string, unknown>

export function withGlobalAgentModel(
  config: Record<string, unknown>,
  agentName: string,
  model: { providerID: string; modelID: string },
  variant: string | null | undefined,
): Record<string, unknown> {
  const agents = { ...((config["agent"] as Record<string, AgentEntry> | undefined) ?? {}) }
  const entry = { ...(agents[agentName] ?? {}) }
  entry["model"] = `${model.providerID}/${model.modelID}`
  if (variant === null) delete entry["variant"]
  else if (variant !== undefined) entry["variant"] = variant
  agents[agentName] = entry
  return { ...config, agent: agents }
}
