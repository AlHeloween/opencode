/**
 * Price rendering for the model list.
 *
 * The capability footer showed reasoning/tools/vision/context but never the
 * price, so choosing a model meant leaving the picker to look it up
 * (2026-09-16, Alexander: "цена в списке моделей не отображается, это архи
 * неудобно").
 *
 * One trap governs the whole design: `Provider.cost()` normalises a missing
 * price to `{input: 0, output: 0}`, so zero means EITHER free OR unpublished —
 * the two are indistinguishable downstream. Our own bundled StreamLake
 * catalogue is the unpublished case: `vanchin()` sets no cost at all. So zeros
 * render as nothing rather than as "free"; absence of data must not be
 * displayed as a claim of zero. A genuinely free model is labelled by its
 * caller, which knows (Zen's free tier).
 */
export interface ModelCost {
  input?: number
  output?: number
}

/**
 * Compact USD amount. Prices span ~0.003 to ~75 per million tokens, so a fixed
 * precision either loses the cheap end or pads the expensive end with zeros.
 */
export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0"
  const text = value < 0.01 ? value.toFixed(4) : value < 1 ? value.toFixed(3) : value.toFixed(2)
  // Trim only trailing zeros introduced by toFixed, never a significant digit.
  return text.replace(/\.?0+$/, "")
}

/**
 * `$0.15→$0.6/1M` — input to output per million tokens. Undefined when the
 * registry carries no price, which is not the same as free.
 */
export function costLabel(cost: ModelCost | undefined): string | undefined {
  const input = cost?.input ?? 0
  const output = cost?.output ?? 0
  if (input <= 0 && output <= 0) return undefined
  return `$${formatCost(input)}→$${formatCost(output)}/1M`
}

/**
 * Whether a row should be sorted and labelled as free.
 *
 * The previous predicate compared the RENDERED footer to the literal "Free",
 * but the footer is a join — `"Free · reasoning · tools · 200k ctx"` never
 * equals "Free", so free models were never actually sorted first. Decide on
 * the data instead.
 */
export function isFreeModel(cost: ModelCost | undefined, providerID: string): boolean {
  // Zen publishes real zeros for its free tier; elsewhere a zero is almost
  // always an unpublished price, so the claim stays scoped to the provider
  // that means it.
  return providerID === "opencode" && (cost?.input ?? 0) === 0 && (cost?.output ?? 0) === 0
}
