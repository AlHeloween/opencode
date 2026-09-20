import { isWithheld, payloadDigest, type TdaHeld, type TdaKind } from "@/provider/gateway/tda"
import { PartID } from "@/session/schema"

/**
 * Temporary data acquisition — the RUNTIME's half: the set, its lifecycle, and the instruction the
 * gateway receives.
 *
 * The gateway withholds but never decides (plan §0.1): it cannot see the store, the span or the
 * release, and it must not be able to improvise either. So every judgement lives here, where the turn
 * is known and the item's own record is — and the ONE predicate both sides judge by is `isWithheld`,
 * exported from the contract module rather than written twice. Two implementations would disagree
 * invisibly: the runtime would stop sending an item the gateway still expects, or send one it has
 * already forgotten how to match.
 *
 * This module is PURE. Persistence (the `acquired_item` table on the SQLite plane) and the send site
 * are the rest of T3 and add no rules — they store and transport what is decided here.
 */

/**
 * A turn is a USER PROMPT, derived from the session's own history — and `@/session/turn` now OWNS both
 * the definition and the counter, so the two cannot drift apart.
 *
 * It moved out of this module on 2026-09-19. This file belongs to the gateway leg, and the counter is
 * needed by the TTL gate, which must not stand behind a leg that is being dismantled. Re-exported here
 * so the existing callers of this module keep working.
 */
import type { Turn } from "@/session/turn"
export type { Turn }

/**
 * How an acquisition becomes an item.
 *
 * The span is the CALLER's policy (a number in config, §0.4) and this function's only job is to turn
 * it into the expiry the gateway will judge by.
 *
 * The digest is computed HERE, from the payload's url, so that no call site can invent a digest the
 * matcher would not compute: an item whose digest does not match its payload is an item that can never
 * be released — it would ride every request forever while the store believed it was handled.
 */
export function acquiredItem(input: {
  id: string
  kind: TdaKind
  reason: string
  url: string
  turn: Turn
  holdTurns: number
  reader?: string
}): TdaHeld {
  return {
    // Branded HERE, once, in the single constructor: the caller holds a plain string (it IS a part id),
    // and no call site has to remember which kind of id this is.
    id: PartID.make(input.id),
    kind: input.kind,
    reason: input.reason,
    digest: payloadDigest(input.url),
    expiresAtTurn: input.turn + input.holdTurns,
    ...(input.reader === undefined ? {} : { reader: input.reader }),
  }
}

/**
 * The release the tool performs (the de-actualize leg). A live item becomes withheld AT ONCE — not at
 * its span's end — and every other item is returned exactly as it was.
 */
export function release(items: TdaHeld[], id: string): TdaHeld[] {
  return items.map((item) => (item.id === id ? { ...item, released: true } : item))
}

/**
 * What goes out in `x-opencode-tda`: the items and the turn they are judged at.
 *
 * The turn travels WITH the set so the ONE rule stays in one place — the gateway filters with
 * `isWithheld`, exactly as this side does, instead of being handed a pre-filtered list it would have
 * to take on trust. `undefined` when there is nothing to say, and that IS the switch being off: the
 * gateway withholds only what it is handed, so an absent header cannot be confused with an empty one.
 */
export function tdaHeaderValue(items: TdaHeld[], turn: Turn): string | undefined {
  if (items.length === 0) return undefined
  // Nothing is stripped: the item IS the contract type, so a field the gateway must not see has no
  // business riding the item in the first place — one shape instead of two that must be kept in step.
  return JSON.stringify({ turn, held: items })
}

/**
 * WHICH headers the instruction may ride in — a pure decision, so the contract's boundary is testable
 * without driving a whole request through the pipeline.
 *
 * TWO gates, and both are here rather than at the call site:
 *  - `enabled` — the master switch, OFF unless declared (plan §0.4, §0.9-4). A pipeline that can hold a
 *    gigabyte must be something you turned ON, and expressing that as a DEFAULT rather than as
 *    discipline means it cannot be forgotten: a resolution can, a flag cannot.
 *  - `x-opencode-*` are sent EXCLUSIVELY to opencode-owned providers (`session/llm.ts`, three-layer
 *    contract, 2026-09-08): third-party providers react badly to foreign namespaced headers. That makes
 *    TDA INERT on deepseek-direct / novita / openrouter — a boundary, not an accident, and the honest
 *    statement of where the mechanism reaches today.
 *
 * Returning `{}` rather than throwing keeps the send site a plain spread and means an ineligible route
 * simply carries nothing.
 */
export function tdaHeaders(providerID: string, value: string | undefined, enabled: boolean): Record<string, string> {
  if (!enabled) return {}
  if (value === undefined) return {}
  if (!providerID.startsWith("opencode")) return {}
  return { "x-opencode-tda": value }
}
