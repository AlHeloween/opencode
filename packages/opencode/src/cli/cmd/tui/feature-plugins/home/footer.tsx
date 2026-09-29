import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createResource, Match, Show, Switch } from "solid-js"
import { Global } from "@opencode-ai/core/global"
import { formatProjectDirectory } from "../../util/directory-display"
import { detectIndicatorBackend, indicatorColor } from "../../util/vcs-indicator"
import { readSnapshotImpact } from "../../util/snapshot-symtag"

const id = "internal:home-footer"

function Directory(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const dir = createMemo(() => {
    const dir = props.api.state.path.directory || process.cwd()
    return formatProjectDirectory({
      directory: dir,
      worktree: Global.Path.worktree || Global.Path.home,
      branch: props.api.state.vcs?.branch,
    })
  })
  const root = createMemo(() => Global.Path.worktree)

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={theme().textMuted}>{dir()}</text>
      <text fg={theme().textMuted}>{root()}</text>
    </box>
  )
}

function Mcp(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.mcp())
  const has = createMemo(() => list().length > 0)
  const err = createMemo(() => list().some((item) => item.status === "failed"))
  const count = createMemo(() => list().filter((item) => item.status === "connected").length)

  return (
    <Show when={has()}>
      <box gap={1} flexDirection="row" flexShrink={0}>
        <text fg={theme().text}>
          <Switch>
            <Match when={err()}>
              <span style={{ fg: theme().error }}>⊙ </span>
            </Match>
            <Match when={true}>
              <span style={{ fg: count() > 0 ? theme().success : theme().textMuted }}>⊙ </span>
            </Match>
          </Switch>
          {count()} MCP
        </text>
        <text fg={theme().textMuted}>/status</text>
      </box>
    </Show>
  )
}

function ConstitutionBypass() {
  const bypassed = createMemo(() => {
    const v = process.env["OPENCODE_BYPASS_CONSTITUTION"]
    return v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "yes"
  })
  // no-op when not bypassed — clean footer
  if (!bypassed()) return null
  return (
    <box flexShrink={0}>
      <text>
        <span style={{ fg: "#ebcb8b" }}>⚠</span>
        <span style={{ fg: "#d08770" }}> bypass</span>
      </text>
    </box>
  )
}

function Version(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current

  return (
    <box flexShrink={0}>
      <text fg={theme().textMuted}>{props.api.app.version}</text>
    </box>
  )
}

function SnapshotBackend() {
  // Snapshot Fossil vs project git are independent — see vcs-indicator.ts.
  // Prefer fossil when sidecar exists even if .git is present (or index.lock stuck).
  const backend = createMemo(() => detectIndicatorBackend(Global.Path.worktree || Global.Path.home))
  const color = createMemo(() => indicatorColor(backend()))
  const vcs = createMemo(() => (backend() ? backend()! : "no vcs"))

  // The LAST snapshot, two halves (lazy: ~20ms fossil + ~200ms readonly SQLite pack):
  // the BRIEF (which files changed — fossil) and the IMPACT (symbols — the graph).
  // Replaces the retired `sym` tag, which measured EMPTY on the live repo
  // (`sym=KINDS:none`) and therefore rendered nothing at all (owner, 2026-09-29:
  // «fossil нам нужен только чтобы показать краткий бриф изменений, а codegraph
  // покажет реальные»).
  const worktree = Global.Path.worktree || Global.Path.home
  const [snapshotImpact] = createResource(
    () => backend() === "fossil" ? worktree : null,
    async (wt) => readSnapshotImpact(wt),
  )

  const symSummary = createMemo(() => {
    const snap = snapshotImpact()
    if (!snap) return null
    const files = snap.changedFiles.length === 0 ? null : `${snap.changedFiles.length} file${snap.changedFiles.length === 1 ? "" : "s"}`
    if (!snap.totalSymbols) {
      // Never blank while a snapshot exists: the brief is a true statement even when
      // the graph holds none of the files (an edit to plans/ or experiments/), and a
      // blank reads as "it does not work" (AGENTS.md: absence of an oracle is FALSE).
      if (!files) return null
      return snap.impactUnavailable ? `${files} · impact n/a` : files
    }
    // Compact: top 3 kinds + total, e.g. "fn=5,class=3,method=224 (410)"
    const topKinds = Object.entries(snap.symbolCountByKind)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([k, v]) => `${k}=${v}`)
      .join(",")
    return files ? `${files} · ${topKinds} (${snap.totalSymbols})` : `${topKinds} (${snap.totalSymbols})`
  })

  return (
    <box flexShrink={0} gap={1} flexDirection="row">
      <text>
        <span style={{ fg: color() }}>●</span>{" "}
        <span style={{ fg: backend() ? "#d8dee9" : "#4c566a" }}>{vcs()}</span>
      </text>
      <Show when={symSummary()}>
        <text>
          <span style={{ fg: "#b48ead" }}>◆</span>{" "}
          <span style={{ fg: "#81a1c1" }}>{symSummary()}</span>
        </text>
      </Show>
    </box>
  )
}

function View(props: { api: TuiPluginApi }) {
  return (
    <box
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      gap={2}
    >
      <Directory api={props.api} />
      <Mcp api={props.api} />
      <SnapshotBackend />
      <ConstitutionBypass />
      <box flexGrow={1} />
      <Version api={props.api} />
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
