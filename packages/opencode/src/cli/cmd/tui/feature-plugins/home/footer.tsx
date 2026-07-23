import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createResource, Match, Show, Switch } from "solid-js"
import { Global } from "@opencode-ai/core/global"
import { formatProjectDirectory } from "../../util/directory-display"
import { detectIndicatorBackend, indicatorColor } from "../../util/vcs-indicator"
import { readSymTag, type SymTagInfo } from "../../util/snapshot-symtag"

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

  // Structural metadata from the last snapshot's sym tag (lazy, ~20ms fossil subprocess).
  const worktree = Global.Path.worktree || Global.Path.home
  const [symTag] = createResource(
    () => backend() === "fossil" ? worktree : null,
    async (wt) => readSymTag(wt),
  )

  const symSummary = createMemo(() => {
    const tag = symTag()
    if (!tag?.totalSymbols) return null
    // Compact: top 3 kinds + total, e.g. "fn=5,class=3,method=224 (410)"
    const topKinds = Object.entries(tag.symbolCountByKind)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([k, v]) => `${k}=${v}`)
      .join(",")
    return `${topKinds} (${tag.totalSymbols})`
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
