import { createMemo, createSignal, onMount } from "solid-js"
import { activeSessionID, useLocal, type ModelScope } from "@tui/context/local"
import { useKV } from "@tui/context/kv"
import { useRoute } from "@tui/context/route"
import { availableScopes, coerceScope, cycleScope as nextScope, inheritLabel, parentScope, readScope, SCOPE_KV_KEY } from "./config-scope"
import { classifyVariantState, pruneSummary, removable } from "./model-state-prune"
import { agentHintText, agentModelRef, agentRowModelCell, nextVariant, scopedModelCell } from "./agent-model-cell"
import { DialogConfirm } from "./dialog-confirm"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogModel } from "./dialog-model"
import { DialogVariant } from "./dialog-variant"
import { DialogRouting } from "./dialog-routing"
import { DialogSubagentSettings } from "./dialog-subagent-settings"
import { DialogModelParameters } from "./dialog-model-parameters"
import { useToast } from "../ui/toast"
import { Keybind } from "@/util/keybind"
import type { RGBA } from "@opentui/core"

/**
 * Rich agent configuration dialog.
 *
 * Groups agents by type (primary / subagent), shows each agent's model and
 * variant, and exposes the per-agent actions (model, variant, sampling,
 * routing, allow-list) on the highlighted row.
 */
