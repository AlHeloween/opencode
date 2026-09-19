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
 * through to the parent again". Under a filled world that operation no longer has a valid
 * outcome — it would create exactly the gap the ruling removes — so it is gone. Releasing a
 * layer is now indistinguishable from re-filling it, which is what `planCopyFromParent`
 * already does as the explicit action.
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

/**
 * RETAINED ONLY UNTIL ITS COLLATERAL LANDS (2026-09-19).
 *
 * "Release this layer so resolution falls through again" contradicts the fill ruling — a
 * filled world has no valid gap to fall through. It is still here because
 * `local.model.layer.clear` and the `ctrl+alt+k` action in `/agents` call it, and removing
 * all three in one step is a separate change. It goes with them; do not add callers.
 */
export interface ClearPlan {
  scope: ConfigScope
  /** Where resolution lands once this layer is empty. */
  fallsTo: ConfigScope
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
 * `undefined` means the entire chain is empty — no layer holds anything. The caller must
 * then supply the widest default (the build agent's model, else `opencode/big-pickle`);
 * this module deliberately does not know about models.
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
  return { ok: false, reason: "no layer in the chain holds a value — fill from the build model or opencode/big-pickle" }
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

/** See the `ClearPlan` note — retained with its callers; do not add new ones. */
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
