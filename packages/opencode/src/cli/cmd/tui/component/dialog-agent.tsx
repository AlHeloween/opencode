import { createMemo, createSignal, onMount } from "solid-js"
import { useLocal, type ModelScope } from "@tui/context/local"
import { useKV } from "@tui/context/kv"
import { cycleScope as nextScope, inheritLabel, parentScope, readScope, SCOPE_KV_KEY } from "./config-scope"
import { classifyVariantState, pruneSummary, removable } from "./model-state-prune"
import { DialogConfirm } from "./dialog-confirm"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogModel } from "./dialog-model"
import { DialogVariant } from "./dialog-variant"
import { DialogRouting } from "./dialog-routing"
import { DialogSubagentSettings } from "./dialog-subagent-settings"
import { DialogModelParameters } from "./dialog-model-parameters"

import { getModelStatus } from "@/provider/balance"
import { useToast } from "../ui/toast"
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
  const toast = useToast()
  // Resolution chain (local.forAgent): session override → worktree (model.json)
  // → global (Agent.Info config). Session is the default configuration target
  // (2026-08-30, Alexander: explicit scope choice instead of hidden dual writes).
  // The scope is remembered in KV so /agents reopens where the user left it.
  // app.tsx opens <DialogAgent /> bare, so a hardcoded default reset the choice
  // on every open (2026-09-16, Alexander: "постоянно приходится выбирать").
  const kv = useKV()
  const scope = props.scope ?? readScope(kv.get(SCOPE_KV_KEY))

  // Track the HIGHLIGHTED row so scope switches preserve the cursor even on a
  // fresh /agents open (restoreValue is undefined until the user clicks a row).
  // (2026-08-31: cursor jumped to build on ←/→ scope change.)
  const [lastCursor, setLastCursor] = createSignal<string | undefined>()

  // ←/→ cycles the configuration scope directly on the form
  // (2026-08-30, Alexander: arrows must switch global/worktree/session).
  function cycleScope(direction: 1 | -1) {
    const next = nextScope(scope, direction)
    if (next === scope) return
    // /agents is the hub: the choice made here is what every other settings
    // dialog opens with.
    kv.set(SCOPE_KV_KEY, next)
    dialog.replace(() => <DialogAgent scope={next} restoreValue={props.restoreValue ?? lastCursor()} />)
  }

  // ── All visible non-hidden agents ──
  const allAgents = createMemo(() => sync.data.agent.filter((a) => !a.hidden))

  // ── Group by mode ──
  const primaryAgents = createMemo(() => allAgents().filter((a) => a.mode !== "subagent"))
  const subagents = createMemo(() => allAgents().filter((a) => a.mode === "subagent"))

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

  // The form is a TABLE — agent | model | capability — and it needs the width for the
  // columns to be readable: at `medium` (60) the model column was cut mid-word even with
  // 110 columns of terminal available (owner, 2026-09-20: «надо было её просто расширить
  // чтобы колонки выглядели правильно»). Requested here rather than measured from the
  // terminal because `Dialog` already clamps the panel with `maxWidth = terminal − 2`
  // (`ui/dialog.tsx:55`), so on a narrow terminal the dialog narrows instead of clipping —
  // and because `dialog.replace()` resets the size to medium, this runs again on every
  // remount (each sub-dialog returning here goes through replace).
  onMount(() => dialog.setSize("xlarge"))


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
    const last = msgs.findLast((m: any) => m.role === "assistant" && (m as any).tokens?.output > 0)
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
          if (scope === "global") {
            dialog.replace(() => (
              <DialogVariant
                targetAgent={cur.name}
                scope="global"
                pendingModel={{ providerID: item.providerID, modelID: item.modelID }}
                onDone={() => dialog.replace(() => <DialogAgent scope={scope} restoreValue={cur.name} />)}
              />
            ))
            return
          }
          // Without `scope` local.model.set falls into the legacy dual-write
          // branch and saves session AND worktree, contradicting the layer the
          // title says is selected.
          local.model.set(
            { providerID: item.providerID, modelID: item.modelID },
            { recent: true, agent: cur.name, scope },
          )
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
    // Layer-pure, and now honest: the fill materialises a model into EVERY layer, so this
    // lookup finds a real value in every scope and `inheritLabel` remains only as a guard
    // that becomes visible if a layer is somehow unfilled (that is a bug to fix by filling,
    // not a state to display). No resolution happens here — a read is a lookup.
    const view = local.model.layerView(agent.name, scope)
    const layerModel = view.model ?? inheritLabel(scope)

    // Session subagents override (worktree-local) else global Agent.Info
    const sub = local.model.subagentsFor(agent.name)
    const subLabel = sub === undefined ? "" : sub.length === 0 ? " · task: none" : ` · task: ${sub.length}`
    const isActive = local.agent.current()?.name === agent.name

    const color: RGBA = local.agent.color(agent.name)
    const off = isDisabled(agent.name)

    return {
      value: agent.name,
      // The active agent is marked in the TITLE — not in the footer, and never by
      // colour alone. Two measured reasons (Alexander, 2026-09-20: "не вижу в
      // настройках /agents который выбран сейчас"): every row already carries a
      // bullet (the enabled gutter dot), so a "current" bullet distinguished only by
      // COLOUR was invisible; and the old " ← active" suffix sat at the END of the
      // footer, which is the part that yields first when the row is narrow
      // (dialog-select.tsx: flexShrink 1 + overflow hidden).
      title: `${agent.name}${isActive ? " ← active" : ""}`,
      description: agent.description ?? "",
      category,
      disabled: off,
      gutter: <text fg={color}>{off ? "○" : "●"}</text>,
      footer: `${layerModel}${view.variant ? ` · ${view.variant}` : ""}${subLabel}`,
      margin: <text>{off ? "[ ]" : "[✓]"}</text>,
      onSelect: () => {
        dialog.replace(() => (
          <DialogModel
            targetAgent={agent.name}
            scope={scope}
            onDone={() =>
              dialog.replace(() => <DialogAgent scope={scope} restoreValue={props.restoreValue ?? agent.name} />)
            }
          />
        ))
      },
    }
  }

  return (
    <DialogSelect
      // The `(←/→ switch)` hint used to live INSIDE this title, and that was the real defect:
      // at medium width the header has 52 columns and the title budget is 48, so a 50-character
      // title truncated to `…(←/→ swit…` — which then filled the whole row, left `space-between`
      // nothing to distribute, and made `esc` hug it exactly as before the width fix. A keybind
      // hint belongs to the keybind footer, not to the title (2026-09-19).
      title={`Agent Configuration — scope: ${scope}${scope === "global" ? " (save)" : ""}`}
      current={local.agent.current()?.name}
      cursorValue={props.restoreValue}
      options={options()}
      // The bottom hint is USER-FACING, not a copy of the agent's own description. That
      // description is internal prose (for this project, kernel-flavoured) and putting it in
      // the UI is wrong even where it is accurate (Alexander, 2026-09-20: «копипастить кенел
      // в пользовательском интерфейсе - нууу так себе»). What a user of THIS screen needs to
      // know is the state of the row under the cursor and what Enter will do to it.
      hint={(option: any) => {
        if (!option) return undefined
        const bits: string[] = []
        if (option.disabled) bits.push("disabled")
        bits.push(
          option.value === local.agent.current()?.name
            ? "active in this session"
            : "Enter — choose this agent's model",
        )
        bits.push(`edits target the ${scope} layer`)
        return bits.join(" · ")
      }}
      onMove={(opt: any) => setLastCursor(opt?.value)}
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
          title: "Sampling parameters",
          keybind: Keybind.parse("ctrl+g")[0],
          onTrigger: (option: { value: string }) => {
            dialog.replace(() => (
              <DialogModelParameters
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
          title: "Routing",
          keybind: Keybind.parse("ctrl+o")[0],
          onTrigger: (option: any) => {
            const m = local.model.forAgent(option.value)
            if (!m) return
            if (m.providerID !== "openrouter") {
              toast.show({
                title: "Routing is OpenRouter-only",
                message: `${m.providerID}/${m.modelID} — routing keys apply to openrouter models`,
                variant: "info",
                duration: 3000,
              })
              return
            }
            dialog.replace(() => (
              <DialogRouting
                agent={option.value}
                scope={scope}
                onDone={() => dialog.replace(() => <DialogAgent scope={scope} restoreValue={option.value} />)}
              />
            ))
          },
        },
        {
          title: "Switch scope",
          onTrigger: () => {
            dialog.replace(() => (
              <AgentScopeDialog
                current={scope}
                onPick={(next) => {
                  kv.set(SCOPE_KV_KEY, next)
                  dialog.replace(() => <DialogAgent scope={next} restoreValue={props.restoreValue ?? lastCursor()} />)
                }}
              />
            ))
          },
        },
        {
          title: "Edit allow-list",
          // DialogSelect ignores any entry without a keybind, so this action
          // and "Toggle enable" below were unreachable from the dialog.
          keybind: Keybind.parse("ctrl+alt+l")[0],
          onTrigger: (option: any) => {
            dialog.replace(() => <DialogSubagentSettings targetAgent={option.value} />)
          },
        },
        {
          title: "Toggle enable",
          keybind: Keybind.parse("ctrl+alt+t")[0],
          onTrigger: (option: any) => {
            toggleDisabled(option.value)
          },
        },
        {
          // Materialise the parent layer here so it can be edited without
          // touching the parent. The counterpart to "Clear", which releases
          // this layer instead of copying into it.
          title: parentScope(scope) ? `Copy from ${parentScope(scope)}` : "Copy from parent",
          keybind: Keybind.parse("ctrl+alt+i")[0],
          onTrigger: (option: any) => {
            const planned = local.model.layer.copyFromParent(option.value, scope)
            if (!planned.ok) {
              toast.show({ title: "Nothing copied", message: planned.reason, variant: "info", duration: 4000 })
              return
            }
            toast.show({
              title: `Copied ${planned.plan.from} → ${planned.plan.to}`,
              message: `${option.value}: ${planned.plan.model}${planned.plan.variant ? ` · ${planned.plan.variant}` : ""}`,
              variant: "success",
              duration: 4000,
            })
            dialog.replace(() => <DialogAgent scope={scope} restoreValue={option.value} />)
          },
        },
        {
          title: `Clear ${scope} layer`,
          keybind: Keybind.parse("ctrl+alt+k")[0],
          onTrigger: (option: any) => {
            const planned = local.model.layer.clear(option.value, scope)
            if (!planned.ok) {
              toast.show({ title: "Nothing cleared", message: planned.reason, variant: "info", duration: 4000 })
              return
            }
            toast.show({
              title: `${planned.plan.scope} layer cleared`,
              message: `${option.value} now inherits from ${planned.plan.fallsTo}`,
              variant: "success",
              duration: 4000,
            })
            dialog.replace(() => <DialogAgent scope={scope} restoreValue={option.value} />)
          },
        },
        {
          title: "Clean variant state",
          keybind: Keybind.parse("ctrl+alt+p")[0],
          onTrigger: () => {
            const report = classifyVariantState(
              local.model.variant.state(),
              sync.data.provider,
              sync.data.agent.map((item) => item.name),
              // The FULL catalogue, not the connected subset: a provider with
              // no key here is still a legitimate choice, while one absent
              // from the catalogue can never apply again.
              sync.data.provider_next.all.map((item) => item.id),
            )
            const targets = removable(report)
            if (targets.length === 0) {
              toast.show({
                title: "Nothing to clean",
                message:
                  report.unresolved.length > 0
                    ? `${report.unresolved.length} entries belong to providers not configured here — kept`
                    : "no stale variant entries in model.json",
                variant: "info",
                duration: 4000,
              })
              return
            }
            // Offered: inert (model loaded, declares no variants) and dead
            // (provider absent from the catalogue). Never offered: unresolved —
            // the provider exists and is simply unconfigured here.
            dialog.replace(() => (
              <DialogConfirm
                title={`Remove ${targets.length} stale variant entries?`}
                description={`${pruneSummary(report)} — ${targets
                  .slice(0, 4)
                  .map((item) => item.key)
                  .join(", ")}${targets.length > 4 ? ", …" : ""}`}
                confirm="Yes, clean model.json"
                onConfirm={() => {
                  const removed = local.model.variant.prune(targets)
                  toast.show({
                    title: "Variant state cleaned",
                    message: `${removed} entries removed${
                      report.unresolved.length > 0 ? ` · ${report.unresolved.length} unconfigured kept` : ""
                    }`,
                    variant: "success",
                    duration: 4000,
                  })
                  dialog.replace(() => <DialogAgent scope={scope} restoreValue={props.restoreValue} />)
                }}
                onCancel={() => dialog.replace(() => <DialogAgent scope={scope} restoreValue={props.restoreValue} />)}
              />
            ))
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
      description: "applies to all projects — staged changes write only on Save",
      onSelect: () => props.onPick("global"),
    },
  ]
  return <DialogSelect title="Configure scope" current={props.current} options={options} flat={true} />
}
