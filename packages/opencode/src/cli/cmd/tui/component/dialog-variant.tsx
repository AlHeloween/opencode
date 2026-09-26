import { createMemo, createSignal } from "solid-js"
import { useLocal, type ModelScope } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import * as Log from "@opencode-ai/core/util/log"
import { variantDetail, variantDialogTitle, variantFamily, variantLabels } from "./variant-dialog-state"
import { useKV } from "@tui/context/kv"
import { availableScopes, coerceScope, readScope, SCOPE_KV_KEY } from "./config-scope"

export function DialogVariant(props: {
  targetAgent?: string
  scope?: ModelScope
  onDone?: () => void
  /** GLOBAL /agents model selection is staged here so model + variant are one write. */
  pendingModel?: { providerID: string; modelID: string }
}) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const route = useRoute()
  const model = createMemo(
    () => props.pendingModel ?? (props.targetAgent ? local.model.forAgent(props.targetAgent) : local.model.current()),
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
  const staged = createMemo(() => scope() === "global" && props.targetAgent !== undefined)
  const [selected, setSelected] = createSignal<string | undefined>(
    props.pendingModel ? undefined : local.model.variant.selected(props.targetAgent),
  )

  function finish() {
    if (props.onDone) props.onDone()
    else dialog.clear()
  }

  function apply(value: string | undefined) {
    local.model.variant.set(value, props.targetAgent, scope())
    finish()
  }

  function choose(value: string | undefined) {
    if (staged()) {
      setSelected(value)
      return
    }
    apply(value)
  }

  function save() {
    if (!props.targetAgent) return
    const write = props.pendingModel
      ? local.model.setGlobalAgentSelection(props.targetAgent, props.pendingModel, selected())
      : local.model.writeGlobalAgentField(props.targetAgent, { variant: selected() ?? null })
    void write.then(finish).catch((error: unknown) => {
      Log.Default.warn("bug: staged global agent save failed", {
        agent: props.targetAgent,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const options = createMemo(() => {
    const details = variantLabels(family())
    // targetAgent: from the /agents dialog the dialog must reflect the HIGHLIGHTED
    // agent's own model (real settings), not the active agent's model.
    const target = model()
    const provider = target ? sync.data.provider.find((item) => item.id === target.providerID) : undefined
    const list = target ? Object.keys(provider?.models[target.modelID]?.variants ?? {}) : []
    const variants = [
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
    if (!staged()) return variants
    return [
      ...variants,
      {
        value: "__save__",
        title: props.pendingModel ? "Save model and variant" : "Save variant",
        description: `Write once to GLOBAL config for agent ${props.targetAgent}`,
        category: "Actions",
        onSelect: save,
      },
      {
        value: "__cancel__",
        title: "Cancel",
        category: "Actions",
        onSelect: finish,
      },
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={
        staged()
          ? props.pendingModel
            ? "Configure model variant — then Save"
            : "Configure variant — then Save"
          : variantDialogTitle(family())
      }
      current={staged() ? (selected() ?? "default") : local.model.variant.selected(props.targetAgent)}
      flat={true}
    />
  )
}
