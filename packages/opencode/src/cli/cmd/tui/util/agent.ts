/** Only primary/all agents may become the active prompt identity in the TUI. */
export function canActivateAgent(
  target: string | undefined,
  agents: ReadonlyArray<{ name: string; mode: string }>,
) {
  return target !== undefined && agents.some((agent) => agent.name === target && agent.mode !== "subagent")
}

/** Selecting a model for ANOTHER agent (the /agents path passes an explicit
 * target) configures that agent — it must never move the active prompt
 * identity. Only the /model dialog, which carries no explicit target, may
 * activate (2026-09-11, Alexander: "она автоматом выбирается в основном окне"). */
export function shouldActivateAgent(
  target: string | undefined,
  explicitTarget: string | undefined,
  agents: ReadonlyArray<{ name: string; mode: string }>,
) {
  if (explicitTarget !== undefined) return false
  return canActivateAgent(target, agents)
}
