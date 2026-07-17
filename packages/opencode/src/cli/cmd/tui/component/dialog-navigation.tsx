import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { For, Show, createMemo, createSignal, onMount } from "solid-js"
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
    hint: "rm -rf, git push --force, reset --hard (constitution)",
    danger: true,
  },
  { key: "bash", label: "Bash / shell", hint: "Normal shell commands" },
  { key: "edit", label: "Edit / write", hint: "File mutations (edit, write, patch)" },
  { key: "doom_loop", label: "Doom loop", hint: "Continue after repeated tool failures" },
  { key: "webfetch", label: "Web fetch", hint: "Outbound HTTP" },
  { key: "messagesearch", label: "Message search", hint: "Inferred history search" },
  { key: "session-read", label: "Session read", hint: "Exact archive by message ID" },
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

export function DialogPermissions() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const [addPath, setAddPath] = createSignal("")
  const [addMode, setAddMode] = createSignal<"allow" | "deny">("allow")
  const [busy, setBusy] = createSignal(false)
  let pathInput: { focus: () => void; value: string; isDestroyed?: boolean } | undefined

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

  const extMode = createMemo<ExternalDirMode>(() => {
    const mode = (sync.data.config as any)?.external_directory_mode as ExternalDirMode | undefined
    return mode === "deny" || mode === "allow" || mode === "ask" ? mode : "ask"
  })

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

  /** Resolve config.permission[key] to ask|allow|deny (object rules → first * or ask). */
  const toolPolicy = (key: string): PolicyAction => {
    const perm = (sync.data.config as any)?.permission
    if (!perm || typeof perm !== "object") return "ask"
    const rule = perm[key]
    if (rule === "allow" || rule === "deny" || rule === "ask") return rule
    if (rule && typeof rule === "object" && typeof rule["*"] === "string") {
      const a = rule["*"]
      if (a === "allow" || a === "deny" || a === "ask") return a
    }
    return "ask"
  }

  const cycleToolPolicy = (key: string) => {
    const modes: PolicyAction[] = ["ask", "allow", "deny"]
    const next = modes[(modes.indexOf(toolPolicy(key)) + 1) % modes.length]
    const prev = { ...((sync.data.config as any)?.permission ?? {}) }
    prev[key] = next
    void applyConfigPatch(
      { permission: prev },
      `${key}: ${next} (saved to config)`,
    )
  }

  async function applyConfigPatch(patch: Record<string, unknown>, success?: string) {
    if (busy()) return false
    setBusy(true)
    try {
      await sdk.client.config.update(patch as any)
      // Instance dispose reloads config via event; bootstrap refreshes dialog state.
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

  const cycleMode = () => {
    const modes: ExternalDirMode[] = ["ask", "allow", "deny"]
    const next = modes[(modes.indexOf(extMode()) + 1) % modes.length]
    void applyConfigPatch(
      { external_directory_mode: next },
      `External directory access: ${extModeLabel(next)}`,
    )
  }

  const addDirectory = async () => {
    const raw = addPath().trim()
    if (!raw) {
      toast.show({ title: "Permissions", message: "Enter a directory path first", variant: "warning" })
      pathInput?.focus()
      return
    }
    const resolved = path.resolve(EffectiveNavigation.expandPath(raw))
    const action = addMode()
    const nav = { ...((sync.data.config as any).navigation ?? {}) }
    let allow = normalizeNavList(nav.allow)
    let deny = normalizeNavList(nav.deny)

    // Move between lists (same behavior as `opencode dirs allow|deny`)
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

  onMount(() => {
    dialog.setSize("large")
    setTimeout(() => {
      if (!pathInput || pathInput.isDestroyed) return
      pathInput.focus()
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Permissions
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>
        Saved to project/user config. Session "Always this cmd" lasts until restart only.
      </text>

      {/* Tool policies (includes constitution destructive) */}
      <box gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Tool policies
        </text>
        <For each={TOOL_POLICIES}>
          {(p) => {
            const action = () => toolPolicy(p.key)
            return (
              <box flexDirection="row" gap={1} alignItems="center">
                <text
                  fg={busy() ? theme.textMuted : modeColor(action())}
                  attributes={TextAttributes.BOLD}
                  onMouseUp={() => {
                    if (!busy()) cycleToolPolicy(p.key)
                  }}
                >
                  [{modeLabel(action())}]
                </text>
                <text fg={p.danger ? theme.error : theme.text}>{p.label}</text>
                <text fg={theme.textMuted}>{p.hint}</text>
              </box>
            )
          }}
        </For>
        <text fg={theme.textMuted}>{busy() ? "saving..." : "click [mode] to cycle ask → allow → deny"}</text>
      </box>

      {/* External Directory Mode */}
      <box gap={0}>
        <text fg={theme.textMuted}>External Directory Access</text>
        <box flexDirection="row" gap={1} paddingTop={0}>
          <text
            fg={busy() ? theme.textMuted : modeColor(extMode())}
            attributes={TextAttributes.BOLD}
            onMouseUp={() => {
              if (!busy()) cycleMode()
            }}
          >
            [{extModeLabel(extMode())}]
          </text>
          <text fg={theme.textMuted}>{busy() ? "saving..." : "click to cycle"}</text>
        </box>
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
          <box flexGrow={1}>
            <input
              value={addPath()}
              onInput={(v) => setAddPath(v)}
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

      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          Close
        </text>
      </box>
    </box>
  )
}
