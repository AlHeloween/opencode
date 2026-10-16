/**
 * Pure model-cell computation for the web session header (t59 W3).
 *
 * The TUI names the agent, the resolved model and the active variant per
 * scope (`dialog-agent.tsx` + `agent-model-cell.ts` + `local.forAgent`).
 * The web reads the same layers through `useLocal()`: the agent, the
 * effective model and the selected variant (session scope, handoff or draft).
 * Anything missing reads `unknown` — never blank.
 */

export function describeModelCell(input: {
  agent?: string | undefined
  providerID?: string | undefined
  modelID?: string | undefined
  variant?: string | null | undefined
}): { label: string } {
  const agent = input.agent && input.agent.length > 0 ? input.agent : "unknown"
  const model =
    input.providerID && input.providerID.length > 0 && input.modelID && input.modelID.length > 0
      ? `${input.providerID}/${input.modelID}`
      : "unknown"
  const parts = [`${agent} · ${model}`]
  if (input.variant) parts.push(input.variant)
  return { label: parts.join(" · ") }
}
