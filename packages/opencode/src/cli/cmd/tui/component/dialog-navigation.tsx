import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { EffectiveNavigation } from "../util/effective-navigation"
import { Truncate } from "@/tool/truncate"
import { useSync } from "@tui/context/sync"
import { existsSync, readdirSync } from "fs"
import path from "path"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import * as Log from "@opencode-ai/core/util/log"
import { useProject } from "@tui/context/project"

const log = Log.create({ service: "tui.dialog-permissions" })

/** Directory browser: lists subdirs of `basePath`, click to fill path input. */
function DirectoryBrowser(props: {
  basePath: string
  onSelect: (p: string) => void
  theme: { primary: any; text: any; textMuted: any }
}) {
  const t = props.theme
  const [cursor, setCursor] = createSignal(0)
  const entries = createMemo(() => {
    const bp = props.basePath
    if (!bp) return []
    try {
      const resolved = path.resolve(EffectiveNavigation.expandPath(bp))
      if (!existsSync(resolved)) return []
      const items = readdirSync(resolved, { withFileTypes: true })
      const dirs = items.filter((d) => d.isDirectory()).map((d) => d.name)
      const parent = path.dirname(resolved)
      return parent !== resolved ? ["..", ...dirs.sort()] : dirs.sort()
    } catch (err) {
      log.warn("bug: DirectoryBrowser readdir failed", { basePath: bp, error: String(err) })
      return []
    }
  })

  return (
    <Show when={entries().length > 0}>
      <scrollbox height={6}>
        <For each={entries()}>
          {(name, i) => (
            <box
              flexDirection="row"
              gap={1}
              paddingLeft={1}
              backgroundColor={cursor() >= 0 && cursor() === i() ? t.primary : undefined}
              onMouseUp={() => {
                setCursor(i())
                const bp = props.basePath
                const resolved = name === ".."
                  ? path.dirname(path.resolve(EffectiveNavigation.expandPath(bp)))
                  : path.resolve(EffectiveNavigation.expandPath(bp), name)
                props.onSelect(resolved)
              }}
            >
              <text fg={t.textMuted}>
                {name === ".." ? "📁 .." : "📁"} {name}
              </text>
            </box>
          )}
        </For>
      </scrollbox>
    </Show>
  )
}

type ExternalDirMode = "deny" | "ask" | "allow"
type PolicyAction = "ask" | "allow" | "deny"

const POLICY_ACTIONS: PolicyAction[] = ["ask", "allow", "deny"]
const EXT_MODES: ExternalDirMode[] = ["ask", "allow", "deny"]

/**
 * Runtime defaults when config.permission omits a key (see agent.ts defaults).
 * "*" allows tools; only constitution DESTRUCTIVE is denied by default.
 */
const TOOL_DEFAULTS: Record<string, PolicyAction> = {
  "destructive-file": "deny",
  "destructive-db": "deny",
  "destructive-git": "deny",
  "destructive-fossil": "deny",
  destructive: "deny",
  bash: "allow",
  cmd: "allow",
  powershell: "allow",
  run: "allow",
  edit: "allow",
  doom_loop: "ask",
  webfetch: "allow",
  messagesearch: "allow",
  "session-read": "allow",
}

/** Tool policies shown in /permissions — persisted via config.permission. */
const TOOL_POLICIES: {
  key: string
  label: string
  hint: string
  danger?: boolean
  section?: string
}[] = [
  {
    key: "destructive-file",
    label: "Destructive (file)",
    hint: "rm -rf, disk wipe — independent of db/git/fossil; not covered by bash:*",
    danger: true,
    section: "Shell & exec",
  },
  {
    key: "destructive-db",
    label: "Destructive (db)",
    hint: "DROP TABLE/DATABASE, TRUNCATE — independent of file/git/fossil",
    danger: true,
    section: "Shell & exec",
  },
  {
    key: "destructive-git",
    label: "Destructive (git)",
    hint: "force-push, clean -f; checkout/stash pop hard-blocked — independent of file/db/fossil",
    danger: true,
    section: "Shell & exec",
  },
  {
    key: "destructive-fossil",
    label: "Destructive (fossil)",
    hint: "agent fossil commit/add/… hard-blocked; snapshot is runtime-only",
    danger: true,
    section: "Shell & exec",
  },
  {
    key: "bash",
    label: "Bash",
    hint: "bash tool with POSIX shell (bash/zsh/sh)",
    section: "Shell & exec",
  },
  {
    key: "powershell",
    label: "PowerShell",
    hint: "bash tool when shell is pwsh/powershell",
    section: "Shell & exec",
  },
  {
    key: "cmd",
    label: "Cmd",
    hint: "Windows cmd tool + bash tool when shell is cmd.exe",
    section: "Shell & exec",
  },
  {
    key: "run",
    label: "Run",
    hint: "run tool — direct binary/exec (not a shell)",
    section: "Shell & exec",
  },
  { key: "edit", label: "Edit / write", hint: "File mutations (edit, write, patch)", section: "Tools" },
  { key: "doom_loop", label: "Doom loop", hint: "Continue after repeated tool failures", section: "Tools" },
  { key: "webfetch", label: "Web fetch", hint: "Outbound HTTP", section: "Tools" },
  { key: "messagesearch", label: "Message search", hint: "Inferred history search", section: "Tools" },
  { key: "session-read", label: "Session read", hint: "Exact archive by message ID", section: "Tools" },
]

