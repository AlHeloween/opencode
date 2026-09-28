import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { inspectTranscript, type TranscriptInput } from "./divergence"

/** Client-local, append-only event/state transitions; no prompt or part bodies. */
export function createDivergenceReporter(file: string, onError: (error: unknown) => void) {
  let previous: string | undefined
  let directoryReady = false
  let warned = false
  return {
    path: file,
    observe(input: TranscriptInput) {
      const snapshot = inspectTranscript(input)
      const key = JSON.stringify(snapshot)
      if (key === previous) return snapshot
      try {
        if (!directoryReady) {
          mkdirSync(dirname(file), { recursive: true })
          directoryReady = true
        }
        appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...snapshot }) + "\n")
        previous = key
      } catch (error) {
        // A diagnostic must not crash the event loop, but a failed write cannot
        // masquerade as an empty healthy trace. Warn once; retry on later state.
        if (!warned) {
          warned = true
          onError(error)
        }
      }
      return snapshot
    },
  }
}
