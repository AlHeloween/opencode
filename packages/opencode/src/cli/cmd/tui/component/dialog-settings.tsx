import { createSignal, For, Show } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogConfirm } from "./dialog-confirm"
import { useTheme } from "../context/theme"
import { envValue, SETTINGS_REGISTRY, type SettingRow } from "../settings/registry"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Unified /settings dialog (subplan 03). Every row of the settings registry
 * (generated from the Config.Info schema + session/model-state keys + env
 * inventory) is reachable and viewable; rows that are safe to edit in-place
 * (boolean/enum/string/number/model) get edit widgets. Policy (Alexander):
 * a missing setting is a bug — enforced by test/tui/settings-registry.test.ts.
 *
 * Interaction contract: full keyboard navigation via DialogSelect (↑/↓, filter,
 * enter); mouse via the shared DialogSelect onMouseUp rows; the scope row at
 * the top is clickable AND enter-activatable — ←/→-free by design so mouse and
 * keyboard share one affordance.
 *
 * Writes reuse existing plumbing only:
 *   worktree → PATCH /config minimal subtree (RFC 7386; subplan 05 rev 2)
 *   global   → GET global config → set field → PATCH /global/config with
 *              DialogConfirm first (subplan 01 policy)
 *   session/model-state rows are read-only pointers to /agents and /model.
 */

type Scope = "worktree" | "global"

const SCOPE_LABEL: Record<Scope, string> = {
  worktree: "project (this worktree)",
  global: "GLOBAL (all projects)",
}

