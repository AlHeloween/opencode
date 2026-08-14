/** Only primary/all agents may become the active prompt identity in the TUI. */
export function canActivateAgent(
  target: string | undefined,
  agents: ReadonlyArray<{ name: string; mode: string }>,
) {
  return target !== undefined && agents.some((agent) => agent.name === target && agent.mode !== "subagent")
}
