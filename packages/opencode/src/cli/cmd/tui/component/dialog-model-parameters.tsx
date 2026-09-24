import { createMemo, createSignal } from "solid-js"
import { useLocal, type ModelScope } from "@tui/context/local"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { protocolChoices } from "./protocol-options"
import type { ModelSampling } from "@/session/model-sampling"
import * as Log from "@opencode-ai/core/util/log"

const FIELDS: Array<{ key: keyof ModelSampling; title: string; description: string }> = [
  { key: "temperature", title: "Temperature", description: "Sampling temperature" },
  { key: "repetition_penalty", title: "Repetition penalty", description: "Repetition penalty" },
  { key: "top_p", title: "Top P", description: "Nucleus sampling mass" },
  { key: "presence_penalty", title: "Presence penalty", description: "Penalty for already-used tokens" },
]

// Transport rungs, best first (owner directive 2026-09-24): h1 exists only as
// the last-resort fallback and is not recommended for selection.
// Protocol choices live in ./protocol-options (pure module) so the menu
// contract is unit-tested in isolation (test/tui/protocol-options.test.ts).

export function DialogModelParameters(props: {
  targetAgent: string
  scope: ModelScope
  initial?: ModelSampling
  initialProtocol?: string | null
  onDone?: () => void
}) {
  const local = useLocal()
  const dialog = useDialog()
  const target = createMemo(() => local.model.forAgent(props.targetAgent))
  const sampling = createMemo<ModelSampling | undefined>(() => {
    const model = target()
    return props.initial ?? (model ? local.model.samplingLayerView(model, props.scope) : undefined)
  })
  // Draft protocol; `null` means "not touched in this dialog" — the configured
  // rung then stays as it is.
  const [protocol, setProtocol] = createSignal<string | null>(props.initialProtocol ?? null)
  const configuredProtocol = createMemo(() => (target() as any)?.options?.protocol ?? "auto")
  const shownProtocol = createMemo(() => protocol() ?? configuredProtocol())

  function finish() {
    if (props.onDone) props.onDone()
    else dialog.clear()
  }

  function reopen(next: ModelSampling, nextProtocol: string | null = protocol()) {
    dialog.replace(() => <DialogModelParameters {...props} initial={next} initialProtocol={nextProtocol} />)
  }

  async function edit(key: keyof ModelSampling) {
    const current = sampling()
    if (!current) return
    const value = await DialogPrompt.show(dialog, `${FIELDS.find((field) => field.key === key)?.title ?? key} (${props.scope})`, {
      value: String(current[key]),
      placeholder: String(current[key]),
    })
    if (value === null) {
      reopen(current)
      return
    }
    const next = Number(value.trim())
    if (!Number.isFinite(next)) {
      reopen(current)
      return
    }
    reopen({ ...current, [key]: next })
  }

  function chooseProtocol() {
    const current = sampling()
    if (!current) return
    dialog.replace(() => (
      <DialogSelect
        title={`Protocol — ${target()?.providerID ?? "?"}/${target()?.modelID ?? "?"}`}
        options={protocolChoices(configuredProtocol()).map((item) => ({
          ...item,
          onSelect: () => {
            setProtocol(item.value)
            reopen(current, item.value)
          },
        }))}
        flat={true}
      />
    ))
  }

  function save() {
    const model = target()
    const value = sampling()
    if (!model || !value) return
    void (async () => {
      await local.model.setModelSampling(model, value, props.scope)
      const draft = protocol()
      if (draft !== null) await local.model.setModelProtocol(model.providerID, model.modelID, draft, props.scope)
    })()
      .then(finish)
      .catch((error: unknown) => {
        Log.Default.warn("bug: model parameters save failed", {
          agent: props.targetAgent,
          scope: props.scope,
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const options = createMemo(() => {
    const value = sampling()
    if (!value) return []
    return [
      ...FIELDS.map((field) => ({
        value: field.key,
        title: field.title,
        description: field.description,
        footer: String(value[field.key]),
        onSelect: () => void edit(field.key),
      })),
      {
        value: "protocol",
        title: "Protocol",
        description: "Transport for this model (auto = h3 → h2 → h1)",
        footer: shownProtocol(),
        onSelect: chooseProtocol,
      },
      {
        value: "save",
        title: `Save to ${props.scope}`,
        description: "Persist these values for the selected model",
        category: "Actions",
        onSelect: save,
      },
    ]
  })

  return (
    <DialogSelect
      title={`Model parameters — ${target()?.providerID ?? "?"}/${target()?.modelID ?? "?"} · ${props.scope}`}
      options={options()}
      flat={true}
    />
  )
}
