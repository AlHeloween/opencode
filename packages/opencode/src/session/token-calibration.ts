/**
 * Token Calibration — self-correcting token estimates from provider ground truth.
 *
 * When a provider returns a context overflow error, the error message often contains the
 * ACTUAL context limit, which can differ from the declared one. We parse it and expose it
 * via {@link getObservedLimit}; `usable()` and `hasSpareOutput` prefer it over
 * `model.limit`.
 *
 * The multiplicative correction factor that used to live here is GONE (2026-09-19). Its
 * only reader was `getFactor`, which had zero call sites, and the code that APPLIED it was
 * removed in `e86abaab42` when the BPE/tiktoken tokenizer was replaced by a constant — so
 * every turn computed a factor and nothing ever read it.
 *
 * The measurement it encoded was real: over 20 paired requests the ratio was 1.46–1.96
 * (median 1.67), the largest uncounted term being the tool catalog at 24 589 tokens per
 * request, which `estimateContentTokens` never sees. It is kept as a FACT in
 * `docs/compaction.md`, not as code: under the current budget model the absolute comes
 * from the provider's own `prompt_tokens`, so there is nothing left for a factor to
 * correct.
 */
import type { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "token-calibration" })

interface CalibrationEntry {
  /** Observed context limit from provider error (may differ from config) */
  observedLimit?: number
  /** When this calibration was last updated */
  updatedAt: number
}

const corrections = new Map<string, CalibrationEntry>()

function modelKey(model: Provider.Model): string {
  return `${model.providerID}:${model.id}`
}

/** Update the observed context limit from a provider overflow error. */
export function update(model: Provider.Model, info: { contextLimit?: number }): void {
  const k = modelKey(model)
  const existing = corrections.get(k) ?? { updatedAt: 0 }

  if (info.contextLimit) {
    existing.observedLimit = info.contextLimit
    log.info("observed context limit from provider", {
      model: model.id,
      providerLimit: info.contextLimit,
      configLimit: model.limit.context,
    })
  }

  existing.updatedAt = Date.now()
  corrections.set(k, existing)
}

/** Get the observed context limit from a previous provider error. */
export function getObservedLimit(model: Provider.Model): number | undefined {
  return corrections.get(modelKey(model))?.observedLimit
}

export * as TokenCalibration from "./token-calibration"
