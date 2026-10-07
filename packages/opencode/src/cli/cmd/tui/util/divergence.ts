// A client-side transcript observation, not a claim that pixels were painted.
// The Session component supplies independent sources: live event ids, store ids,
// and ids in its computed transcript list. No message/part content enters this API.

/**
 * How many live message ids are remembered per session. Enough to cover a long
 * turn and its undo — the window in which a render divergence is observed — and
 * bounded, because an unbounded arrival list on a session that runs for days is
 * a memory leak wearing a diagnostic's clothes.
 */
export const ARRIVED_MAX = 400

/**
 * Store updater for `arrived[sessionID]` on a `message.updated` event.
 *
 * A plain function of the previous value, NOT `produce`: Solid's `produce` only
 * calls its recipe when the value is wrappable, so on a session with no entry
 * yet (`undefined`) it returned without writing — and every session starts that
 * way, so the arrival channel never fired (42 live traces, 6 028 snapshots, all
 * `arrivedCount: 0`; test/tui/arrival.test.ts).
 */
export function arrivalUpdate(messageID: string) {
  return (current: string[] | undefined): string[] => {
    if (current?.includes(messageID)) return current
    return [messageID, ...(current ?? [])].slice(0, ARRIVED_MAX)
  }
}

export type TranscriptInput = {
  sessionID: string
  status: string
  arrived: readonly string[]
  held: readonly string[]
  listed: readonly string[]
  revertID?: string
  exempt?: (id: string) => string | undefined
}

/**
 * The Session route's observation, built from what it reads out of the sync
 * store. The route's effect calls exactly this, so a test that feeds a real
 * store through it exercises the caller, not only the reporter.
 */
export function sessionTranscriptInput(source: {
  sessionID: string
  data: {
    session_status: { [sessionID: string]: { type: string } | undefined }
    arrived: { [sessionID: string]: string[] | undefined }
    message: { [sessionID: string]: readonly { id: string }[] | undefined }
  }
  listed: readonly { id: string; _source?: string }[]
  revert?: { messageID?: string; partID?: string }
  revertedRun: (messageID: string) => ReadonlySet<string>
}): TranscriptInput {
  const rev = source.revert
  const reverted = rev?.messageID && !rev.partID ? source.revertedRun(rev.messageID) : undefined
  return {
    sessionID: source.sessionID,
    status: source.data.session_status[source.sessionID]?.type ?? "unknown",
    arrived: source.data.arrived[source.sessionID] ?? [],
    held: (source.data.message[source.sessionID] ?? []).map((m) => m.id),
    listed: source.listed.filter((m) => !("_source" in m) || m._source === source.sessionID).map((m) => m.id),
    revertID: rev?.messageID,
    exempt: (id) => (reverted?.has(id) ? "reverted run" : undefined),
  }
}

const MAX_IDS = 40

export function inspectTranscript(input: TranscriptInput) {
  const held = new Set(input.held)
  const listed = new Set(input.listed)
  const hidden: string[] = []
  const missingStore: string[] = []
  const exempt: string[] = []
  let hiddenCount = 0
  let missingStoreCount = 0
  let exemptCount = 0

  for (const id of input.arrived) {
    if (!held.has(id)) {
      missingStoreCount++
      if (missingStore.length < MAX_IDS) missingStore.push(id)
      continue
    }
    if (listed.has(id)) continue
    if (input.exempt?.(id)) {
      exemptCount++
      if (exempt.length < MAX_IDS) exempt.push(id)
      continue
    }
    hiddenCount++
    if (hidden.length < MAX_IDS) hidden.push(id)
  }

  return {
    kind: "snapshot" as const,
    sessionID: input.sessionID,
    status: input.status,
    revertID: input.revertID,
    arrivedCount: input.arrived.length,
    heldCount: input.held.length,
    listedCount: input.listed.length,
    hiddenCount,
    missingStoreCount,
    exemptCount,
    // The tail retains the newest ids in transcript order; the arrival store
    // itself keeps newest first. Counts retain the scale when these are capped.
    arrived: input.arrived.slice(0, MAX_IDS),
    held: input.held.slice(-MAX_IDS),
    listed: input.listed.slice(-MAX_IDS),
    hidden,
    missingStore,
    exempt,
  }
}
