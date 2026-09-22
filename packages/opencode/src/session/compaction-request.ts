/**
 * Model-requested Layer-2 fold, armed here and consumed at the turn boundary.
 *
 * Compaction used to have exactly two triggers, and neither belonged to the
 * agent: the window-fill gate inside the run loop (`maybeCompactCadence`), and
 * the user's `/compact` through `POST /session/:id/summarize`. The first can
 * only see the ceiling — it has no way to know a task finished — and the kernel
 * rule @COMPACTION_CADENCE says the boundary, not the ceiling, is when folding
 * is cheap.
 *
 * A tool cannot fold synchronously: it runs *inside* the turn whose window it
 * would be folding. So the `compact` tool arms a request and returns; the run
 * loop takes it at turn end, where a fold is safe and is literally the boundary
 * the rule names.
 *
 * The request carries the BOUNDARY — one line of why — and `take` returns it
 * with the arming. Measured 2026-09-19: the reason passed to the tool reached
 * only the part's `metadata`, so the fold itself was recorded with no motive,
 * and answering "why did this window fold" took three tables. A fold whose
 * reason cannot be read is a fold nobody can audit.
 *
 * Module-level rather than a service to keep `tool/compact.ts` from importing
 * `session/prompt.ts`, which imports the tool registry.
 */
const pending = new Map<string, string | undefined>()

/**
 * Arm a boundary fold for this session, carrying the boundary that closed.
 * Idempotent within a turn — a second arming names the same boundary, so the
 * last reason simply replaces the earlier one.
 */
export function request(sessionID: string, reason?: string): void {
  pending.set(sessionID, reason)
}

/**
 * Consume the request: whether it was armed, and the reason with it.
 * `requested: false` at most once per arming — one boundary, one fold; a sticky
 * flag would refold every turn for the rest of the session.
 *
 * The reason comes back from the call that consumes the request, so the fold
 * cannot be performed without the boundary that asked for it being in hand.
 */
export function take(sessionID: string): { requested: boolean; reason?: string } {
  const requested = pending.has(sessionID)
  const reason = pending.get(sessionID)
  pending.delete(sessionID)
  return { requested, reason }
}

/** Read without consuming — for status surfaces and tests. */
export function pendingFor(sessionID: string): boolean {
  return pending.has(sessionID)
}

/**
 * What the turn boundary should do about Layer-2. Pure, so the branching that
 * decides whether a session's window folds is testable without driving a whole
 * turn through the run loop.
 */
export type FoldDecision =
  /** Fold now, past the window-fill threshold, because the `compact` tool asked. */
  | "forced"
  /** Ordinary window-fill gate: fold only if the visible window reached `usable(model)`. */
  | "cadence"

/**
 * Two states, because the other two were about a capture.
 *
 * The old table answered four ways — `forced`, `capture-then-forced`, `defer`,
 * `cadence` — and three of them branched on the sidecar: whether a capture was
 * due, whether one had just happened. Generation was removed on 2026-09-22
 * (`bff5f50f7a`), so the capture flag became the constant `false` and, measured
 * then, EVERY non-requested case returned `cadence` anyway: the capture axis
 * never changed the fold decision, it only gated the one state (`defer`) whose
 * own premise — do not fold on the same stop as a new summary — died with the
 * summary. What is left is the decision the boundary actually makes.
 */
export function foldDecision(input: { requested: boolean }): FoldDecision {
  return input.requested ? "forced" : "cadence"
}
