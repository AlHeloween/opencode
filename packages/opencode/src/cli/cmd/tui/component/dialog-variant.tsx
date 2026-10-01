import { createMemo } from "solid-js"
import { useLocal, type ModelScope } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { variantDetail, variantDialogTitle, variantFamily, variantLabels } from "./variant-dialog-state"
import { useKV } from "@tui/context/kv"
import { availableScopes, coerceScope, readScope, SCOPE_KV_KEY } from "./config-scope"
import { globalStage } from "./global-agent-stage"

export function DialogVariant(props: {
  targetAgent?: string
  scope?: ModelScope
  onDone?: () => void
  /** GLOBAL /agents model pick: staged together with the variant chosen here. */
  pendingModel?: { providerID: string; modelID: string }
}) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const route = useRoute()
  // A model staged earlier in /agents (global) is the one whose variants this dialog lists.
  const model = createMemo(
    () =>
      props.pendingModel ??
      (props.targetAgent
        ? (globalStage.get(props.targetAgent)?.model ?? local.model.forAgent(props.targetAgent))
        : local.model.current()),
  )
  // The family comes from the shared engine predicate on `api.id` (see
  // variant-dialog-state.ts); `modelID` is the catalog name and spelled differently.
  const family = createMemo(() =>
    variantFamily(sync.data.provider.find((item) => item.id === model()?.providerID)?.models[model()?.modelID ?? ""]),
  )
  // app.tsx opens <DialogVariant /> bare; without a scope variant.set falls
  // into the legacy dual write (session + worktree) instead of the layer the
  // user selected.
  const kv = useKV()
  // Coerced, not raw — same rule as dialog-model.tsx and dialog-agent.tsx:46-48. A bare open
  // (app.tsx) must not fall into a layer that cannot hold the value.
  // The session layer needs an OPEN session — `home` is not one (owner, 2026-09-26: the newest
  // neighbour session must not surface here as editable).
  const scopes = createMemo(() => availableScopes(route.data.type === "session"))
  const scope = createMemo(() => props.scope ?? coerceScope(readScope(kv.get(SCOPE_KV_KEY)), scopes()))
  // GLOBAL from /agents: the pick is STAGED and written by the form's «Save settings» item — no
  // per-pick save question (owner, 2026-10-02).
  const staged = createMemo(() => scope() === "global" && props.targetAgent !== undefined)
  const stagedEdit = () => (props.targetAgent ? globalStage.get(props.targetAgent) : undefined)

  function finish() {
    if (props.onDone) props.onDone()
    else dialog.clear()
  }

  function choose(value: string | undefined) {
    if (staged() && props.targetAgent) globalStage.stage(props.targetAgent, { model: props.pendingModel, variant: value })
    else local.model.variant.set(value, props.targetAgent, scope())
    finish()
  }

  function current() {
    if (!staged()) return local.model.variant.selected(props.targetAgent)
    if (props.pendingModel) return "default"
    const edit = stagedEdit()
    return (edit ? edit.variant : local.model.variant.selected(props.targetAgent)) ?? "default"
  }

  const options = createMemo(() => {
    const details = variantLabels(family())
    // targetAgent: from the /agents dialog the dialog must reflect the HIGHLIGHTED
    // agent's own model (real settings), not the active agent's model.
    const target = model()
    const provider = target ? sync.data.provider.find((item) => item.id === target.providerID) : undefined
    const list = target ? Object.keys(provider?.models[target.modelID]?.variants ?? {}) : []
    return [
      {
        value: "default",
        title: details?.default.title ?? "Default",
        description: details?.default.description ?? "Use model defaults",
        onSelect: () => choose(undefined),
      },
      ...list.map((variant) => {
        const detail = variantDetail(family(), variant)
        return {
          value: variant,
          title: detail?.title ?? variant,
          description: detail?.description,
          onSelect: () => choose(variant),
        }
      }),
    ]
  })

  return <DialogSelect<string> options={options()} title={variantDialogTitle(family())} current={current()} flat={true} />

}
