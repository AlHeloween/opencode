import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { EffectiveNavigation } from "../util/effective-navigation"
import { Truncate } from "@/tool/truncate"
import { useSync } from "@tui/context/sync"
import { existsSync } from "fs"
import path from "path"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tui.dialog-permissions" })

type ExternalDirMode = "deny" | "ask" | "allow"
type PolicyAction = "ask" | "allow" | "deny"

const POLICY_ACTIONS: PolicyAction[] = ["ask", "allow", "deny"]
const EXT_MODES: ExternalDirMode[] = ["ask", "allow", "deny"]

/**
 * Runtime defaults when config.permission omits a key (see agent.ts defaults).
 * "*" allows tools; only constitution DESTRUCTIVE is denied by default.
 */
const TOOL_DEFAULTS: Record<string, PolicyAction> = {
  destructive: "deny",
  bash: "allow",
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
}[] = [
  {
    key: "destructive",
    label: "Destructive shell",
    hint: "rm -rf, force-push, reset --hard — denied by default (not covered by bash:*)",
    danger: true,
  },
  {
    key: "bash",
    label: "Shell",
    hint: "bash tool (auto: bash / PowerShell / cmd) + Windows cmd tool (same permission)",
  },
  { key: "edit", label: "Edit / write", hint: "File mutations (edit, write, patch)" },
  { key: "doom_loop", label: "Doom loop", hint: "Continue after repeated tool failures" },
  { key: "webfetch", label: "Web fetch", hint: "Outbound HTTP" },
  { key: "messagesearch", label: "Message search", hint: "Inferred history search" },
  { key: "session-read", label: "Session read", hint: "Exact archive by message ID" },
]

type NavRow =
  | { kind: "tool"; key: string; label: string; hint: string; danger?: boolean }
  | { kind: "external"; label: string; hint: string }
  | { kind: "action"; id: "save" | "reload" | "close"; label: string }

