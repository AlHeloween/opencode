import { isWithheld, payloadDigest, type TdaHeld, type TdaKind } from "@/provider/gateway/tda"

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
 * A turn is a USER PROMPT. The runtime counts it from the session's own event log
 * (`session_entry.type = 'user'`, indexed by `(session_id, type)`), so the number is DERIVED rather
 * than remembered: a counter kept in memory restarts with the process and silently changes what
 * "held for N turns" means across a restart, which is the class of drift the store exists to prevent.
 */
export type Turn = number

/**
 * An item plus the turn it arrived at. `acquiredTurn` is the runtime's business and never leaves it —
 * the gateway receives only the fields it must judge with.
 */
export type AcquiredItem = TdaHeld & { acquiredTurn: Turn }

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
}): AcquiredItem {
  return {
    id: input.id,
    kind: input.kind,
    reason: input.reason,
    digest: payloadDigest(input.url),
    expiresAtTurn: input.turn + input.holdTurns,
    acquiredTurn: input.turn,
    ...(input.reader === undefined ? {} : { reader: input.reader }),
  }
}

/**
 * The release the tool performs (the de-actualize leg). A live item becomes withheld AT ONCE — not at
 * its span's end — and every other item is returned exactly as it was.
 */
export function release(items: AcquiredItem[], id: string): AcquiredItem[] {
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
export function tdaHeaderValue(items: AcquiredItem[], turn: Turn): string | undefined {
  if (items.length === 0) return undefined
  const held: TdaHeld[] = items.map((item) => ({
    id: item.id,
    kind: item.kind,
    reason: item.reason,
    digest: item.digest,
    expiresAtTurn: item.expiresAtTurn,
    ...(item.reader === undefined ? {} : { reader: item.reader }),
    ...(item.released === undefined ? {} : { released: item.released }),
  }))
  return JSON.stringify({ turn, held })
}