type NavRow =
  | { kind: "tool"; key: string; label: string; hint: string; danger?: boolean; section?: string }
  | { kind: "external"; label: string; hint: string; section?: string }
  | { kind: "agent-permission"; agentName: string; toolKey: string; label: string; hint: string; section?: string; displayLabel: string }
  | { kind: "agent-header"; agentName: string }
  | { kind: "directory"; displayPath: string; action: "allow" | "deny"; source: string; exists: boolean }
  | { kind: "action"; id: "save" | "reload" | "close"; label: string }

const POLICY_ROWS: NavRow[] = [
  ...TOOL_POLICIES.map(
    (p): NavRow => ({
      kind: "tool",
      key: p.key,
      label: p.label,
      hint: p.hint,
      danger: p.danger,
      section: p.section,
    }),
  ),
  {
    kind: "external",
    label: "External directory",
    hint: "Default outside worktree — navigation.allow still works when Deny",
    section: "Tools",
  },
]

const FOOTER_ROWS: NavRow[] = [
  { kind: "action", id: "save", label: "Save" },
  { kind: "action", id: "reload", label: "Reload" },
  { kind: "action", id: "close", label: "Close" },
]

function sourceLabel(source: string) {
  switch (source) {
    case "config-allow":
      return "config"
    case "config-deny":
      return "denied"
    case "config-permission":
      return "perm"
    case "auto":
      return "auto"
    default:
      return source
  }
}

function normalizeNavList(list: string[] | undefined): string[] {
  return [...(list ?? [])]
}

function samePath(a: string, b: string) {
  const resolvedA = path.resolve(EffectiveNavigation.expandPath(a))
  const resolvedB = path.resolve(EffectiveNavigation.expandPath(b))
  if (process.platform === "win32") {
    return resolvedA.toLowerCase() === resolvedB.toLowerCase()
  }
  return resolvedA === resolvedB
}

function cycleIn<T>(list: readonly T[], current: T, dir: 1 | -1): T {
  const i = list.indexOf(current)
  const base = i < 0 ? 0 : i
  return list[(base + dir + list.length * 10) % list.length]!
}

/** Worktree overlay path: `{directory}/config.json` (same file Config.update uses). */
function configOverlayPath(directory: string) {
  return path.join(directory, "config.json")
}

