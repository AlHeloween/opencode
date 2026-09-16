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
 * Module-level rather than a service to keep `tool/compact.ts` from importing
 * `session/prompt.ts`, which imports the tool registry.
 */
const pending = new Set<string>()

/** Arm a boundary fold for this session. Idempotent within a turn. */
export function request(sessionID: string): void {
  pending.add(sessionID)
}

/** Consume the request. Returns true at most once per arming. */
export function take(sessionID: string): boolean {
  return pending.delete(sessionID)
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
  /** Fold now, past the window-fill threshold. A summary already represents the head. */
  | "forced"
  /** No capture ran this stop — summarize first, then fold, or the fold goes tail-only. */
  | "capture-then-forced"
  /** Ordinary window-fill gate: fold only if the visible window reached `usable(model)`. */
  | "cadence"
  /** A new summary was just captured and nothing asked to fold — keep M intact. */
  | "defer"

export function foldDecision(input: {
  requested: boolean
  captureDue: boolean
  sidecarCaptured: boolean
}): FoldDecision {
  // An explicit request folds on this stop even when a sidecar was just
  // captured. The deferral exists so CONTINUING work keeps M intact; asking to
  // compact says the work is not continuing.
  if (input.requested) return input.captureDue ? "forced" : "capture-then-forced"
  if (!input.captureDue) return "cadence"
  // Never fold on the same stop as a new s — Layer-2 runs on a later stop.
  return input.sidecarCaptured ? "defer" : "cadence"
}
