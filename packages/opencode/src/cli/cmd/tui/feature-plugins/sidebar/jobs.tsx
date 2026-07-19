import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"

const id = "internal:sidebar-jobs"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const jobs = createMemo(() => props.api.state.session.jobs(props.session_id))
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const running = createMemo(() => jobs().filter((j) => j.status === "running"))
  const stalled = createMemo(() => jobs().filter((j) => j.status === "stalled"))
  const terminal = createMemo(() => jobs().filter((j) => j.status === "done" || j.status === "failed" || j.status === "killed"))

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return theme().accent
      case "stalled": return theme().warning
      case "done": return theme().diffAdded
      case "failed": return theme().error
      case "killed": return theme().textMuted
      default: return theme().textMuted
    }
  }

  const elapsed = (startedAt: number) => {
    const sec = Math.round((Date.now() - startedAt) / 1000)
    if (sec < 60) return `${sec}s`
    return `${Math.floor(sec / 60)}m`
  }

  /** Strip ansi, trim, take last N lines of output. */
  const tail = (text: string, n: number) => {
    const clean = text.replace(/\x1b\[[0-9;]*m/g, "").trim()
    if (!clean) return ""
    const lines = clean.split("\n")
    return lines.slice(-n).join("\n")
  }

  const JobRow = (p: { job: ReturnType<typeof jobs>[0]; showOutput: boolean }) => (
    <box onMouseDown={() => toggle(p.job.id)}>
      <box flexDirection="row" gap={1} justifyContent="space-between">
        <text fg={statusColor(p.job.status)} wrapMode="none">
          {p.job.status === "stalled" ? "⚠" : p.job.status === "running" ? "⏳" : p.job.status === "done" ? "✓" : p.job.status === "failed" ? "✗" : "⊘"}{" "}
          {p.job.id}
        </text>
        <text fg={theme().textMuted}>{elapsed(p.job.startedAt)}</text>
      </box>
      <Show when={p.job.label}>
        <text fg={theme().textMuted} wrapMode="none">{p.job.label.slice(0, 40)}</text>
      </Show>
      <Show when={p.showOutput && p.job.output}>
        <text fg={theme().text}>{tail(p.job.output, 5)}</text>
      </Show>
    </box>
  )

  return (
    <Show when={jobs().length > 0}>
      <box>
        <text fg={theme().text}>
          <b>Background Jobs</b>
        </text>

        {/* Running / Stalled — needs attention, expand by default */}
        <Show when={running().length + stalled().length > 0}>
          <For each={[...running(), ...stalled()]}>
            {(job) => <JobRow job={job} showOutput={expanded().has(job.id) ?? true} />}
          </For>
        </Show>

        {/* Recently completed — collapsed by default */}
        <Show when={terminal().length > 0}>
          <text fg={theme().textMuted}>
            <em>Recent ({terminal().length})</em>
          </text>
          <For each={terminal().slice(-3)}>
            {(job) => <JobRow job={job} showOutput={expanded().has(job.id)} />}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 600,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
