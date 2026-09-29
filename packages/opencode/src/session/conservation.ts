import * as Log from "@opencode-ai/core/util/log"

/**
 * Nothing disappears silently.
 *
 * Every path that drops, trims, replaces or filters content — ours, the SDK's, a provider's — reports
 * it here, so the log carries a TOTAL instead of an inference. Owner directive 2026-09-29: «нам надо
 * поставить защиту от любого резания, как минимум в логах, и пофигу это провайдер, SDK или нет. Все
 * могут ошибаться.»
 *
 * The rule this exists to enforce: a cut that is not reported is the defect; a reported cut is a
 * decision with a name. The counters are the instrument — the same shape as the reasoning and
 * zero-payload censuses — so a reader can total the loss per turn instead of inferring it from
 * something that is no longer there.
 */
export interface CutEvent {
  /** Where the cut happened, as `module.symbol` (grep-able, one vocabulary). */
  site: string
  /** What disappeared: "system-reminder blocks", "tool output", "reasoning parts", … */
  kind: string
  /** How many items were dropped (parts, blocks, messages). Must be > 0 to be reported. */
  dropped: number
  /** Why the cut is allowed to exist: "flood gate", "vendor rejects empty content", … */
  reason: string
  /** Characters removed, when the site knows them (trim/strip/truncate). */
  bytes?: number
  sessionID?: string
  messageID?: string
  /** Anything the site wants a reader to have — sizes, ids, thresholds. */
  detail?: Record<string, unknown>
}

/** Count parts across messages, for before/after accounting around a filtering step. */
export function partCount(messages: readonly { content: unknown }[]): number {
  return messages.reduce((n, msg) => n + (Array.isArray(msg.content) ? msg.content.length : 1), 0)
}

/**
 * Report one cut. Silent when nothing was dropped — an unfired report must stay honest, so the
 * zero case writes nothing instead of teaching a reader to skim `cut` lines.
 */
export function reportCut(event: CutEvent): void {
  if (event.dropped <= 0) return
  Log.Default.warn("cut", { ...event })
}
