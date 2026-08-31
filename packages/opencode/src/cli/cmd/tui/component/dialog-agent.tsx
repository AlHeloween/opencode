import { createMemo, createSignal, onMount } from "solid-js"
import { useLocal, type ModelScope } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogModel } from "./dialog-model"
import { DialogVariant } from "./dialog-variant"
import { DialogSubagentSettings } from "./dialog-subagent-settings"
import { getModelStatus } from "@/provider/balance"
import { Keybind } from "@/util/keybind"
import type { RGBA } from "@opentui/core"

/**
 * Rich agent configuration dialog.
 *
 * Groups agents by type (primary / subagent), shows per-agent model,
 * provides model selection and enable/disable toggle, with balance
 * and cache hit stats summary in the footer.
 */
export function DialogAgent(props: { restoreValue?: string; scope?: ModelScope }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  // Resolution chain (local.forAgent): session override → worktree (model.json)
  // → global (Agent.Info config). Session is the default configuration target
  // (2026-08-30, Alexander: explicit scope choice instead of hidden dual writes).
  const scope = props.scope ?? "session"

  // ←/→ cycles the configuration scope directly on the form
  // (2026-08-30, Alexander: arrows must switch global/worktree/session).
  const SCOPE_ORDER: ModelScope[] = ["global", "worktree", "session"]
  function cycleScope(direction: 1 | -1) {
    const index = SCOPE_ORDER.indexOf(scope)
    const next = SCOPE_ORDER[(index + direction + SCOPE_ORDER.length) % SCOPE_ORDER.length]
    if (!next || next === scope) return
    dialog.replace(() => <DialogAgent scope={next} restoreValue={props.restoreValue} />)
  }

  // ── All visible non-hidden agents ──
  const allAgents = createMemo(() =>
    sync.data.agent.filter((a) => !a.hidden),
  )

  // ── Group by mode ──
  const primaryAgents = createMemo(() =>
    allAgents().filter((a) => a.mode !== "subagent"),
  )
  const subagents = createMemo(() =>
    allAgents().filter((a) => a.mode === "subagent"),
  )

  // ── Local enable/disable toggles (v1: runtime only, v2: config write) ──
  const [disabled, setDisabled] = createSignal<Set<string>>(new Set())

  function isDisabled(name: string) {
    return disabled().has(name)
  }

  function toggleDisabled(name: string) {
    setDisabled((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // ── Balance per provider ──
  const [balances, setBalances] = createSignal<Record<string, string>>({})

  onMount(() => {
    const providers = new Set<string>()
    for (const agent of allAgents()) {
      const m = local.model.forAgent(agent.name)
      if (m) providers.add(m.providerID)
    }
    for (const pid of providers) {
      getModelStatus(pid)
        .then((status) => {
          if (status.type === "balance" && (status as any).totalBalance) {
            setBalances((prev) => ({
              ...prev,
              [pid]: `${(status as any).currency ?? "$"}${(status as any).totalBalance}`,
            }))
          }
        })
        .catch((e) => console.debug("agent balance fetch failed", e))
    }
  })

  // ── Cache stats from last assistant in last session ──
  const cacheStats = createMemo(() => {
    const sessions = sync.data.session
    if (!sessions?.length) return ""
    const lastSession = sessions[sessions.length - 1]
    const msgs = sync.data.message[lastSession.id]
    if (!msgs?.length) return ""
    const last = msgs.findLast(
      (m: any) => m.role === "assistant" && (m as any).tokens?.output > 0,
    )
    if (!last) return ""
    const t = (last as any).tokens
    const cacheRead = t.cache?.read ?? 0
    const totalIn = t.input ?? 0
    if (totalIn + cacheRead <= 0) return ""
    const rate = Math.round((cacheRead / (totalIn + cacheRead)) * 100)
    return `Cache: ${rate}% hit`
  })

  // ── Balance summary line ──
  const balanceLine = createMemo(() => {
    const b = balances()
    const keys = Object.keys(b)
    if (!keys.length) return ""
    return keys.map((k) => `${k}: ${b[k]}`).join("  ")
  })

  // ── Status footer ──
  const statusLine = createMemo(() => {
    const parts = [cacheStats(), balanceLine()].filter(Boolean)
    return parts.join("  │  ")
  })

  // ── Build options grouped by category ──
  const options = createMemo(() => {
    const items: any[] = []

    for (const agent of primaryAgents()) {
      items.push(buildOption(agent, "Primary Agents"))
    }
    for (const agent of subagents()) {
      items.push(buildOption(agent, "Subagents"))
    }

    // ── Recently used models (quick-assign to current agent) ──
    const cur = local.agent.current()
    const recents = local.model.recent()
    for (const item of recents) {
      const provider = sync.data.provider.find((x) => x.id === item.providerID)
      if (!provider) continue
      const modelInfo = provider.models[item.modelID]
      if (!modelInfo) continue
      const isCurrent = cur && cur.model?.providerID === item.providerID && cur.model?.modelID === item.modelID
      items.push({
        value: `__recent__${item.providerID}/${item.modelID}`,
        title: modelInfo.name ?? item.modelID,
        description: provider.name,
        category: "Recently Used Models",
        footer: isCurrent ? "✓ current" : cur ? `→ ${cur.name}` : undefined,
        onSelect: () => {
          if (!cur) return
          local.model.set({ providerID: item.providerID, modelID: item.modelID }, { recent: true, agent: cur.name })
          dialog.clear()
        },
      })
    }

    // Status footer
    const status = statusLine()
    if (status) {
      items.push({
        value: "__status__",
        title: status,
        category: "Status",
        disabled: true,
      })
    }

    return items
  })

  function buildOption(agent: any, category: string) {
    const model = local.model.forAgent(agent.name)
    const modelLabel = model
      ? `${model.providerID}/${model.modelID}`
      : "(no model configured)"

    const agentVariant = local.model.variant.forAgent(agent.name)
    const variantValue = agentVariant.current()
    const variantLabel = variantValue ? ` · ${variantValue}` : ""

    // Session subagents override (worktree-local) else global Agent.Info
    const sub = local.model.subagentsFor(agent.name)
    const subLabel =
      sub === undefined
        ? ""
        : sub.length === 0
          ? " · task: none"
          : ` · task: ${sub.length}`

    const isActive = local.agent.current()?.name === agent.name
    const activeLabel = isActive ? " ← active" : ""

    const color: RGBA = local.agent.color(agent.name)
    const off = isDisabled(agent.name)

    return {
      value: agent.name,
      title: agent.name,
      description: agent.description ?? "",
      category,
      disabled: off,
      gutter: <text fg={color}>{off ? "○" : "●"}</text>,
      footer: `${modelLabel}${variantLabel}${subLabel}${activeLabel}`,
      margin: <text>{off ? "[ ]" : "[✓]"}</text>,
      onSelect: () => {
        dialog.replace(() => (
          <DialogModel
            targetAgent={agent.name}
            scope={scope}
            onDone={() => dialog.replace(() => <DialogAgent scope={scope} restoreValue={props.restoreValue ?? agent.name} />)}
          />
        ))
      },
    }
  }

  return (
    <DialogSelect
      title={`Agent Configuration — scope: ${scope}${scope === "global" ? " (confirm on write)" : ""}  (←/→ switch)`}
      current={local.agent.current()?.name}
      cursorValue={props.restoreValue}
      options={options()}
      keybind={[
        {
          title: "Change model",
          onTrigger: (option: any) => {
            dialog.replace(() => (
              <DialogModel
                targetAgent={option.value}
                scope={scope}
                onDone={() => dialog.replace(() => <DialogAgent scope={scope} restoreValue={option.value} />)}
              />
            ))
          },
        },
        {
          title: "Variant",
          keybind: Keybind.parse("ctrl+t")[0],
          onTrigger: (option: any) => {
            // Open the variant dialog for the HIGHLIGHTED agent's own model —
            // real settings, not a silent cycle (2026-08-30, Alexander).
            dialog.replace(() => (
              <DialogVariant
                targetAgent={option.value}
                scope={scope}
                onDone={() => dialog.replace(() => <DialogAgent scope={scope} restoreValue={option.value} />)}
              />
            ))
          },
        },
        {
          title: "Scope ←",
          keybind: Keybind.parse("left")[0],
          onTrigger: () => cycleScope(-1),
        },
        {
          title: "Scope →",
          keybind: Keybind.parse("right")[0],
          onTrigger: () => cycleScope(1),
        },
        {
          title: "Switch scope",
          onTrigger: () => {
            dialog.replace(() => (
              <AgentScopeDialog
                current={scope}
                onPick={(next) => dialog.replace(() => <DialogAgent scope={next} restoreValue={props.restoreValue} />)}
              />
            ))
          },
        },
        {
          title: "Edit allow-list",
          onTrigger: (option: any) => {
            dialog.replace(() => <DialogSubagentSettings targetAgent={option.value} />)
          },
        },
        {
          title: "Toggle enable",
          onTrigger: (option: any) => {
            toggleDisabled(option.value)
          },
        },
      ]}
    />
  )
}

/** Which settings layer /agents configures — session is the default target. */
function AgentScopeDialog(props: { current: ModelScope; onPick: (scope: ModelScope) => void }) {
  const options = [
    {
      value: "session" as const,
      title: "Session",
      description: "this conversation only (sessions/{sessionID}.jsonc)",
      onSelect: () => props.onPick("session"),
    },
    {
      value: "worktree" as const,
      title: "Worktree",
      description: "all sessions in this project (model.json)",
      onSelect: () => props.onPick("worktree"),
    },
    {
      value: "global" as const,
      title: "Global",
      description: "applies to all projects — confirmation dialog on write",
      onSelect: () => props.onPick("global"),
    },
  ]
  return <DialogSelect title="Configure scope" current={props.current} options={options} flat={true} />
}
