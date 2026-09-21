/**
 * What an /agents row must show in its model cell, and which link of the chain answered.
 *
 * The dialog used to print ONLY the selected layer's value and fall back to a guard label, so a
 * row whose layer did not read rendered `inherits from worktree` — on every row, while the models
 * existed on disk (owner, 2026-09-21: «ГДЕ МОДЕЛИ»; measured: `.opencode/data/sessions/<id>.jsonc`
 * held a model for 11 agents while the column showed none).
 *
 * A bare value is not enough either: an override in this scope and an inherited default look
 * identical once printed, and the chain has three links. So the cell carries its ORIGIN:
 * session (this session's own layer) → worktree (model.json) → agent (the agent's own
 * declaration, `Agent.Info`) — the order the runtime resolves. A guard with no origin is the
 * only honest answer when even the agent declares nothing.
 */
import { capabilityGlyphs, compactCostLabel, isFreeModel, type ModelCapabilities, type ModelCost } from "./model-cost"

export type AgentModelOrigin = "session" | "worktree" | "agent"

export interface AgentModelCell {
  readonly model: string
  readonly origin?: AgentModelOrigin
}

export function agentModelCell(input: {
  session?: string
  worktree?: string
  declared?: string
  /** Rendered when nothing in the chain answered (the caller passes `inheritLabel(scope)`). */
  guard: string
}): AgentModelCell {
  if (input.session) return { model: input.session, origin: "session" }
  if (input.worktree) return { model: input.worktree, origin: "worktree" }
  if (input.declared) return { model: input.declared, origin: "agent" }
  return { model: input.guard }
}

/**
 * `provider/modelID` → its two halves, or undefined when the string is not a reference
 * (the guard label is prose, and must stay prose).
 *
 * Split at the FIRST slash only: model ids carry slashes of their own
 * (`huggingface/zai-org/GLM-5.3-BF16` is one provider and one model, not three parts).
 */
export function agentModelRef(ref: string): { providerID: string; modelID: string } | undefined {
  const slash = ref.indexOf("/")
  if (slash <= 0 || slash === ref.length - 1) return undefined
  return { providerID: ref.slice(0, slash), modelID: ref.slice(slash + 1) }
}

/**
 * The row's model cell, in the shape the model picker uses (owner, 2026-09-21: «сам список —
 * чтобы было так», with `DeepSeek V4.1 Flash  DeepSeek  ⇣0.15 ⇡0.6 ↻0.003 [👁 🧠 🔧] · max`
 * as the target). The raw `provider/modelID` it replaced named the model in the one form the
 * reader cannot price or recognise.
 *
 * `description` is the pretty name alone: the provider leads the footer, so the two columns
 * read left to right like the picker's row. Price and capability glyphs come from the shared
 * cost module — zeros render as nothing, never as a claim of zero price.
 */
export function agentRowModelCell(input: {
  ref: string
  provider?: { id: string; name: string }
  info?: {
    name?: string
    cost?: ModelCost
    capabilities?: ModelCapabilities
  }
  variant?: string
}): { description: string; footer: string } {
  const parsed = agentModelRef(input.ref)
  if (!parsed) return { description: input.ref, footer: "" }
  const parts: string[] = [input.provider?.name ?? parsed.providerID]
  const price = isFreeModel(input.info?.cost, parsed.providerID) ? "Free" : compactCostLabel(input.info?.cost)
  if (price) parts.push(price)
  const caps = capabilityGlyphs(input.info?.capabilities)
  if (caps) parts.push(caps)
  const head = parts.join(" ")
  return {
    description: input.info?.name ?? parsed.modelID,
    footer: input.variant ? `${head} · ${input.variant}` : head,
  }
}

/**
 * The hint under the list — it follows the cursor, so the list can stay «where am I» and this
 * line «what is it» (owner, 2026-09-21: the per-agent explanation must live here, not in the
 * row, where it was truncated mid-word and competed with the runtime column).
 *
 * The resolution facts ride along: the rows no longer print which layer answered the model, and
 * that is the difference between an override this scope owns and one it inherited.
 */
export function agentHintText(input: {
  description?: string
  origin?: AgentModelOrigin
  /** Undefined when the agent has no subagent overrides at all; 0 reads «none». */
  taskCount?: number
}): string | undefined {
  const parts: string[] = []
  if (input.description) parts.push(input.description)
  if (input.origin) parts.push(`model from the ${input.origin} layer`)
  if (input.taskCount !== undefined) parts.push(input.taskCount === 0 ? "task: none" : `task: ${input.taskCount}`)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

