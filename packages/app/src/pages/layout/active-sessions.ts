/**
 * Pure row computation for the web "Active Sessions" block (t59 W2).
 *
 * Same contract as the TUI block
 * (`packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/active-sessions.ts`):
 * the DATA is event-synced (`session` list + `session_status`, read from the
 * child sync stores fed by `session.list` / `session.status` + `GET /global/event`)
 * — this module never fetches. It only shapes rows: state mapping, the busySince
 * stamp/clear, elapsed math and longest-first ordering.
 *
 * «Absence of an oracle reads as FALSE»: an unrecognized status type renders
 * `unknown` (never blank), missing agent/model read `unknown`, and a sub-second
 * elapsed reads `0s`.
 */

export type SessionStatusLike = { type: string; attempt?: number }

export type SessionMeta = { agent?: string; model?: string }

export type ActiveSessionRow = {
  sessionID: string
  title: string
  agent: string
  model: string
  state: string
  attempt?: number
  elapsedMs: number
  shortID: string
}

const STATE_LABELS: Record<string, string> = {
  busy: "working",
  retry: "retrying",
  compacting: "compacting",
  summarizing: "summarizing",
}

export function stateMeta(type: string): { label: string } {
  return { label: STATE_LABELS[type] ?? "unknown" }
}

/** Mirrors the TUI `formatDuration` shape (`packages/opencode/src/util/format.ts`). */
export function formatDuration(secs: number): string {
  if (secs <= 0) return ""
  if (secs < 60) return `${secs}s`
  if (secs < 3600) {
    const mins = Math.floor(secs / 60)
    const remaining = secs % 60
    return remaining > 0 ? `${mins}m ${remaining}s` : `${mins}m`
  }
  if (secs < 86400) {
    const hours = Math.floor(secs / 3600)
    const remaining = Math.floor((secs % 3600) / 60)
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
  }
  if (secs < 604800) {
    const days = Math.floor(secs / 86400)
    return days === 1 ? "~1 day" : `~${days} days`
  }
  const weeks = Math.floor(secs / 604800)
  return weeks === 1 ? "~1 week" : `~${weeks} weeks`
}

/** Never blank: a sub-second elapsed reads «0s». */
export function elapsedLabel(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000))
  return formatDuration(secs) || "0s"
}

/**
 * One row per non-idle session. `busySince` is the caller's in-memory map:
 * first non-idle sighting stamps `now`, idle/missing deletes. Elapsed is
 * therefore «busy as observed by this web process» — a reload restarts the
 * clock, the state itself does not.
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
    rows.push({
      sessionID: session.id,
      title: session.title,
      agent: meta?.agent ?? "unknown",
      model: meta?.model ?? "unknown",
      state: stateMeta(status.type).label,
      attempt: status.attempt,
      elapsedMs: Math.max(0, input.now - since),
      shortID: session.id.slice(0, 8),
    })
  }
  return rows.sort((a, b) => b.elapsedMs - a.elapsedMs)
}
