/**
 * Token Calibration — self-correcting token estimates from provider ground truth.
 *
 * When a provider returns a context overflow error, the error message often
 * contains the actual token count or context limit. We parse these numbers
 * and compute a correction factor to improve future token estimates.
 *
 * Correction is smoothed: 70% old factor + 30% new observation, so a single
 * outlier doesn't skew estimates.
 */
import type { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "token-calibration" })

interface CalibrationEntry {
  /** Multiplicative correction: provider_count / our_estimate */
  factor: number
  /** Observed context limit from provider error (may differ from config) */
  observedLimit?: number
  /** When this calibration was last updated */
  updatedAt: number
}

const corrections = new Map<string, CalibrationEntry>()

function modelKey(model: Provider.Model): string {
  return `${model.providerID}:${model.id}`
}

/** Update calibration from a provider overflow error. */
export function update(
  model: Provider.Model,
  info: { contextLimit?: number; inputTokens?: number },
  ourEstimate?: number,
): void {
  const k = modelKey(model)
  const existing = corrections.get(k) ?? { factor: 1, updatedAt: 0 }

  if (info.contextLimit) {
    existing.observedLimit = info.contextLimit
    log.info("observed context limit from provider", {
      model: model.id,
      providerLimit: info.contextLimit,
      configLimit: model.limit.context,
    })
  }

  if (info.inputTokens && ourEstimate && ourEstimate > 0) {
    const newFactor = info.inputTokens / ourEstimate
    // Smooth: blend old factor (70%) with new observation (30%)
    // First observation uses the value directly
    existing.factor = existing.factor === 1
      ? newFactor
      : existing.factor * 0.7 + newFactor * 0.3
    log.info("token calibration updated", {
      model: model.id,
      factor: existing.factor.toFixed(3),
      providerCount: info.inputTokens,
      ourEstimate,
    })
  }

  existing.updatedAt = Date.now()
  corrections.set(k, existing)
}

/** Get the correction factor for a model (default 1.0). */
export function getFactor(model: Provider.Model): number {
  return corrections.get(modelKey(model))?.factor ?? 1
}

/** Get the observed context limit from a previous provider error. */
export function getObservedLimit(model: Provider.Model): number | undefined {
  return corrections.get(modelKey(model))?.observedLimit
}

export * as TokenCalibration from "./token-calibration"
