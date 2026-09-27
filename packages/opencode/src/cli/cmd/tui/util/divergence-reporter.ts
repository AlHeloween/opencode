import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { findDivergence, type DivergenceRecord } from "./divergence"

export type DivergenceReporter = {
  /** Feed one event. Returns the record if this event revealed a divergence. */
  report: (input: {
    arrived: ReadonlySet<string>
    drawn: ReadonlySet<string>
    exempt?: (id: string) => string | undefined
    event: { messageID: string; partID?: string; type: string }
  }) => DivergenceRecord | undefined
  /** Where the evidence is, so the answer can be read after a restart. */
  readonly path: string
  /** Ids the reporter has seen, so a caller can tell "never fired" from "no input". */
  readonly seen: ReadonlySet<string>
}

/**
 * THE PERSISTENCE IS THE POINT, and it is not a nicety.
 *
 * The symptom under investigation is repaired by RESTARTING the TUI — that is
 * the only known workaround (owner, three times in one morning: «перезапустил
 * TUI, и текст снова появился»). A debugger that writes to the screen or to
 * memory therefore loses its evidence exactly when the evidence matters. So
 * every record is APPENDED to a file on disk, and the file is the instrument's
 * real output. Nothing here is ever read back, summarised, or rewritten: the
 * project's own rule is that a log records what state cannot show, and this
 * records the one thing nobody can reconstruct later — a screen that disagreed
 * with the client, at an instant that no longer exists.
 *
 * FAIL-OPEN BY CONSTRUCTION, and deliberately: a reporter that throws inside
 * the TUI's event subscription would take the session down with it, and a
 * debugger that can break the thing it observes is worse than none. Every
 * write is wrapped; a failed write is swallowed HERE and nowhere else, which is
 * the one place in this session's codebase where a bare catch is the right
 * shape — it is a best-effort observer, and its failure mode must be invisible
 * by definition or it becomes the next bug.
 */
export function createDivergenceReporter(file: string): DivergenceReporter {
  const seen = new Set<string>()
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {}
  return {
    path: file,
    seen,
    report(input) {
      seen.add(input.event.messageID)
      const record = findDivergence(input, input.event)
      if (!record || record.kind === "exempt") return record
      try {
        appendFileSync(file, JSON.stringify(record) + "\n")
      } catch {}
      return record
    },
  }
}
