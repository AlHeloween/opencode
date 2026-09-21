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

export type AgentModelOrigin = "session" | "worktree" | "global" | "agent"

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
 * The row cell for a SCOPED settings dialog: the layer the dialog edits, or the guard.
 *
 * A scoped form must show the layer its title names. The row used to print the EFFECTIVE chain
 * (session → worktree → declared) whatever the scope, so `scope: global (save)` could display a
 * value no global layer holds — measured 2026-09-21 on the live dialog: `build_mode` read
 * «Muse Spark 1.3 Free», a session-only value, while `bin/opencode.jsonc:32-35` declared
 * `huggingface/zai-org/GLM-5.3-Flash-BF16`. Owner: «давай починять».
 *
 * `origin` is the SCOPE, not a chain link: the reader is being told which layer this form is
 * showing, which is the question the title already asks. What the runtime WILL use is a different
 * question, and it belongs to the prompt's status line — not to a settings form.
 */
export function scopedModelCell(scope: "global" | "worktree" | "session", own: string | undefined, guard: string): AgentModelCell {
  if (own) return { model: own, origin: scope }
  return { model: guard }
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
 * `description` is the pretty name alone and the PROVIDER is not in the footer: the form was
 * narrowed to `large` (88 cells) and `agent | model | runtime` needs the columns — a provider
 * chip in the footer pushed the name past the budget. The provider rides the hint instead.
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
  const parts: string[] = []
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
/**
 * The next variant in a model's own list, wrapping through the model default.
 *
 * ctrl+t on a row steps the variant in place — recents included (owner, 2026-09-21: «когда я
 * подвожу к надписи и кликаю ctrl-t то вариант модели должен циклироваться для этой записи.
 * Включая recents»). The step is a pure function of the list and what is selected now, so the wrap
 * is pinned by a test instead of argued over a keystroke: no selection → the first variant, a
 * selection → the next one, the last one → back to the model default (undefined). An empty list has
 * nowhere to step, and returning its first entry would claim a variant the model never declared.
 */
export function nextVariant(variants: readonly string[], current: string | undefined): string | undefined {
  if (variants.length === 0) return undefined
  const index = current ? variants.indexOf(current) : -1
  if (current && index === -1) return variants[0]
  const next = index + 1
  return next >= variants.length ? undefined : variants[next]
}

export function agentHintText(input: {
  description?: string
  /** The provider the model is served by — the row has no room for it at `large` width. */
  provider?: string
  origin?: AgentModelOrigin
  /** Undefined when the agent has no subagent overrides at all; 0 reads «none». */
  taskCount?: number
}): string | undefined {
  const parts: string[] = []
  if (input.description) parts.push(input.description)
  if (input.provider) parts.push(input.provider)
  if (input.origin) parts.push(`model from the ${input.origin} layer`)
  if (input.taskCount !== undefined) parts.push(input.taskCount === 0 ? "task: none" : `task: ${input.taskCount}`)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