const POLICY_ROWS: NavRow[] = [
  ...TOOL_POLICIES.map(
    (p): NavRow => ({
      kind: "tool",
      key: p.key,
      label: p.label,
      hint: p.hint,
      danger: p.danger,
    }),
  ),
  {
    kind: "external",
    label: "External directory",
    hint: "Access outside project worktree",
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
  return path.resolve(EffectiveNavigation.expandPath(a)) === path.resolve(EffectiveNavigation.expandPath(b))
}

function cycleIn<T>(list: readonly T[], current: T, dir: 1 | -1): T {
  const i = list.indexOf(current)
  const base = i < 0 ? 0 : i
  return list[(base + dir + list.length * 10) % list.length]!
}

export function DialogPermissions() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const selectedFg = selectedForeground(theme)

  const [addPath, setAddPath] = createSignal("")
  const [addMode, setAddMode] = createSignal<"allow" | "deny">("allow")
  const [busy, setBusy] = createSignal(false)
  const [cursor, setCursor] = createSignal(0)
  const [pathFocused, setPathFocused] = createSignal(false)
  let pathInput: { focus: () => void; blur?: () => void; value: string; isDestroyed?: boolean } | undefined

  const allRows = createMemo(() => [...POLICY_ROWS, ...FOOTER_ROWS])

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

  const loadDraftFromConfig = () => {
    const next: Record<string, PolicyAction> = {}
    for (const p of TOOL_POLICIES) next[p.key] = toolPolicyFromConfig(p.key)
    setDraftTools(next)
    setDraftExternal(extModeFromConfig())
  }

  onMount(() => {
    dialog.setSize("large")
    loadDraftFromConfig()
  })

  const dirty = createMemo(() => {
    for (const p of TOOL_POLICIES) {
      if ((draftTools[p.key] ?? "ask") !== toolPolicyFromConfig(p.key)) return true
    }
    if (draftExternal() !== extModeFromConfig()) return true
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

  const allowed = createMemo(() => rules().filter((r) => r.action === "allow"))
  const denied = createMemo(() => rules().filter((r) => r.action === "deny"))

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
        return "Deny All"
      case "ask":
        return "Ask"
      case "allow":
        return "Allow All"
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
    return row.label
  }

  const draftColor = (row: NavRow) => {
    if (row.kind === "tool") return modeColor(draftTools[row.key] ?? "ask")
    if (row.kind === "external") return modeColor(draftExternal())
    return theme.text
  }

  const cycleDraft = (dir: 1 | -1, rowIndex?: number) => {
    const idx = rowIndex ?? cursor()
    const row = allRows()[idx]
    if (!row || row.kind === "action") return
    if (row.kind === "tool") {
      const cur = draftTools[row.key] ?? "ask"
      setDraftTools(row.key, cycleIn(POLICY_ACTIONS, cur, dir))
      return
    }
    setDraftExternal(cycleIn(EXT_MODES, draftExternal(), dir))
  }

  async function applyConfigPatch(patch: Record<string, unknown>, success?: string) {
    if (busy()) return false
    setBusy(true)
    try {
      await sdk.client.config.update(patch as any)
      await sync.bootstrap({ fatal: false }).catch((err) => {
        log.debug("bootstrap after permission update failed", { error: String(err) })
      })
      if (success) {
        toast.show({ title: "Permissions", message: success, variant: "success" })
      }
      return true
    } catch (err) {
      log.warn("bug: permission config update failed", { error: String(err), patch })
      toast.show({
        title: "Permissions",
        message: `Failed to update: ${String(err)}`,
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
    const prev = { ...((sync.data.config as any)?.permission ?? {}) }
    for (const p of TOOL_POLICIES) {
      prev[p.key] = draftTools[p.key] ?? "ask"
    }
    const ok = await applyConfigPatch(
      {
        permission: prev,
        external_directory_mode: draftExternal(),
      },
      "Permissions saved to config",
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
    // Enter on a policy cycles forward (draft only)
    cycleDraft(1, idx)
  }

  const moveCursor = (delta: number) => {
    const n = allRows().length
    if (n === 0) return
    setCursor((c) => (c + delta + n * 10) % n)
  }

  const addDirectory = async () => {
    const raw = addPath().trim()
    if (!raw) {
      toast.show({ title: "Permissions", message: "Enter a directory path first", variant: "warning" })
      pathInput?.focus()
      setPathFocused(true)
      return
    }
    const resolved = path.resolve(EffectiveNavigation.expandPath(raw))
    const action = addMode()
    const nav = { ...((sync.data.config as any).navigation ?? {}) }
    let allow = normalizeNavList(nav.allow)
    let deny = normalizeNavList(nav.deny)

    allow = allow.filter((d) => !samePath(d, resolved))
    deny = deny.filter((d) => !samePath(d, resolved))

    if (action === "allow") allow.push(raw)
    else deny.push(raw)

    nav.allow = allow.length > 0 ? allow : undefined
    nav.deny = deny.length > 0 ? deny : undefined

    const ok = await applyConfigPatch(
      { navigation: nav },
      `${action === "allow" ? "Allowed" : "Denied"}: ${resolved}`,
    )
    if (ok) {
      setAddPath("")
      if (pathInput && !pathInput.isDestroyed) pathInput.value = ""
    }
  }

  const removeDirectory = async (displayPath: string, action: string) => {
    const resolved = path.resolve(EffectiveNavigation.expandPath(displayPath.replace(/[\\/]+$/, "")))
    const nav = { ...((sync.data.config as any).navigation ?? {}) }
    const list = normalizeNavList(nav[action])
    const next = list.filter((d: string) => !samePath(d, resolved))
    nav[action] = next.length > 0 ? next : undefined
    await applyConfigPatch({ navigation: nav }, `Removed ${action}: ${resolved}`)
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    // While typing a path, only intercept Esc (dialog shell) and leave arrows to the input.
    if (pathFocused()) {
      if (evt.name === "up" || evt.name === "down") {
        pathInput?.blur?.()
        setPathFocused(false)
        // fall through to list navigation
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
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      evt.stopPropagation()
      cycleDraft(-1)
      return
    }
    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      evt.stopPropagation()
      cycleDraft(1)
      return
    }
    if (evt.name === "return" || evt.name === "space") {
      evt.preventDefault()
      evt.stopPropagation()
      activateRow(cursor())
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
        ↑↓ move · ←→ change · Enter cycle · s save · r reload · Esc close. Session "Always" lasts until restart only.
      </text>

      {/* Tool + external policies (keyboard-navigable draft) */}
      <box gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Tool policies
        </text>
        <For each={POLICY_ROWS}>
          {(row, i) => {
            const idx = () => i()
            const selected = () => isSelected(idx())
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
                  fg={busy() ? theme.textMuted : selected() ? selectedFg : draftColor(row)}
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
                    selected()
                      ? selectedFg
                      : row.kind === "tool" && row.danger
                        ? theme.error
                        : theme.text
                  }
                >
                  {row.label}
                </text>
                <text fg={selected() ? selectedFg : theme.textMuted}>
                  {row.kind === "action" ? "" : row.hint}
                </text>
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
        <text fg={theme.textMuted}>Add Directory</text>
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
              setPathFocused(true)
              pathInput?.focus()
            }}
          >
            <input
              value={addPath()}
              onInput={(v) => {
                setPathFocused(true)
                setAddPath(v)
              }}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
              textColor={theme.text}
              placeholder="path (e.g. ~/projects)"
              placeholderColor={theme.textMuted}
              ref={(r) => {
                pathInput = r
              }}
              onSubmit={() => {
                void addDirectory()
              }}
            />
          </box>
          <text
            fg={busy() ? theme.textMuted : theme.info}
            onMouseUp={() => {
              if (!busy()) void addDirectory()
            }}
          >
            + Add
          </text>
        </box>
      </box>

      {/* Allowed Directories */}
      <Show when={allowed().length > 0} fallback={<text fg={theme.textMuted}>No allowed directories</text>}>
        <text fg={theme.success}>Allowed</text>
        <For each={allowed()}>
          {(rule) => (
            <box flexDirection="row" gap={1}>
              <text fg={rule.exists ? theme.success : theme.error} wrapMode="word">
                {rule.exists ? "✓" : "✗"} {rule.displayPath}
              </text>
              <text fg={theme.textMuted}>({sourceLabel(rule.source)})</text>
              {rule.source === "config-allow" && (
                <text
                  fg={theme.error}
                  onMouseUp={() => {
                    if (!busy()) void removeDirectory(rule.displayPath, "allow")
                  }}
                >
                  ✕
                </text>
              )}
            </box>
          )}
        </For>
      </Show>

      {/* Denied Directories */}
      <Show when={denied().length > 0}>
        <text fg={theme.error}>Denied</text>
        <For each={denied()}>
          {(rule) => (
            <box flexDirection="row" gap={1}>
              <text fg={rule.exists ? theme.error : theme.textMuted} wrapMode="word">
                ✕ {rule.displayPath}
              </text>
              <text fg={theme.textMuted}>({sourceLabel(rule.source)})</text>
              {rule.source === "config-deny" && (
                <text
                  fg={theme.success}
                  onMouseUp={() => {
                    if (!busy()) void removeDirectory(rule.displayPath, "deny")
                  }}
                >
                  ↩
                </text>
              )}
            </box>
          )}
        </For>
      </Show>

      {/* Footer actions: Save / Reload / Close */}
      <box flexDirection="row" gap={2} justifyContent="flex-end" paddingTop={1}>
        <For each={FOOTER_ROWS}>
          {(row, i) => {
            const idx = () => POLICY_ROWS.length + i()
            const selected = () => isSelected(idx())
            const isSave = row.kind === "action" && row.id === "save"
            const accent = () => {
              if (isSave && dirty()) return theme.success
              if (row.kind === "action" && row.id === "reload") return theme.info
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
