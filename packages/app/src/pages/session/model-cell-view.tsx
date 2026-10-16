import { createMemo, type JSX } from "solid-js"
import { useLocal } from "@/context/local"
import { describeModelCell } from "./model-cell"

/**
 * Session-scoped model cell (t59 W3) — the web twin of the TUI agent/model
 * row (`dialog-agent.tsx` + `agent-model-cell.ts`).
 *
 * Same layers through `useLocal()`: the current agent, the effective model
 * and the selected variant (session scope, handoff or draft — `local.tsx`).
 * Anything missing reads `unknown` — never blank.
 */

export function ModelCell(): JSX.Element {
  const local = useLocal()
  const label = createMemo(() => {
    const agent = local.agent.current()?.name
    const model = local.model.current() as
      | { provider?: { id?: string }; id?: string; providerID?: string; modelID?: string }
      | undefined
    const providerID = model?.provider?.id ?? model?.providerID
    const modelID = model?.id ?? model?.modelID
    const variant = local.model.variant.current() ?? undefined
    return describeModelCell({ agent, providerID, modelID, variant }).label
  })
  return (
    <span data-component="model-cell" class="text-12-regular text-text-base whitespace-nowrap" title={label()}>
      {label()}
    </span>
  )
}
