/**
 * Bottom-up mount of a session — T11b step 4 of plans/to_be_confirmed/2026-09-22_reasoning-stream-render-stability.md.
 *
 * Entering a session built every loaded message at once: 154 ms of main thread for 40 × 12 000-char messages,
 * ~85 % of it marked's block lex (measured, `experiments/2026-09-23_render-load/remount.ts`). The owner chose
 * to build bottom-up: the newest messages at once — the view is pinned to the bottom, so they are what the
 * screen shows — and the history above in slices, newest first. Pure policy: which messages start deferred,
 * and which to release next; the route owns the clock and the scroll.
 */

export type MountItem = { id: string; chars: number }

/**
 * Walking from the newest message back, keep messages eager until `eagerChars` of text is covered and at
 * least `minEager` messages are eager; defer every older one. Returns the deferred ids NEWEST FIRST — the
 * order they are released in.
 */
export function deferredOnEntry(items: MountItem[], eagerChars: number, minEager: number): string[] {
  const deferred: string[] = []
  let covered = 0
  let eager = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (eager < minEager || covered < eagerChars) {
      eager++
      covered += item.chars
      continue
    }
    deferred.push(item.id)
  }
  return deferred
}

/**
 * The next slice of `pending` (newest first) to release: ids until `sliceChars` of text is reached, and always
 * at least one, so a single huge message cannot stall the walk.
 */
export function nextSlice(pending: string[], charsOf: (id: string) => number, sliceChars: number) {
  let taken = 0
  let chars = 0
  while (taken < pending.length && (taken === 0 || chars < sliceChars)) {
    chars += charsOf(pending[taken]!)
    taken++
  }
  return { release: pending.slice(0, taken), rest: pending.slice(taken) }
}
