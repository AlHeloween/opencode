import { formatDuration } from "@/util/format"

/**
 * Pure row computation for the sidebar "Active Sessions" block (t52).
 *
 * The DATA is event-synced by the TUI store (`session` list + `session_status`,
 * context/sync.tsx:623-626/964-966) — this module never polls. It only shapes
 * rows: state mapping, the busySince stamp/clear, elapsed math and ordering.
 * Kept beside `protocol-row.ts` so the block's logic is unit-testable in
 * isolation, and so «absence of an oracle reads as FALSE» holds here too:
 * an unrecognized status type renders `unknown`, never blank.
 */

export type SessionStatusLike = { type: string; attempt?: number }

export type SessionMeta = { agent?: string; model?: string }

export type ActiveSessionRow = {
  sessionID: string
  title: string
  agent: string
  model: string
  state: string
  glyph: string
  attempt?: number
  elapsedMs: number
  shortID: string
}

const STATE_META: Record<string, { label: string; glyph: string }> = {
  busy: { label: "working", glyph: "⏳" },
  retry: { label: "retrying", glyph: "⚠" },
  compacting: { label: "compacting", glyph: "⟳" },
  summarizing: { label: "summarizing", glyph: "⟳" },
}

export function stateMeta(type: string): { label: string; glyph: string } {
  return STATE_META[type] ?? { label: "unknown", glyph: "●" }
}

/** Never blank: a sub-second elapsed reads «0s» (AGENTS.md — absence reads as FALSE). */
export function elapsedLabel(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000))
  return formatDuration(secs) || "0s"
}

/**
 * One row per non-idle session of the server. `busySince` is the caller's
 * in-memory map: first non-idle sighting stamps `now`, idle/missing deletes.
 * Elapsed is therefore «busy as observed by this TUI process» — a restart
 * restarts the clock, the state itself does not.
 */
export function activeSessionRows(input: {
  sessions: ReadonlyArray<{ id: string; title: string }>
  statusOf: (sessionID: string) => SessionStatusLike | undefined
  metaOf: (sessionID: string) => SessionMeta | undefined
  busySince: Map<string, number>
  now: number
}): ActiveSessionRow[] {
  const rows: ActiveSessionRow[] = []
  for (const session of input.sessions) {
    const status = input.statusOf(session.id)
    if (!status || status.type === "idle") {
      input.busySince.delete(session.id)
      continue
    }
    const since = input.busySince.get(session.id) ?? input.now
    input.busySince.set(session.id, since)
    const meta = input.metaOf(session.id)
    const mapped = stateMeta(status.type)
    rows.push({
      sessionID: session.id,
      title: session.title,
      agent: meta?.agent ?? "unknown",
      model: meta?.model ?? "unknown",
      state: mapped.label,
      glyph: mapped.glyph,
      attempt: status.attempt,
      elapsedMs: Math.max(0, input.now - since),
      shortID: session.id.slice(0, 8),
    })
  }
  return rows.sort((a, b) => b.elapsedMs - a.elapsedMs)
}
