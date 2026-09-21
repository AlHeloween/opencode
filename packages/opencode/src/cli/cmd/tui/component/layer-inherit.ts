/**
 * Decide the value a configuration layer must HOLD, and plan filling it.
 *
 * Owner ruling 2026-09-19: «каждый конфиг если его нету должен быть заполнен, никаких
 * etheritance быть не должно, всё заполнено, чёткий дубль. Если не заполнен — заполнить.»
 * A layer therefore never resolves through its parent at READ time: a gap is FILLED once,
 * when the layer comes into existence, and every read afterwards is a plain lookup.
 *
 * The walk below happens at FILL time, which is the only time a chain is allowed. After it,
 * the value is materialised and no reader walks anything — that is the whole point: the
 * number of surfaces stops growing, because there is one place that decides a fill source
 * and everywhere else just reads what is there.
 *
 * `clear` used to sit next to `copy` here: "remove this layer's value so resolution falls
 * through to the parent again". Under a filled world that operation has no valid outcome — it
 * would create exactly the gap the ruling removes — so it was REMOVED 2026-09-20 together with
 * its callers (`local.model.layer.clear`, the `ctrl+alt+k` action in /agents) and the two
 * session-settings helpers that existed only for it. Releasing a layer is indistinguishable from
 * re-filling it, which is what `planCopyFromParent` does as the explicit action.
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

/** Where a fill takes its value from, and what it writes. */
export interface FillPlan {
  scope: ConfigScope
  from: ConfigScope
  model: string
  variant?: string
}

export type Planned<T> = { ok: true; plan: T } | { ok: false; reason: string }

function isEmpty(value: LayerValue | undefined) {
  return !value?.model && !value?.variant
}

/**
 * A layer's value after filling: its own if it has one, else the nearest ancestor's.
 *
 * LOCAL WINS, and returns a copy of the value rather than the reference, so a filled layer
 * cannot alias its parent — the whole point is that the two are independent afterwards.
 *
 * A layer holding a variant but no model is NOT a source: the variant would land keyed to
 * whatever model resolves later, which is not the value the parent row displayed. It is
 * skipped and the walk continues (same rule `planCopyFromParent` refuses on).
 *
 * `undefined` means the entire chain is empty — no layer holds anything. The caller must then
 * REPORT it: an empty chain is a defect to fix by filling, never a value to invent. This module
 * deliberately does not know about models — and a hardcoded id supplied here would be
 * indistinguishable downstream from a real choice, so the hole could not be reported at all.
 */
export function fillValue(scope: ConfigScope, layers: Layers): LayerValue | undefined {
  let current: ConfigScope | undefined = scope
  while (current) {
    const value = layers[current]
    if (value?.model) return { model: value.model, variant: value.variant }
    current = parentScope(current)
  }
  return undefined
}

/** Plan the fill for one layer. Refuses only when the whole chain is empty. */
export function planFill(scope: ConfigScope, layers: Layers): Planned<FillPlan> {
  let current: ConfigScope | undefined = scope
  while (current) {
    const value = layers[current]
    if (value?.model) return { ok: true, plan: { scope, from: current, model: value.model, variant: value.variant } }
    current = parentScope(current)
  }
  return { ok: false, reason: "no layer in the chain holds a value — the chain is empty and that is reported, not defaulted" }
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
