import { createMemo, createSignal, onMount } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogModel } from "./dialog-model"
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
export function DialogAgent() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()

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

    const color: RGBA = local.agent.color(agent.name)
    const off = isDisabled(agent.name)

    return {
      value: agent.name,
      title: agent.name,
      description: agent.description ?? "",
      category,
      disabled: off,
      gutter: <text fg={color}>{off ? "○" : "●"}</text>,
      footer: `${modelLabel}${variantLabel}`,
      margin: <text>{off ? "[ ]" : "[✓]"}</text>,
      onSelect: () => {
        dialog.replace(() => (
          <DialogModel
            targetAgent={agent.name}
            onDone={() => dialog.replace(() => <DialogAgent />)}
          />
        ))
      },
    }
  }

  return (
    <DialogSelect
      title="Agent Configuration"
      options={options()}
      keybind={[
        {
          title: "Change model",
          onTrigger: (option: any) => {
            dialog.replace(() => (
              <DialogModel
                targetAgent={option.value}
                onDone={() => dialog.replace(() => <DialogAgent />)}
              />
            ))
          },
        },
        {
          title: "Cycle variant",
          keybind: Keybind.parse("ctrl+t")[0],
          onTrigger: (option: any) => {
            local.model.variant.cycle(option.value)
            // Force re-render by replacing dialog
            dialog.replace(() => <DialogAgent />)
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
