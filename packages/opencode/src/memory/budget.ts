/**
 * The permanent carrier's budget — a FLAG, never an actor.
 *
 * `.opencode/data/memory/reasoning.md` rides EVERY fold verbatim, so its size is a budget rather than a
 * preference. Measured 2026-09-20 with the fold's OWN counter (`countTokens`, never a ratio):
 * **72 758 tokens — 7.6 % of the 957 232 fold budget** (`experiments/2026-09-20_memory-budget/`).
 *
 * Two decisions this file exists to encode, both the owner's (2026-09-20):
 *
 *   1. **The ceiling is a DECLARED NUMBER**, named here rather than buried inside a function — so it can
 *      be read, argued with, and changed in one place.
 *   2. **Crossing it moves NOTHING.** Rotation driven by a token count would let a threshold decide what
 *      the agent forgets — a decision taken by nobody, which is the silent class this project spent a day
 *      hunting. Retirement is a deliberate act by an actor, and it leaves a one-line pointer so the move
 *      stays visible. **This module only reports**; it has no write path at all.
 *
 * The naming threshold exists because a flag has two jobs at different times: while the carrier is small
 * it is a number, and as it approaches the ceiling it becomes material for a decision — the oldest dated
 * entries, offered to the actor, never queued for a mechanism.
 */
import { countTokens } from "../session/token-count"

/** 10 % of the fold budget, declared by the owner 2026-09-20. */
export const MEMORY_TOKENS_LIMIT = 96_000

/** At this fraction the flag stops being only a number and starts naming the oldest entries. */
const NAMING_THRESHOLD = 0.8

/** How many dated entries the flag names when it fires. */
const NAMED_ENTRIES = 5

/**
 * Dates of the OLDEST dated entries, in file order (the carrier is chronological).
 *
 * Deliberately NOT filtered by "closed": the measurement showed the oldest entries include the most
 * alive criterion in the file, so any predicate here would be a judgement pretending to be mechanical.
 * The flag names them; the ACTOR decides.
 */
export function oldestEntryDates(text: string, count: number): string[] {
  return text
    .split("\n")
    .map((line) => /^## (\d{4}-\d{2}-\d{2})/.exec(line)?.[1])
    .filter((date): date is string => date !== undefined)
    .slice(0, count)
}

/**
 * The flag, for the output of a MUTATION.
 *
 * Deliberately not attached to `read`: a read of memory is a passthrough whose output IS the file (its
 * tests assert that), and a caller that echoes a read back into `write` would copy the flag into the
 * carrier. Growth happens on append and write, so that is where the actor sees the number.
 */
export function memoryFlag(text: string, limit: number = MEMORY_TOKENS_LIMIT): string {
  const tokens = countTokens(text)
  const percent = limit > 0 ? (tokens / limit) * 100 : 0
  const head =
    `Memory: ${tokens.toLocaleString("en-US")} tokens of ${limit.toLocaleString("en-US")} ` +
    `(${percent.toFixed(1)} %${percent >= 100 ? " — OVER the declared ceiling" : ""}).`
  if (tokens < limit * NAMING_THRESHOLD) return head

  const oldest = oldestEntryDates(text, NAMED_ENTRIES)
  const named = oldest.length > 0 ? ` Oldest entries: ${oldest.join(", ")}.` : ""
  return `${head}${named} Retirement is a deliberate act that leaves a one-line pointer; nothing moves by itself.`
}