export function DialogAgent(props: { restoreValue?: string; scope?: ModelScope }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const route = useRoute()
  // Resolution chain (local.forAgent): session override → worktree (model.json)
  // → global (Agent.Info config). Session is the default configuration target
  // (2026-08-30, Alexander: explicit scope choice instead of hidden dual writes).
  // The scope is remembered in KV so /agents reopens where the user left it.
  // app.tsx opens <DialogAgent /> bare, so a hardcoded default reset the choice
  // on every open (2026-09-16, Alexander: "постоянно приходится выбирать").
  const kv = useKV()
  // Which layers this form may write to. The session layer needs an open session; without one the
  // pick landed nowhere while the title still said "session" (owner, 2026-09-21: «в session
  // настройках модель больше не выбирается … потому что сессии нету … раз worktree значит она
  // должна быть активной чтобы не было путаницы»). The coerced layer is written back to the
  // shared KV below, so /agents and the settings surfaces name the SAME place.
  const scopes = createMemo(() => availableScopes(Boolean(activeSessionID(route.data, sync.data.session))))
  const stored = readScope(kv.get(SCOPE_KV_KEY))
  const scope = props.scope ?? coerceScope(stored, scopes())

  // Track the HIGHLIGHTED row so scope switches preserve the cursor even on a
  // fresh /agents open (restoreValue is undefined until the user clicks a row).
  // (2026-08-31: cursor jumped to build on ←/→ scope change.)
  const [lastCursor, setLastCursor] = createSignal<string | undefined>()

  // ←/→ cycles the configuration scope directly on the form
  // (2026-08-30, Alexander: arrows must switch global/worktree/session).
  function cycleScope(direction: 1 | -1) {
    const next = nextScope(scope, direction, scopes())
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

  // The form is a TABLE — agent | model | capability — and it needs the width for the
  // columns to be readable: at `medium` (60) the model column was cut mid-word even with
  // 110 columns of terminal available (owner, 2026-09-20: «надо было её просто расширить
  // чтобы колонки выглядели правильно»). Requested here rather than measured from the
  // terminal because `Dialog` already clamps the panel with `maxWidth = terminal − 2`
  // (`ui/dialog.tsx:55`), so on a narrow terminal the dialog narrows instead of clipping —
  // and because `dialog.replace()` resets the size to medium, this runs again on every
  // remount (each sub-dialog returning here goes through replace).
  onMount(() => {
    dialog.setSize("large")
    // Persist the coercion once: the hub records where the user actually landed.
    if (!props.scope && scope !== stored) kv.set(SCOPE_KV_KEY, scope)
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
      const modelRef = { providerID: item.providerID, modelID: item.modelID }
      // The recents rows carry the model's own variant, written without an agent: ctrl+t steps
      // them too (owner, 2026-09-21: «Включая recents»), and a step you cannot see is no step.
      const recentVariant = local.model.variant.selectedForModel(modelRef)
      items.push({
        value: `__recent__${item.providerID}/${item.modelID}`,
        title: modelInfo.name ?? item.modelID,
        description: provider.name,
        category: "Recently Used Models",
        footer: `${isCurrent ? "✓ current" : cur ? `→ ${cur.name}` : ""}${recentVariant ? ` · ${recentVariant}` : ""}` || undefined,
        variantStep: {
          // In recents → step in the row; the picking form is for models the user has not run.
          inline: true,
          model: modelRef,
          list: Object.keys(modelInfo.variants ?? {}),
          current: recentVariant,
        },
        variantLabel: modelInfo.name ?? item.modelID,
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

    return items
  })

  function buildOption(agent: any, category: string) {
    // The row shows the layer the title NAMES — not the effective chain.
    //
    // It used to resolve session → worktree → declared whatever the scope, so at
    // `scope: global (save)` a row could read a value no global layer holds while the title
    // promised a global save. Measured 2026-09-21 on the live dialog: `build_mode` read
    // «Muse Spark 1.3 Free» (a session-only value) while `bin/opencode.jsonc:32-35` declared
    // `huggingface/zai-org/GLM-5.3-Flash-BF16` (owner: «давай починять»).
    //
    // The effective chain is a RUNTIME question and the prompt's status line answers it; a scoped
    // settings form answers «what does the layer I am editing hold». The hint still names the
    // layer, so nothing becomes unlabelled — it now names the SCOPE, which is what the title says.
    const view = local.model.layerView(agent.name, scope)
    const cell = scopedModelCell(scope, view.model, inheritLabel(scope))
    const layerVariant = view.variant

    // Session subagents override (worktree-local) else global Agent.Info
    const sub = local.model.subagentsFor(agent.name)
    const isActive = local.agent.current()?.name === agent.name

    // The cell renders like the MODEL PICKER's row (owner, 2026-09-21: «сам список — чтобы было
    // так»): a resolved reference becomes the model's readable name plus its provider, price,
    // capability glyphs and variant — the raw `provider/modelID` named the model in the one form
    // the reader cannot price or recognise. Anything that is not a reference (the guard label)
    // stays verbatim, with no provider and no invented price.
    const ref = agentModelRef(cell.model)
    const provider = ref ? sync.data.provider.find((p) => p.id === ref.providerID) : undefined
    const row = agentRowModelCell({
      ref: cell.model,
      info: provider && ref ? (provider.models[ref.modelID] as any) : undefined,
      variant: layerVariant ?? undefined,
    })

    // Whether ctrl+t steps this row in place or opens the picking form: the owner's rule is the
    // recents list (a model already run → step it; a model never run → show the form).
    const inRecents = Boolean(
      ref && local.model.recent().some((x) => x.providerID === ref.providerID && x.modelID === ref.modelID),
    )
    const variants = ref && provider ? Object.keys(provider.models[ref.modelID]?.variants ?? {}) : []

    const color: RGBA = local.agent.color(agent.name)

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
      description: row.description,
      category,
      gutter: <text fg={color}>●</text>,
      footer: row.footer || undefined,
      // The hint follows the cursor: the per-agent explanation the row used to carry (and
      // truncate mid-word), plus which layer answered the model and how many task overrides the
      // agent has. Those two no longer fit in the row once it carries the picker's cell, and the
      // origin is the difference between an override this scope owns and an inherited one.
      hint: agentHintText({
        description: agent.description ?? undefined,
        provider: provider?.name,
        origin: cell.origin,
        taskCount: sub === undefined ? undefined : sub.length,
      }),
      variantStep: ref
        ? {
            inline: inRecents,
            agent: agent.name,
            model: ref,
            list: variants,
            current: local.model.variant.selectedForModel(ref, agent.name),
          }
        : undefined,
      variantLabel: row.description,
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
      // The hint follows the cursor and carries the per-agent explanation, which the row can no
      // longer hold: truncated mid-word there it competed with the runtime column for the same
      // characters (owner, 2026-09-21: «детальное объяснение должно быть в hint, а не в списке —
      // идёт наложение»). The earlier round moved the details INTO the rows because the hint then
      // said «Enter — choose this agent's model · edits target the session layer» — a keybind the
      // keybind footer already lists and a scope the title already prints, i.e. nothing.
      hint={(option: any) => option?.hint}
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
            const step = option?.variantStep
            // Order matters: a model with no variants has one choice, so say so instead of opening
            // a dialog whose only row is Default (measured 2026-09-21: ctrl+t on Big Pickle opened
            // exactly that, and a dialog with one row reads as «ноль эмоций»). Only then does the
            // owner's rule apply: a model already in recents steps in the row, a model never run
            // gets the picking form (owner, 2026-09-21: «Форма выбора ризонинга должна появляться
            // только если эта модель не в recents»).
            if (step && step.list.length === 0) {
              toast.show({
                title: "No variants",
                message: `${option?.variantLabel ?? "this model"} declares none — the model itself is the only choice`,
                variant: "info",
                duration: 3000,
              })
              return
            }
            if (step?.inline) {
              const next = nextVariant(step.list, step.current)
              // Written through the row's OWN model reference, never through `forAgent`: that
              // resolver answers with silence when it cannot resolve, which is how a step
              // disappeared while its toast still claimed it happened.
              local.model.variant.setForModel(step.model, next, scope, step.agent)
              // The step must be visible even if the row itself does not repaint: the store write
              // is real either way, and silence is indistinguishable from a dead keybind.
              toast.show({
                title: `Variant: ${next ?? "default"}`,
                message: option?.variantLabel ?? step.agent ?? step.model.modelID,
                variant: "info",
                duration: 2000,
              })
              return
            }
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
          title: "Model parameters",
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
                supported={scopes()}
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
          // DialogSelect ignores a keybind entry that carries no keybind, so
          // this action needs one to be reachable from the dialog at all.
          keybind: Keybind.parse("ctrl+alt+l")[0],
          onTrigger: (option: any) => {
            dialog.replace(() => <DialogSubagentSettings targetAgent={option.value} />)
          },
        },
        {
          // Materialise the parent layer here so it can be edited without
          // touching the parent. This is the ONLY layer operation: a "clear" that
          // released the layer so resolution would fall through was removed 2026-09-20 —
          // a filled world has no gap to fall through, and the read (`forAgent`) is a
          // plain lookup that would simply find nothing.
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
function AgentScopeDialog(props: {
  current: ModelScope
  /** Layers this form can write: the session layer disappears when no session is open. */
  supported: readonly ModelScope[]
  onPick: (scope: ModelScope) => void
}) {
  const all = [
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
  return (
    <DialogSelect
      title="Configure scope"
      current={props.current}
      options={all.filter((option) => props.supported.includes(option.value))}
      flat={true}
    />
  )
}
