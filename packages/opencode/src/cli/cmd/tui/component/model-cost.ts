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
  cache?: { read?: number; write?: number }
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
 * `cache $0.003` — cached-prefix read price per million.
 *
 * Separate chip rather than a fourth number in the price label, because for an
 * agent loop it is often the decisive figure: deepseek-flash reads cache at
 * $0.003 against $0.15 fresh input, a fiftyfold difference, and a long session
 * spends most of its input tokens on the cached prefix. Shown only when the
 * registry publishes a non-zero read price, so it stays absent for the
 * providers that publish nothing.
 */
export function cacheLabel(cost: ModelCost | undefined): string | undefined {
  const read = cost?.cache?.read ?? 0
  if (read <= 0) return undefined
  return `cache $${formatCost(read)}`
}

/**
 * `⇣0.09 ⇡0.3 ↻0.018` — the same glyph encoding the status line already uses,
 * at roughly half the width of the prose form.
 *
 * The picker's verbose footer (`$0.09→$0.3/1M · cache $0.018 · reasoning ·
 * tools · vision · 1.3M ctx · variants`, 78 chars) was wider than the usable
 * row at every dialog size, so it crushed the model name it was annotating.
 * The status line had already solved this — it just lived inline in the prompt
 * component where the picker could not reach it (2026-09-18, Alexander).
 *
 * Zeros still render as nothing, never as `⇣0`: an unpublished price is not a
 * price of zero, and printing it as one makes a paid model look free.
 */
export function compactCostLabel(cost: ModelCost | undefined): string | undefined {
  const parts: string[] = []
  if ((cost?.input ?? 0) > 0) parts.push(`⇣${formatCost(cost!.input!)}`)
  if ((cost?.output ?? 0) > 0) parts.push(`⇡${formatCost(cost!.output!)}`)
  const cached = (cost?.cache?.read ?? 0) + (cost?.cache?.write ?? 0)
  if (cached > 0) parts.push(`↻${formatCost(cached)}`)
  return parts.length > 0 ? parts.join(" ") : undefined
}

export interface ModelCapabilities {
  reasoning?: boolean
  toolcall?: boolean
  input?: { image?: boolean; video?: boolean }
}

/** `[🎥 👁 🧠 🔧]` — capability glyphs in the status line's order. */
export function capabilityGlyphs(capabilities: ModelCapabilities | undefined): string | undefined {
  const glyphs: string[] = []
  if (capabilities?.input?.video) glyphs.push("🎥")
  if (capabilities?.input?.image) glyphs.push("👁")
  if (capabilities?.reasoning) glyphs.push("🧠")
  if (capabilities?.toolcall) glyphs.push("🔧")
  return glyphs.length > 0 ? `[${glyphs.join(" ")}]` : undefined
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
