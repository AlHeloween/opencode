/**
 * Plan a copy-down or a release between configuration layers.
 *
 * The scope selector let you choose WHERE a save lands, but nothing let you
 * move a value between layers: there was no "session settings from worktree"
 * and no "worktree settings from global" (2026-09-16, Alexander). Two distinct
 * operations, deliberately not one:
 *
 * - copy — materialise the parent's value into this layer so it can then be
 *   edited without touching the parent.
 * - clear — remove this layer's value so resolution falls through to the
 *   parent again. The layer keeps no copy.
 *
 * Both are planned here as pure decisions so the dialog only performs IO for a
 * plan that is already known to be valid, and so the refusal reasons are
 * testable strings rather than inline toasts.
 */
import { parentScope, type ConfigScope } from "./config-scope"

export interface LayerValue {
  /** Display form `providerID/modelID`, absent when the layer holds nothing. */
  model?: string
  variant?: string
}

export type Layers = Partial<Record<ConfigScope, LayerValue>>

export interface CopyPlan {
  from: ConfigScope
  to: ConfigScope
  model: string
  variant?: string
}

export interface ClearPlan {
  scope: ConfigScope
  /** Where resolution lands once this layer is empty. */
  fallsTo: ConfigScope
}

export type Planned<T> = { ok: true; plan: T } | { ok: false; reason: string }

function isEmpty(value: LayerValue | undefined) {
  return !value?.model && !value?.variant
}

export function planCopyFromParent(scope: ConfigScope, layers: Layers): Planned<CopyPlan> {
  const parent = parentScope(scope)
  if (!parent) return { ok: false, reason: "global is the widest layer — there is nothing above it to copy from" }
  const source = layers[parent]
  if (isEmpty(source)) return { ok: false, reason: `${parent} holds no value to copy` }
  // A variant with no model would land keyed to whatever model resolves later,
  // which is not the value the user saw in the parent row.
  if (!source?.model) return { ok: false, reason: `${parent} has a variant but no model — nothing to pin` }
  return { ok: true, plan: { from: parent, to: scope, model: source.model, variant: source.variant } }
}

export function planClear(scope: ConfigScope, layers: Layers): Planned<ClearPlan> {
  const parent = parentScope(scope)
  if (!parent) {
    // patchJsonc only SETS keys; removing one needs a delete op the config
    // writer does not expose. Same documented gap as clearing a global variant.
    return { ok: false, reason: "a global key cannot be removed from the TUI — edit the global opencode.jsonc" }
  }
  if (isEmpty(layers[scope])) return { ok: false, reason: `${scope} holds nothing to clear` }
  return { ok: true, plan: { scope, fallsTo: parent } }
}