export function DialogSettings() {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [scope, setScope] = createSignal<Scope>("worktree")
  const [merged, setMerged] = createSignal<Record<string, any> | undefined>(undefined)
  const [global, setGlobal] = createSignal<Record<string, any> | undefined>(undefined)
  const [status, setStatus] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  // hey-api v2 wraps payloads in { data } (writeGlobalAgentField precedent).
  const unwrap = (response: unknown): any => (response as any)?.data ?? response
  const core = (): any => (sdk.client as any).client
  const corePatch = async (url: string, body: unknown) => {
    const res = await core().patch({ url, body })
    if (res?.error) throw res.error
    return res
  }

  void Promise.all([
    core()
      .get({ url: "/config" })
      .then((res: any) => {
        if (res?.error) throw res.error
        setMerged(unwrap(res) ?? {})
      }),
    (async () => {
      try {
        const res = await sdk.client.global.config.get()
        if ((res as any)?.error) throw (res as any).error
        setGlobal(unwrap(res) ?? {})
      } catch (error) {
        Log.Default.debug("global config read unavailable in settings dialog", { error: String(error) })
      }
    })(),
  ]).catch((error) => {
    Log.Default.warn("bug: settings dialog load failed", { error: String(error) })
    setStatus("failed to load config values — see logs")
  })

  function scopeValue(row: SettingRow): unknown {
    if (row.source === "env") return envValue(row.schemaKey!)
    if (row.source === "config") {
      const source = scope() === "global" ? global() : merged()
      return source?.[row.schemaKey!]
    }
    return undefined
  }

  function preview(row: SettingRow): string {
    const value = scopeValue(row)
    if (value === undefined) return "(unset)"
    if (typeof value === "boolean") return value ? "true" : "false"
    const text = typeof value === "string" ? value : JSON.stringify(value)
    return text.length > 42 ? `${text.slice(0, 42)}…` : text
  }

  async function refresh() {
    try {
      const res = await core().get({ url: "/config" })
      if (!res?.error) setMerged(unwrap(res) ?? {})
      if (scope() === "global") {
        const resGlobal = await sdk.client.global.config.get()
        if ((resGlobal as any)?.error) throw (resGlobal as any).error
        setGlobal(unwrap(resGlobal) ?? {})
      }
    } catch (error) {
      Log.Default.warn("bug: settings dialog refresh failed", { error: String(error) })
    }
  }

  function backToSettings() {
    dialog.replace(() => <DialogSettings />)
  }

  async function writeWorktree(row: SettingRow, value: unknown) {
    await corePatch("/config", { [row.schemaKey!]: value })
    setStatus(`${row.schemaKey} saved → ${SCOPE_LABEL[scope()]}`)
    await refresh()
    backToSettings()
  }

  async function writeGlobal(row: SettingRow, value: unknown) {
    // Policy (subplan 01): every global write requires an explicit confirm.
    const current = (global() ?? {}) as Record<string, unknown>
    const next = { ...current, [row.schemaKey!]: value }
    dialog.replace(() => (
      <DialogConfirm
        title={`Write ${row.schemaKey} to GLOBAL config?`}
        description={`Applies to all projects. ${row.title} = ${typeof value === "string" ? value : JSON.stringify(value)}`}
        onConfirm={() => {
          void (async () => {
            try {
              setBusy(true)
              await sdk.client.global.config.update({ config: next as any }, { throwOnError: true })
              setStatus(`${row.schemaKey} saved → ${SCOPE_LABEL.global}`)
              await refresh()
            } catch (error) {
              const detail = error instanceof Error ? error.message : JSON.stringify(error)?.slice(0, 300) || String(error)
              Log.Default.warn("bug: settings global write failed", { id: row.id, error: detail })
              setStatus("global write failed — see logs")
            } finally {
              setBusy(false)
              backToSettings()
            }
          })()
        }}
        onCancel={backToSettings}
      />
    ))
  }

  function write(row: SettingRow, value: unknown) {
    void (async () => {
      if (busy()) return
      setBusy(true)
      try {
        if (scope() === "global") await writeGlobal(row, value)
        else await writeWorktree(row, value)
      } catch (error) {
        const detail = error instanceof Error ? error.message : JSON.stringify(error)?.slice(0, 300) || String(error)
        Log.Default.warn("bug: settings write failed", { id: row.id, scope: scope(), error: detail })
        setStatus("write failed — see logs")
        setBusy(false)
      }
    })()
  }

  function editRow(row: SettingRow) {
    if (row.readOnly) return
    if (row.kind === "boolean") {
      write(row, !(scopeValue(row) === true))
      return
    }
    if (row.kind === "enum" && row.enumValues?.length) {
      dialog.replace(() => (
        <DialogSelect
          title={`${row.title} — select value (${scope()})`}
          options={row.enumValues!.map(
            (value): DialogSelectOption<string> => ({ title: value, value }),
          )}
          onSelect={(option) => write(row, option.value)}
        />
      ))
      return
    }
    if (row.kind === "string" || row.kind === "number" || row.kind === "model") {
      const current = scopeValue(row)
      void DialogPrompt.show(dialog, `${row.title} (${scope()})`, {
        placeholder: typeof current === "string" ? current : "(unset)",
        onConfirm: (value: string) => {
          const trimmed = value.trim()
          if (trimmed.length === 0) return
          write(row, row.kind === "number" ? Number(trimmed) : trimmed)
        },
      })
      return
    }
    // json rows are read-only by registry contract
  }

  const options = (): DialogSelectOption<string>[] => {
    const scopeRow: DialogSelectOption<string> = {
      title: `Scope: ${scope()} — enter/click to switch`,
      value: "__scope",
      description: "Writes target the selected layer; global writes always confirm first",
      onSelect: () => {
        setScope(scope() === "worktree" ? "global" : "worktree")
        backToSettings()
      },
    }
    const rows: DialogSelectOption<string>[] = SETTINGS_REGISTRY.map((row) => ({
      title: row.title,
      value: row.id,
      category: row.group,
      description: row.readOnly
        ? `${row.description ?? ""}${row.source === "env" ? " (read-only)" : ""}`.trim()
        : row.description,
      footer: row.readOnly ? preview(row) : `${preview(row)} · enter to edit`,
      onSelect: () => editRow(row),
    }))
    const byId = new Map<string, DialogSelectOption<string>>(rows.map((option) => [option.value, option]))
    const ordered: DialogSelectOption<string>[] = [scopeRow]
    for (const option of rows) {
      if (option.value !== "__scope") ordered.push(option)
    }
    void byId
    return ordered
  }

  return (
    <DialogSelect
      title={`Settings — ${SETTINGS_REGISTRY.length} registered surfaces${status() ? ` · ${status()}` : ""}`}
      options={options()}
      skipFilter={false}
      onSelect={(option) => {
        const row = SETTINGS_REGISTRY.find((x) => x.id === option.value)
        if (row) editRow(row)
      }}
      keybind={[
        {
          title: "edit",
          onTrigger: (option: DialogSelectOption<string>) => {
            if (option.value === "__scope") {
              setScope(scope() === "worktree" ? "global" : "worktree")
              backToSettings()
              return
            }
            const row = SETTINGS_REGISTRY.find((x) => x.id === option.value)
            if (row) editRow(row)
          },
        },
      ]}
    />
  )
}

// Keep For imported for potential grouped rendering extensions (tree-shaken otherwise).
void For
void Show
