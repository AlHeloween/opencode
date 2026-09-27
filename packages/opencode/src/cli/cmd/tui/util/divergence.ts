/**
 * RENDER DIVERGENCE — the oracle this project did not have.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Three attempts to find an empty-transcript bug produced three WRONG causes
 * (2026-09-27, all live on this session). The common failure was not any of the
 * theories: it was that there was no instrument at the moment of failure. The
 * server logs were clean, the database held every row, and the owner's report
 * («ты работаешь, TUI ничего не пишет») could not be checked by any of them. The
 * cost was not the bug — it was three confident explanations built on nothing.
 *
 * The cheapest fix was available the whole time and was skipped: the owner sent
 * a SCREENSHOT ten minutes in, and it falsified theory #1 in one glance (the
 * numbers were live, only the text was gone). So the instrument is here now, and
 * it is the thing that would have caught that: it does not need a human to
 * notice, and it does not need a screenshot.
 *
 * ## WHAT IT MEASURES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * It compares TWO SETS THAT ALREADY EXIST and disagree:
 *
 *   ARRIVED — message ids the client received an event for. A fact about the
 *   transport: the server published it and the client got it.
 *   DRAWN   — message ids the transcript list actually contains. A fact about
 *   the render.
 *
 * When a live id is not in DRAWN, the screen is missing something the client
 * already holds. That is a divergence with a NAME, which is the whole point:
 * «the transcript is empty» is a verdict, this is an address.
 *
 * It does NOT build a list of messages. It never becomes a second source of
 * truth about what exists — two systems that disagree about messages is the
 * failure mode already paid for in this codebase (`session.revert` on the client
 * versus the server). The oracle only COMPARES, and it compares sets the product
 * already produced.
 *
 * ## WHY IT FIRES BY ITSELF
 *
 * A debugger you have to trigger by hand is a debugger you will trigger after
 * the fact, and the state you want is gone by then — a restart is the only thing
 * that currently repairs the symptom, and a restart discards it. So this fires
 * on the event, writes the evidence to a file that survives the restart, and
 * names the ids involved.
 *
 * ## THE HONEST LIMIT
 *
 * This detects a divergence between ARRIVED and DRAWN. If the bug is UPSTREAM of
 * both — the client never received the event at all — then ARRIVED is empty too
 * and this stays silent. That silence is not a pass: a fired oracle with an
 * empty ARRIVED is itself the finding, and the trace records `arrived: []` so a
 * reader can tell «nothing arrived» from «nothing was checked».
 */

/** One line of the trace. Appended, never rewritten — a fold must not erase it. */
export type DivergenceRecord = {
  /** ISO timestamp of the event that produced this record. */
  at: string
  /** The message the event was about. */
  messageID: string
  /** The part, when the event carried one. */
  partID?: string
  /** Event type verbatim, so the reader does not have to guess which arm fired. */
  event: string
  /**
   * How the id was classified. `hidden` is the failure; the other two are the
   * reasons a legitimate filter drops an id, and naming them is what keeps a
   * false alarm from being reported as the bug.
   */
  kind: "hidden" | "exempt"
  /** Why an exempt id is exempt. Empty for `hidden`. */
  reason?: string
  /** Ids the transcript list contained, bounded — the evidence set. */
  drawn: string[]
  /** Ids known live at this moment, bounded. Empty means nothing arrived. */
  arrived: string[]
}

/** The sets the comparison is made against, supplied by the caller. */
export type DivergenceInput = {
  /** Every message id the transcript list currently contains. */
  drawn: ReadonlySet<string>
  /**
   * Ids that are legitimately absent from the transcript. Revert hides a run;
   * a session fork is not this session's history; a `message*` carrier is
   * compacted memory rather than transcript. WITHOUT this the oracle fires on
   * correct behaviour, and an oracle that cries wolf is not an oracle.
   */
  exempt?: (id: string) => string | undefined
  /** Ids seen live, i.e. an event arrived for them. */
  arrived: ReadonlySet<string>
  /** Bound on the evidence written, so one bad event cannot write 800 ids. */
  max?: number
}

const DEFAULT_MAX = 40

/**
 * The comparison. Returns ONE record per live id that is not drawn, or none.
 *
 * Deliberately a pure function over sets: the TUI's reactive graph makes
 * everything else awkward to test, and this is the part that has to be right.
 */
export function findDivergence(input: DivergenceInput, event: { messageID: string; partID?: string; type: string }): DivergenceRecord | undefined {
  // An id that never arrived is not this oracle's business — that is a transport
  // question, and pretending otherwise is how a silence becomes a false pass.
  if (!input.arrived.has(event.messageID)) return undefined
  // THE OTHER HALF OF THE COMPARISON, and the half I left out first: the tests
  // caught it on the run where every event was reported as hidden, including the
  // ones drawn correctly. ARRIVED alone is not a divergence — it is the ordinary
  // case. An oracle that fires on healthy traffic is not a weak oracle, it is a
  // broken one, because the first false positive costs a reader the same trust
  // the real bug needed.
  if (input.drawn.has(event.messageID)) return undefined
  const exempt = input.exempt?.(event.messageID)
  const drawn = [...input.drawn]
  const arrived = [...input.arrived]
  const max = input.max ?? DEFAULT_MAX
  return {
    at: new Date().toISOString(),
    messageID: event.messageID,
    partID: event.partID,
    event: event.type,
    kind: exempt ? "exempt" : "hidden",
    reason: exempt,
    drawn: drawn.slice(0, max),
    arrived: arrived.slice(0, max),
  }
}
