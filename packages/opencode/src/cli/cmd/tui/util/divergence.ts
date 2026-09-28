// A client-side transcript observation, not a claim that pixels were painted.
// The Session component supplies independent sources: live event ids, store ids,
// and ids in its computed transcript list. No message/part content enters this API.
export type TranscriptInput = {
  sessionID: string
  status: string
  arrived: readonly string[]
  held: readonly string[]
  listed: readonly string[]
  revertID?: string
  exempt?: (id: string) => string | undefined
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