/** Read JSON object from disk; missing/invalid → {}. */
async function readJsonFile(file: string): Promise<Record<string, unknown>> {
  try {
    if (!existsSync(file)) return {}
    const text = await Bun.file(file).text()
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch (err) {
    log.warn("bug: readJsonFile failed", { file, error: String(err) })
    return {}
  }
}

/** Deep-merge plain objects (patch wins). Arrays replaced. `undefined` deletes the key. */
function mergePlain(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete out[key]
      continue
    }
    const prev = out[key]
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === "object" &&
      !Array.isArray(prev)
    ) {
      out[key] = mergePlain(prev as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}

/** Build a clean navigation object (omit empty lists). */
function navigationObject(allow: string[], deny: string[]): Record<string, string[]> | undefined {
  const nav: Record<string, string[]> = {}
  if (allow.length > 0) nav.allow = allow
  if (deny.length > 0) nav.deny = deny
  return Object.keys(nav).length > 0 ? nav : undefined
}

export function DialogPermissions() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const project = useProject()
  const sdk = useSDK()
  const toast = useToast()
  const selectedFg = selectedForeground(theme)

  const [addPath, setAddPath] = createSignal("")
  const [addMode, setAddMode] = createSignal<"allow" | "deny">("allow")
  const [busy, setBusy] = createSignal(false)
  const [cursor, setCursor] = createSignal(0)
  const [pathFocused, setPathFocused] = createSignal(false)
  let pathInput: { focus: () => void; blur?: () => void; value: string; isDestroyed?: boolean; plainText?: string } | undefined

  /**
   * Resolve config.permission[key] to ask|allow|deny.
   * When the key is omitted, show the runtime default (agent.ts), not "ask".
   */
  const toolPolicyFromConfig = (key: string): PolicyAction => {
    const fallback = TOOL_DEFAULTS[key] ?? "allow"
    const perm = (sync.data.config as any)?.permission
    if (!perm || typeof perm !== "object") return fallback
    const rule = perm[key]
    if (rule === "allow" || rule === "deny" || rule === "ask") return rule
    if (rule && typeof rule === "object" && typeof rule["*"] === "string") {
      const a = rule["*"]
      if (a === "allow" || a === "deny" || a === "ask") return a
    }
    return fallback
  }

  const extModeFromConfig = (): ExternalDirMode => {
    const mode = (sync.data.config as any)?.external_directory_mode as ExternalDirMode | undefined
    return mode === "deny" || mode === "allow" || mode === "ask" ? mode : "ask"
  }

  // Draft values — edits stay local until Save.
  const [draftTools, setDraftTools] = createStore<Record<string, PolicyAction>>({})
  const [draftExternal, setDraftExternal] = createSignal<ExternalDirMode>("ask")
  // agentName → toolKey → PolicyAction | undefined (undefined = inherit global)
  const [draftAgentPerms, setDraftAgentPerms] = createStore<Record<string, Record<string, PolicyAction | undefined>>>({})

  const loadDraftFromConfig = () => {
    const next: Record<string, PolicyAction> = {}
    for (const p of TOOL_POLICIES) next[p.key] = toolPolicyFromConfig(p.key)
    setDraftTools(next)
    setDraftExternal(extModeFromConfig())
    // Load per-agent permission overrides
    const agentPerms: Record<string, Record<string, PolicyAction | undefined>> = {}
    const cfg = sync.data.config as any
    const agents = cfg?.agent as Record<string, any> | undefined
    if (agents && typeof agents === "object") {
      for (const [agentName, agentCfg] of Object.entries(agents)) {
        if (!agentCfg || typeof agentCfg !== "object") continue
        const perm = agentCfg.permission as Record<string, string> | undefined
        if (perm && typeof perm === "object") {
          agentPerms[agentName] = {}
          for (const p of TOOL_POLICIES) {
            const v = perm[p.key]
            if (v === "allow" || v === "deny" || v === "ask") agentPerms[agentName]![p.key] = v
          }
        }
      }
    }
    setDraftAgentPerms(agentPerms)
  }

  onMount(() => {
    dialog.setSize("large")
    loadDraftFromConfig()
  })

  const dirty = createMemo(() => {
    for (const p of TOOL_POLICIES) {
      const fallback = TOOL_DEFAULTS[p.key] ?? "allow"
      if ((draftTools[p.key] ?? fallback) !== toolPolicyFromConfig(p.key)) return true
    }
    if (draftExternal() !== extModeFromConfig()) return true
    // Check agent-permission drafts
    for (const [agentName, perms] of Object.entries(draftAgentPerms)) {
      for (const [key, val] of Object.entries(perms)) {
        const cfgVal = (sync.data.config as any)?.agent?.[agentName]?.permission?.[key]
        if (val !== (cfgVal as PolicyAction | undefined)) return true
      }
    }
    return false
  })

  const rules = createMemo(() => {
    try {
      const config = sync.data.config as any
      const autoGlobs = [Truncate.truncateGlob()]
      const collected = EffectiveNavigation.collectNavigationRules(config, autoGlobs)
      const deduped = EffectiveNavigation.deduplicateRules(collected)
      return deduped.map((r) => ({
        action: r.action,
        displayPath: String(r.displayPath),
        source: String(r.source),
        exists: existsSync(String(r.displayPath).replace(/\*$/, "").replace(/[\\/]+$/, "")),
      }))
    } catch (err) {
      log.warn("bug: failed to collect navigation rules", { error: String(err) })
      return []
    }
  })

  const allRows = createMemo(() => {
    const dirRows: NavRow[] = rules().map((r) => ({
      kind: "directory" as const,
      displayPath: r.displayPath,
      action: r.action as "allow" | "deny",
      source: r.source,
      exists: r.exists,
    }))
    // Build agent-permission rows: one per (primary-agent × tool) where override exists
    const agentPermRows: NavRow[] = []
    const cfg = sync.data.config as any
    const agents = cfg?.agent as Record<string, any> | undefined
    if (agents && typeof agents === "object") {
      for (const agentName of Object.keys(agents).sort()) {
        const agentCfg = agents[agentName]
        if (!agentCfg || typeof agentCfg !== "object") continue
        // Only show primary agents (skip subagents)
        if (agentCfg.mode === "subagent") continue
        let headerAdded = false
        for (const p of TOOL_POLICIES) {
          const override = draftAgentPerms[agentName]?.[p.key]
          if (override === undefined) continue
          if (!headerAdded) {
            agentPermRows.push({ kind: "agent-header", agentName })
            headerAdded = true
          }
          agentPermRows.push({
            kind: "agent-permission",
            agentName,
            toolKey: p.key,
            label: p.label,
            hint: p.hint,
            section: p.section,
            displayLabel: `${p.label}`,
          })
        }
      }
    }
    return [...POLICY_ROWS, ...agentPermRows, ...dirRows, ...FOOTER_ROWS]
  })

  /** Index of the directory entry currently being "edited" via browse (Enter on dir row). */
  const [editingDirPath, setEditingDirPath] = createSignal<string | null>(null)

  const modeLabel = (m: PolicyAction) => {
    switch (m) {
      case "deny":
        return "Deny"
      case "ask":
        return "Ask"
      case "allow":
        return "Allow"
    }
  }

  const extModeLabel = (m: ExternalDirMode) => {
    switch (m) {
      case "deny":
        return "Deny"
      case "ask":
        return "Ask"
      case "allow":
        return "Allow"
    }
  }

  const modeColor = (m: PolicyAction | ExternalDirMode) => {
    switch (m) {
      case "deny":
        return theme.error
      case "ask":
        return theme.warning
      case "allow":
        return theme.success
    }
  }

  const draftValue = (row: NavRow): string => {
    if (row.kind === "tool") return modeLabel(draftTools[row.key] ?? "ask")
    if (row.kind === "external") return extModeLabel(draftExternal())
    if (row.kind === "agent-permission") {
      const val = draftAgentPerms[row.agentName]?.[row.toolKey]
      if (val === undefined) return "——"
      return modeLabel(val)
    }
    if (row.kind === "agent-header") return row.agentName
    if (row.kind === "directory") return row.action === "allow" ? "Allow" : "Deny"
    return row.label
  }

  const draftColor = (row: NavRow) => {
    if (row.kind === "tool") return modeColor(draftTools[row.key] ?? "ask")
    if (row.kind === "external") return modeColor(draftExternal())
    if (row.kind === "agent-permission") {
      const val = draftAgentPerms[row.agentName]?.[row.toolKey]
      if (val === undefined) return theme.textMuted
      return modeColor(val)
    }
    if (row.kind === "agent-header") return theme.accent
    if (row.kind === "directory") return modeColor(row.action)
    return theme.text
  }

  const cycleDraft = (dir: 1 | -1, rowIndex?: number) => {
    const idx = rowIndex ?? cursor()
    const row = allRows()[idx]
    if (!row || row.kind === "action" || row.kind === "agent-header") return
    if (row.kind === "tool") {
      const cur = draftTools[row.key] ?? TOOL_DEFAULTS[row.key] ?? "ask"
      setDraftTools(row.key, cycleIn(POLICY_ACTIONS, cur, dir))
      return
    }
    if (row.kind === "agent-permission") {
      const cur = draftAgentPerms[row.agentName]?.[row.toolKey]
      // —— → ask → allow → deny → ——  (right=1)
      // —— → deny → allow → ask → ——  (left=-1)
      const seq: (PolicyAction | undefined)[] = [undefined, "ask", "allow", "deny"]
      const idx = seq.indexOf(cur)
      let nidx = idx < 0 ? 0 : idx + dir
      if (nidx < 0) nidx = seq.length - 1
      if (nidx >= seq.length) nidx = 0
      const next = seq[nidx]
      setDraftAgentPerms(row.agentName, row.toolKey, next as any)
      // Auto-remove empty agent entry when all perms deleted
      if (next === undefined) {
        const remaining = Object.values(draftAgentPerms[row.agentName] ?? {}).filter((v) => v !== undefined)
        if (remaining.length === 1 && remaining[0] === draftAgentPerms[row.agentName]?.[row.toolKey]) {
          // This was the last override — nothing left after removal
        }
      }
      return
    }
    if (row.kind === "external") {
      setDraftExternal(cycleIn(EXT_MODES, draftExternal(), dir))
      return
    }
    // directory row: left/right toggles allow ↔ deny
    if (row.kind === "directory") {
      if (!busy()) void toggleDirectory(row.displayPath, row.action)
      return
    }
  }

  /**
   * Write patch straight to `{directory}/config.json`. No SDK body mapping.
   * Then poke the server to drop caches and refresh the in-memory store from disk.
   *
   * `navigation` is always replaced wholesale (not deep-merged) so removing the last
   * allowed dir actually clears the key on disk.
   */
  async function applyConfigPatch(patch: Record<string, unknown>, success?: string) {
    if (busy()) return false
    setBusy(true)
    try {
      const directory = project.instance.directory() || sync.path.directory || sdk.directory
      if (!directory) throw new Error("No project directory — cannot write config.json")

      const file = configOverlayPath(directory)
      const existing = await readJsonFile(file)
      const { navigation: navPatch, ...rest } = patch
      const next = mergePlain(existing, {
        $schema: (existing.$schema as string) || "https://opencode.ai/config.json",
        ...rest,
      })
      if ("navigation" in patch) {
        if (navPatch === undefined || navPatch === null) {
          delete next.navigation
        } else {
          next.navigation = navPatch
        }
      }
      // Drop empty nested navigation if present
      const nav = next.navigation as { allow?: string[]; deny?: string[] } | undefined
      if (nav && !(nav.allow?.length) && !(nav.deny?.length)) {
        delete next.navigation
      }
      await Bun.write(file, JSON.stringify(next, null, 2))

      // Local UI immediately reflects disk (don't wait for server round-trip).
      const liveNav = next.navigation as { allow?: string[]; deny?: string[] } | undefined
      sync.set("config", {
        ...(sync.data.config as object),
        ...rest,
        navigation: liveNav,
        permission: (next.permission as object) ?? (sync.data.config as any)?.permission,
      } as any)

      // Server: drop instance caches so next tool call / get() reloads the file.
      await sdk.client.instance.dispose().catch((err: unknown) => {
        log.debug("instance dispose after config write failed", { error: String(err) })
      })
      await sync.bootstrap({ fatal: false }).catch((err) => {
        log.debug("bootstrap after config write failed", { error: String(err) })
      })

      if (success) {
        toast.show({ title: "Permissions", message: `${success}\n${file}`, variant: "success" })
      }
      return true
    } catch (err) {
      log.warn("bug: permission config write failed", { error: String(err), patch })
      toast.show({
        title: "Permissions",
        message: `Failed to write config.json: ${String(err)}`,
        variant: "error",
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = async () => {
    if (busy()) return
    if (!dirty()) {
      toast.show({ title: "Permissions", message: "No changes to save", variant: "warning" })
      return
    }
    // Preserve ALL existing permission keys (including unknown/custom ones),
    // then overlay draft tool values on top.
    const existingPerm = (sync.data.config as any)?.permission as Record<string, unknown> | undefined
    const permission: Record<string, PolicyAction | Record<string, PolicyAction>> =
      existingPerm && typeof existingPerm === "object"
        ? ({ ...existingPerm } as Record<string, PolicyAction | Record<string, PolicyAction>>)
        : {}
    for (const p of TOOL_POLICIES) {
      const fallback = TOOL_DEFAULTS[p.key] ?? "allow"
      permission[p.key] = draftTools[p.key] ?? fallback
    }
    // Write per-agent permission overrides to config.agent[name].permission
    const existingCfg = (sync.data.config as any)
    const existingAgent = (existingCfg?.agent ?? {}) as Record<string, any>
    const agentPatch: Record<string, any> = {}
    for (const [agentName, perms] of Object.entries(draftAgentPerms)) {
      const agentPermObj: Record<string, PolicyAction> = {}
      for (const [key, val] of Object.entries(perms)) {
        if (val !== undefined) agentPermObj[key] = val
      }
      if (Object.keys(agentPermObj).length > 0) {
        agentPatch[agentName] = {
          ...(existingAgent[agentName] ?? {}),
          permission: agentPermObj,
        }
      } else {
        // Remove permission key if all overrides cleared
        const existing = existingAgent[agentName]
        if (existing && typeof existing === "object" && "permission" in existing) {
          const { permission: _drop, ...rest } = existing
          agentPatch[agentName] = Object.keys(rest).length > 0 ? rest : undefined
        }
      }
    }
    // Also clear agents that had permission removed entirely
    for (const [agentName, agentCfg] of Object.entries(existingAgent)) {
      if (agentName in draftAgentPerms) continue // handled above
      if (!agentCfg || typeof agentCfg !== "object") continue
      if ("permission" in agentCfg) {
        const { permission: _drop, ...rest } = agentCfg as Record<string, unknown>
        agentPatch[agentName] = Object.keys(rest).length > 0 ? rest : undefined
      }
    }

    const ok = await applyConfigPatch(
      {
        permission,
        external_directory_mode: draftExternal(),
        ...(Object.keys(agentPatch).length > 0 ? { agent: agentPatch } : {}),
      },
      "Wrote settings",
    )
    if (ok) loadDraftFromConfig()
  }

  const reloadDraft = async () => {
    if (busy()) return
    setBusy(true)
    try {
      await sync.bootstrap({ fatal: false }).catch((err) => {
        log.debug("bootstrap on permission reload failed", { error: String(err) })
      })
      loadDraftFromConfig()
      toast.show({ title: "Permissions", message: "Reloaded from config", variant: "success" })
    } finally {
      setBusy(false)
    }
  }

  const activateRow = (idx: number) => {
    const row = allRows()[idx]
    if (!row) return
    if (row.kind === "action") {
      if (row.id === "save") void saveDraft()
      else if (row.id === "reload") void reloadDraft()
      else dialog.clear()
      return
    }
    if (row.kind === "agent-header") return
    if (row.kind === "directory") {
      // Enter on a directory row: open browser starting from that path (or project root)
      const startPath = row.displayPath || sdk.directory || ""
      setAddPath(startPath)
      setEditingDirPath(row.displayPath)
      setPathFocused(true)
      pathInput?.focus?.()
      if (pathInput && !pathInput.isDestroyed) {
        try { pathInput.value = startPath } catch { /* ignore */ }
      }
      return
    }
    // Enter on a policy cycles forward (draft only)
    cycleDraft(1, idx)
  }

  const moveCursor = (delta: number) => {
    const n = allRows().length
    if (n === 0) return
    setCursor((c) => (c + delta + n * 10) % n)
  }

  const addDirectoryFor = async (raw: string) => {
    const resolved = path.resolve(EffectiveNavigation.expandPath(raw))
    const action = addMode()
    const prev = (sync.data.config as any).navigation ?? {}
    let allow = normalizeNavList(prev.allow).filter((d) => !samePath(d, resolved))
    let deny = normalizeNavList(prev.deny).filter((d) => !samePath(d, resolved))

    // If editing an existing directory (Enter on dir row), remove the old path too
    const editing = editingDirPath()
    if (editing) {
      const oldResolved = path.resolve(EffectiveNavigation.expandPath(editing.replace(/[\\/]+$/, "")))
      allow = allow.filter((d) => !samePath(d, oldResolved))
      deny = deny.filter((d) => !samePath(d, oldResolved))
    }

    if (action === "allow") allow.push(resolved)
    else deny.push(resolved)

    const ok = await applyConfigPatch(
      { navigation: navigationObject(allow, deny) },
      `${action === "allow" ? "Allowed" : "Denied"}: ${resolved}`,
    )
    if (ok) {
      setAddPath("")
      setEditingDirPath(null)
      // Clear the input imperatively
      if (pathInput && !pathInput.isDestroyed && pathInput.value !== undefined) {
        try { pathInput.value = "" } catch { /* ref stale */ }
      }
    }
  }

  const addDirectory = async () => {
    // Deprecated: use addDirectoryFor(raw) via onSubmit instead.
    // Kept for mouse-click on '+ Add' button path.
    const raw = (pathInput?.plainText ?? pathInput?.value ?? "").trim()
    if (!raw) {
      toast.show({ title: "Permissions", message: "Enter a directory path first", variant: "warning" })
      pathInput?.focus()
      setPathFocused(true)
      return
    }
    await addDirectoryFor(raw)
  }

  const removeDirectory = async (displayPath: string, action: "allow" | "deny") => {
    const resolved = path.resolve(EffectiveNavigation.expandPath(displayPath.replace(/[\\/]+$/, "")))
    const prev = (sync.data.config as any).navigation ?? {}
    let allow = normalizeNavList(prev.allow)
    let deny = normalizeNavList(prev.deny)
    if (action === "allow") allow = allow.filter((d) => !samePath(d, resolved))
    else deny = deny.filter((d) => !samePath(d, resolved))

    // Also remove from permission.external_directory if present (config-permission source)
    const prevPerm = (sync.data.config as any)?.permission as Record<string, unknown> | undefined
    const extDir = prevPerm?.external_directory as Record<string, string> | undefined
    const patchExt: Record<string, undefined> = {}
    if (extDir && typeof extDir === "object") {
      for (const [pattern, ruleAction] of Object.entries(extDir)) {
        const patternDir = path.resolve(EffectiveNavigation.expandPath(pattern.replace(/[\\/]+$/, "").replace(/[\\/]\*+$/, "")))
        const matchDir = process.platform === "win32" ? patternDir.toLowerCase() === resolved.toLowerCase() : patternDir === resolved
        const matchPattern = process.platform === "win32"
          ? `${patternDir}\\*`.toLowerCase() === pattern.toLowerCase() || `${patternDir}/*`.toLowerCase() === pattern.toLowerCase()
          : `${patternDir}\\*` === pattern || `${patternDir}/*` === pattern
        if (matchDir || matchPattern) {
          patchExt[pattern] = undefined // remove key via mergePlain
        }
      }
    }

    const patch: Record<string, unknown> = { navigation: navigationObject(allow, deny) }
    if (Object.keys(patchExt).length > 0) {
      patch.permission = { external_directory: patchExt }
    }
    const removed = await applyConfigPatch(patch, `Removed ${action}: ${resolved}`)
    if (!removed) {
      toast.show({ title: "Permissions", message: "Save in progress — try again", variant: "warning" })
    }
  }

  /** Toggle a directory between allow and deny (left/right on a dir row). */
  const toggleDirectory = async (displayPath: string, currentAction: "allow" | "deny") => {
    const resolved = path.resolve(EffectiveNavigation.expandPath(displayPath.replace(/[\\/]+$/, "")))
    const prev = (sync.data.config as any).navigation ?? {}
    let allow = normalizeNavList(prev.allow)
    let deny = normalizeNavList(prev.deny)

    if (currentAction === "allow") {
      allow = allow.filter((d) => !samePath(d, resolved))
      deny.push(resolved)
    } else {
      deny = deny.filter((d) => !samePath(d, resolved))
      allow.push(resolved)
    }

    const newAction = currentAction === "allow" ? "deny" : "allow"
    await applyConfigPatch(
      { navigation: navigationObject(allow, deny) },
      `${newAction === "allow" ? "Allowed" : "Denied"}: ${resolved}`,
    )
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    // While typing a path, only intercept Esc (dialog shell) and leave arrows to the input.
    if (pathFocused()) {
      if (evt.name === "up" || evt.name === "down" || evt.name === "escape") {
        pathInput?.blur?.()
        setPathFocused(false)
        setEditingDirPath(null)
        // fall through — up/down navigate list, escape lets dialog shell close
      } else {
        return
      }
    }

    if (evt.name === "up" || (evt.name === "k" && !evt.ctrl && !evt.meta)) {
      evt.preventDefault()
      evt.stopPropagation()
      moveCursor(-1)
      return
    }
    if (evt.name === "down" || (evt.name === "j" && !evt.ctrl && !evt.meta)) {
      evt.preventDefault()
      evt.stopPropagation()
      moveCursor(1)
      return
    }
    if (evt.name === "left" || (evt.name === "h" && !evt.ctrl && !evt.meta)) {
      evt.preventDefault()
      evt.stopPropagation()
      cycleDraft(-1)
      return
    }
    if (evt.name === "right" || (evt.name === "l" && !evt.ctrl && !evt.meta)) {
      evt.preventDefault()
      evt.stopPropagation()
      cycleDraft(1)
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      activateRow(cursor())
      return
    }
    // Backspace / Delete: remove a directory row or agent-permission
    if ((evt.name === "backspace" || evt.name === "delete") && !evt.ctrl && !evt.meta) {
      const row = allRows()[cursor()]
      if (row?.kind === "directory" && !busy()) {
        evt.preventDefault()
        evt.stopPropagation()
        void removeDirectory(row.displayPath, row.action)
        return
      }
      if (row?.kind === "agent-permission" && !busy()) {
        evt.preventDefault()
        evt.stopPropagation()
        setDraftAgentPerms(row.agentName, row.toolKey, undefined as any)
        return
      }
    }
    if (evt.name === "a" && !evt.ctrl && !evt.meta && !pathFocused()) {
      evt.preventDefault()
      evt.stopPropagation()
      setPathFocused(true)
      pathInput?.focus?.()
      return
    }
    if (evt.name === "s" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      evt.stopPropagation()
      void saveDraft()
      return
    }
    if (evt.name === "r" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      evt.stopPropagation()
      void reloadDraft()
      return
    }
  })

  const isSelected = (idx: number) => cursor() === idx && !pathFocused()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Permissions{dirty() ? " *" : ""}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>
        ↑↓ move · ←→ change · a add dir · Enter browse · Del remove · s save · r reload · Esc close.
        Changes are written to config.json and persist across restarts.
      </text>

      {/* Tool + external + agent-permission + directory rows (keyboard-navigable draft) */}
      <box gap={0}>
        <For each={allRows()}>
          {(row, i) => {
            const idx = () => i()
            const selected = () => isSelected(idx())
            const prevSection = () => {
              const prev = allRows()[idx() - 1]
              if (!prev || prev.kind === "action" || prev.kind === "directory" || prev.kind === "agent-header") return undefined
              return (prev as any).section
            }
            const section = () => (row.kind === "action" || row.kind === "directory" || row.kind === "agent-header" || row.kind === "agent-permission" ? undefined : row.section)
            const showSection = () => {
              if (row.kind === "agent-header") return true
              const s = section()
              return s && s !== prevSection()
            }
            // agent-header: render as section label
            if (row.kind === "agent-header") {
              return (
                <box gap={0}>
                  <Show when={showSection()}>
                    <text fg={theme.accent} attributes={TextAttributes.BOLD} paddingTop={1}>
                      {row.agentName} — per-agent overrides
                    </text>
                  </Show>
                </box>
              )
            }
            // action row: render in footer only
            if (row.kind === "action") {
              return null
            }
            return (
              <box gap={0}>
                <Show when={showSection()}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {section()}
                  </text>
                </Show>
                <box
                  flexDirection="row"
                  gap={1}
                  alignItems="center"
                  backgroundColor={selected() ? theme.primary : undefined}
                  onMouseUp={() => {
                    setPathFocused(false)
                    pathInput?.blur?.()
                    setCursor(idx())
                  }}
                  onMouseDown={() => {
                    setPathFocused(false)
                    setCursor(idx())
                  }}
                >
                  <text
                    fg={
                      busy() ? theme.textMuted :
                      selected() ? selectedFg : draftColor(row)
                    }
                    attributes={TextAttributes.BOLD}
                    onMouseUp={(e) => {
                      e.stopPropagation()
                      setPathFocused(false)
                      setCursor(idx())
                      // Single click on value: change draft only (do not save)
                      cycleDraft(1, idx())
                    }}
                  >
                    [{draftValue(row)}]
                  </text>
                  <text
                    fg={
                      busy() ? theme.textMuted :
                      selected()
                        ? selectedFg
                        : row.kind === "tool" && row.danger
                          ? theme.error
                          : theme.text
                    }
                  >
                    {row.kind === "agent-permission" ? `${row.agentName} · ${row.label}` : row.kind === "directory" ? row.displayPath : row.label}
                  </text>
                  <text fg={busy() ? theme.textMuted : selected() ? selectedFg : theme.textMuted}>
                    {row.kind === "action" || row.kind === "directory" || row.kind === "agent-header" ? "" : row.hint}
                  </text>
                </box>
              </box>
            )
          }}
        </For>
        <text fg={theme.textMuted}>
          {busy() ? "saving..." : dirty() ? "unsaved changes — press s or Save" : "click [mode] or ←→ to edit draft"}
        </text>
      </box>

      {/* Add Directory */}
      <box gap={0}>
        <text fg={theme.textMuted}>{editingDirPath() ? "Edit Directory" : "Add Directory"}</text>
        <box flexDirection="row" gap={1} alignItems="center">
          <text
            fg={addMode() === "allow" ? theme.success : theme.error}
            onMouseUp={() => setAddMode(addMode() === "allow" ? "deny" : "allow")}
          >
            [{addMode()}]
          </text>
          <box
            flexGrow={1}
              onMouseDown={() => {
                if (!pathFocused()) setPathFocused(true)
                pathInput?.focus()
              }}
          >
            <input
              placeholder="path (e.g. ~/projects)"
              placeholderColor={theme.textMuted}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
              textColor={theme.text}
              ref={(r) => {
                pathInput = r
              }}
              onInput={() => {
                if (!pathFocused()) setPathFocused(true)
              }}
              onSubmit={() => {
                setPathFocused(false)
                // Read value imperatively from the native InputRenderable —
                // uncontrolled to avoid Solid reactive value→cursorOffset reset loop.
                const v = (pathInput?.plainText ?? pathInput?.value ?? "").trim()
                if (!v) return
                setAddPath(v)
                void addDirectoryFor(v)
              }}
            />
          </box>
          <text
            fg={busy() ? theme.textMuted : theme.info}
            onMouseUp={() => {
              if (!busy()) void addDirectory()
            }}
          >
            {editingDirPath() ? "↻ Update" : "+ Add"}
          </text>
        </box>

        <DirectoryBrowser
          basePath={addPath()}
          onSelect={(p) => { setAddPath(p); setPathFocused(true); if (pathInput && !pathInput.isDestroyed) { try { pathInput.value = p } catch { /* ignore */ } pathInput.focus() } }}
          theme={theme}
        />
      </box>

      {/* Allowed / Denied Directories (keyboard-navigable) */}
      <Show
        when={rules().length > 0}
        fallback={<text fg={theme.textMuted}>No directory rules</text>}
      >
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Directories
        </text>
        <For each={rules()}>
          {(rule, i) => {
            const idx = () => POLICY_ROWS.length + i()
            const selected = () => isSelected(idx())
            const removable = () =>
              (rule.action === "allow" && (rule.source === "config-allow" || rule.source === "config-permission")) ||
              (rule.action === "deny" && (rule.source === "config-deny" || rule.source === "config-permission"))
            return (
              <box
                flexDirection="row"
                gap={1}
                alignItems="center"
                backgroundColor={selected() ? theme.primary : undefined}
                onMouseUp={() => {
                  setPathFocused(false)
                  pathInput?.blur?.()
                  setCursor(idx())
                }}
                onMouseDown={() => {
                  setPathFocused(false)
                  setCursor(idx())
                }}
              >
                <text
                  fg={
                    busy() ? theme.textMuted :
                    selected() ? selectedFg :
                    rule.action === "allow" ? theme.success : theme.error
                  }
                  attributes={TextAttributes.BOLD}
                  onMouseUp={(e) => {
                    e.stopPropagation()
                    setPathFocused(false)
                    setCursor(idx())
                    cycleDraft(1, idx())
                  }}
                >
                  [{rule.action === "allow" ? "Allow" : "Deny"}]
                </text>
                <text
                  fg={
                    busy() ? theme.textMuted :
                    selected() ? selectedFg :
                    rule.exists ? (rule.action === "allow" ? theme.success : theme.error) : theme.textMuted
                  }
                  wrapMode="word"
                >
                  {rule.exists ? (rule.action === "allow" ? "✓" : "✕") : "✗"} {rule.displayPath}
                </text>
                <text fg={busy() ? theme.textMuted : selected() ? selectedFg : theme.textMuted}>
                  ({sourceLabel(rule.source)})
                </text>
                <Show when={removable()}>
                  <text
                    fg={busy() ? theme.textMuted : selected() ? selectedFg : theme.error}
                    onMouseUp={(e) => {
                      e.stopPropagation()
                      if (!busy()) void removeDirectory(rule.displayPath, rule.action as "allow" | "deny")
                    }}
                  >
                    ✕
                  </text>
                </Show>
              </box>
            )
          }}
        </For>
        <text fg={theme.textMuted}>
          ←→ toggle allow/deny · Enter browse · Del remove · +/- add/remove
        </text>
      </Show>

      {/* Footer actions: Save / Reload / Close */}
      <box flexDirection="row" gap={2} justifyContent="flex-end" paddingTop={1}>
        <For each={FOOTER_ROWS}>
          {(row, i) => {
            const idx = () => POLICY_ROWS.length + rules().length + i()
            const selected = () => isSelected(idx())
            const isSave = row.kind === "action" && row.id === "save"
            const accent = () => {
              if (isSave && dirty()) return theme.success
              if (row.kind === "action" && row.id === "reload") return theme.info
              if (row.kind === "action" && row.id === "close" && !dirty()) return theme.text
              return theme.textMuted
            }
            return (
              <box
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={selected() ? theme.primary : undefined}
                onMouseUp={() => {
                  setPathFocused(false)
                  pathInput?.blur?.()
                  setCursor(idx())
                  activateRow(idx())
                }}
              >
                <text
                  fg={selected() ? selectedFg : accent()}
                  attributes={isSave && dirty() ? TextAttributes.BOLD : undefined}
                >
                  {row.kind === "action" ? row.label : ""}
                  {isSave && dirty() ? " *" : ""}
                </text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}
