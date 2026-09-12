import { isDeepSeekThinkingId } from "@/provider/transform"

/**
 * Which variant-label family a model's dialog belongs to, and the label/description
 * map for its entries.
 *
 * WHY a shared gate instead of `modelID.includes("deepseek-v4")` inline: the TUI
 * used to re-derive the DeepSeek family from the *catalog* id (`deepseek-v4`),
 * while the engine derives it from `api.id` via `isDeepSeekThinkingId`. Two
 * spellings meant `deepseek-flash` (DeepSeek-V4.1-Flash, 2026-09-10) fell off both
 * — the dialog said "Select variant" with no human descriptions while the engine
 * emitted `off/low/high/max` for it. The gate now delegates to the one predicate,
 * on the same field the engine reads, so the family cannot drift again.
 *
 * Must never throw: it runs inside a `createMemo` during render, and an unhandled
 * throw there takes the whole TUI down. A malformed model therefore degrades to
 * "no labels" (which is what the dialog rendered before this gate existed), not a
 * crash.
 */
export function variantFamily(model: { api?: { id?: unknown } } | undefined) {
  if (!model || typeof model.api?.id !== "string") return undefined
  if (isDeepSeekThinkingId(model.api.id)) return "deepseek" as const
  if (model.api.id.toLowerCase().includes("glm")) return "glm" as const
  return undefined
}

/** GLM (docs.z.ai): 5.3/5.3-flash are FORCED-thinking — "off" exists only for
 *  5.2 and 4.x; 5.3/5.2 use reasoning_effort, 4.x uses the thinking toggle. */
export const glmThinkingVariant = {
  default: {
    title: "Default (Thinking)",
    description: "Thinking enabled · GLM chooses the reasoning budget",
  },
  low: {
    title: "Low",
    description: "Thinking enabled · low reasoning effort",
  },
  high: {
    title: "High",
    description: "Thinking enabled · high reasoning effort",
  },
  max: {
    title: "Max",
    description: "Thinking enabled · maximum reasoning effort",
  },
  off: {
    title: "Off",
    description: "Thinking disabled (GLM-5.2 / 4.x — GLM-5.3 is forced-thinking)",
  },
  on: {
    title: "On",
    description: "Thinking enabled (GLM-4.x toggle)",
  },
}

/**
 * Labels for a model's variants, plus the dialog title.
 *
 * The DeepSeek entry set is `off/low/high/max` because that is what the engine
 * emits for the family (`deepSeekEfforts` reads the registry's per-model
 * `reasoning_options`; `deepseek-v4-pro` declares only `high|max`). A variant key
 * the engine did not emit simply never appears in the list, so an accurate label
 * map is safe to hold for the whole family.
 */
export const deepseekThinkingVariant = {
  default: {
    title: "Default (Thinking)",
    description: "Thinking enabled · DeepSeek chooses the reasoning budget",
  },
  off: {
    title: "Off",
    description: "Thinking disabled",
  },
  low: {
    title: "Low",
    description: "Thinking enabled · low reasoning budget",
  },
  high: {
    title: "High",
    description: "Thinking enabled · high reasoning budget",
  },
  max: {
    title: "Max",
    description: "Thinking enabled · maximum reasoning budget",
  },
}

export type VariantFamily = ReturnType<typeof variantFamily>
export type VariantDetail = { title: string; description: string }

export function variantLabels(family: VariantFamily): Record<string, VariantDetail> | undefined {
  if (family === "deepseek") return deepseekThinkingVariant
  if (family === "glm") return glmThinkingVariant
  return undefined
}

/** Label for one variant key, or `undefined` when the family has no description
 *  for it — the caller then falls back to the raw variant name. */
export function variantDetail(family: VariantFamily, variant: string): VariantDetail | undefined {
  return variantLabels(family)?.[variant]
}

/** The dialog title: DeepSeek/GLM got a real thinking-mode surface, everything
 *  else keeps the generic heading. */
export function variantDialogTitle(family: VariantFamily) {
  return family === "deepseek" ? "Select thinking mode" : "Select variant"
}
