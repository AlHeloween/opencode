import { createSignal, Show } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Status } from "./dialog-mcp"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Feature toggle dialog (subplan 05 — 2026-09-01, Alexander): rules, skills
 * and tools are managed like /mcps — a DialogSelect list with SPACE toggling —
 * but the state is PERSISTED to the project config (PATCH /config), which
 * /mcps does not do (its connect/disconnect is runtime-only).
 *
 * Semantics (absent key = enabled):
 * - rules:  config.rules[basename] = false disables a .opencode/rules file
 * - skills: name removed from config.skills.disabled re-enables it
 * - tools:  config.tools[id] = false runtime-denies execution (session/tools.ts)
 *
 * Transport note (spec debt, pre-existing): /config, /config/rules and
 * /experimental/tool/ids are bridged Effect routes without describeRoute
 * metadata — a fresh SDK regen DROPS them (the committed gen predates the
 * bridge migration). Raw hey-api core calls here until the spec pipeline
 * documents every bridged route; /skill stays on the typed sdk client.
 */

export type ToggleMode = "rules" | "skills" | "tools"

type Item = { name: string; description?: string; enabled: boolean }

const TITLES: Record<ToggleMode, string> = {
  rules: "Rules (.opencode/rules)",
  skills: "Skills",
  tools: "Tools",
}

export function DialogFeatureToggle(props: { mode: ToggleMode }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [items, setItems] = createSignal<Item[]>([])
  const [loading, setLoading] = createSignal<string | null>(null)
  const [failed, setFailed] = createSignal(false)
  const [initial, setInitial] = createSignal(true)

  // hey-api v2 wraps payloads in { data } (see writeGlobalAgentField precedent).
  const unwrap = (response: unknown): any => (response as any)?.data ?? response

  const core = (): any => (sdk.client as any).client
  const coreGet = async (url: string) => {
    const res = await core().get({ url })
    if (res?.error) throw res.error
    return res
  }
  const corePatch = async (url: string, body: unknown) => {
    const res = await core().patch({ url, body })
    if (res?.error) throw res.error
    return res
  }

  async function loadConfig(): Promise<Record<string, any>> {
    const res = await coreGet("/config")
    return { ...(unwrap(res) ?? {}) } as Record<string, any>
  }

  async function patchConfig(mutate: (cfg: Record<string, any>) => void) {
    const cfg = await loadConfig()
    mutate(cfg)
    // Config.update mergeDeep-merges into the project file (config.ts:1046) —
    // a partial payload never drags global/defaults into the project layer.
    await corePatch("/config", cfg)
  }

  async function load() {
    try {
      if (props.mode === "rules") {
        const res = await coreGet("/config/rules")
        setItems(
          (unwrap(res) ?? []).map((row: { name: string; enabled: boolean }) => ({
            name: row.name,
            enabled: row.enabled,
          })),
        )
      } else if (props.mode === "skills") {
        const [res, cfg] = await Promise.all([
          sdk.client.app.skills({}, { throwOnError: true }),
          loadConfig(),
        ])
        const disabled = new Set<string>(cfg.skills?.disabled ?? [])
        setItems(
          (unwrap(res) ?? []).map((skill: { name: string; description?: string }) => ({
            name: skill.name,
            description: skill.description,
            enabled: !disabled.has(skill.name),
          })),
        )
      } else {
        const [res, cfg] = await Promise.all([coreGet("/experimental/tool/ids"), loadConfig()])
        const tools = cfg.tools ?? {}
        setItems(
          (unwrap(res) ?? [])
            .slice()
            .sort()
            .map((id: string) => ({ name: id, enabled: tools[id] !== false })),
        )
      }
      setFailed(false)
    } catch (error) {
      setFailed(true)
      Log.Default.warn("bug: feature toggle list failed", { mode: props.mode, error: String(error) })
    } finally {
      setInitial(false)
    }
  }

  async function toggle(name: string) {
    if (loading() !== null) return
    setLoading(name)
    try {
      const current = items().find((x) => x.name === name)?.enabled ?? true
      if (props.mode === "rules") {
        await patchConfig((cfg) => {
          cfg.rules = { ...((cfg.rules as Record<string, boolean> | undefined) ?? {}) }
          if (current) cfg.rules[name] = false
          else delete cfg.rules[name]
        })
      } else if (props.mode === "skills") {
        await patchConfig((cfg) => {
          const disabled = new Set<string>(((cfg.skills as any)?.disabled as string[]) ?? [])
          if (current) disabled.add(name)
          else disabled.delete(name)
          cfg.skills = { ...((cfg.skills as Record<string, any>) ?? {}) }
          if (disabled.size > 0) cfg.skills.disabled = [...disabled]
          else delete cfg.skills.disabled
        })
      } else {
        await patchConfig((cfg) => {
          cfg.tools = { ...((cfg.tools as Record<string, boolean> | undefined) ?? {}) }
          if (current) cfg.tools[name] = false
          else delete cfg.tools[name]
        })
      }
      setItems((prev) => prev.map((x) => (x.name === name ? { ...x, enabled: !current } : x)))
    } catch (error) {
      // Full error detail — the wrapper-422 lesson: never stringify to "[object Object]".
      const detail = error instanceof Error ? error.message : JSON.stringify(error)?.slice(0, 300) || String(error)
      Log.Default.warn("bug: feature toggle write failed", { mode: props.mode, name, error: detail })
      setFailed(true)
    } finally {
      setLoading(null)
    }
  }

  const options = () =>
    items().map(
      (item): DialogSelectOption<string> => ({
        value: item.name,
        title: item.name,
        description: item.description,
        footer: <Status enabled={item.enabled} loading={loading() === item.name} />,
        category: undefined,
      }),
    )

  return (
    <Show
      when={!failed() || items().length > 0}
      fallback={
        <box padding={2}>
          <text fg={theme.error}>
            {`Failed to load ${props.mode} — see logs (bug: feature toggle list failed)`}
          </text>
        </box>
      }
    >
      <DialogSelect
        title={`${TITLES[props.mode]} — space toggles, saved to project config`}
        options={options()}
        keybind={[
          {
            title: "toggle",
            onTrigger: (option: DialogSelectOption<string>) => void toggle(option.value),
          },
        ]}
        onSelect={(_option) => {
          // Keep the dialog open — toggling is the interaction (same as /mcps).
        }}
      />
    </Show>
  )
}
