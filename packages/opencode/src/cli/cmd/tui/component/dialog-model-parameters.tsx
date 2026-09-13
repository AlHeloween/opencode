import { createMemo } from "solid-js"
import { useLocal, type ModelScope } from "@tui/context/local"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import type { ModelSampling } from "@/session/model-sampling"
import * as Log from "@opencode-ai/core/util/log"

const FIELDS: Array<{ key: keyof ModelSampling; title: string; description: string }> = [
  { key: "temperature", title: "Temperature", description: "Sampling temperature" },
  { key: "repetition_penalty", title: "Repetition penalty", description: "Repetition penalty" },
  { key: "top_p", title: "Top P", description: "Nucleus sampling mass" },
  { key: "presence_penalty", title: "Presence penalty", description: "Penalty for already-used tokens" },
]

export function DialogModelParameters(props: {
  targetAgent: string
  scope: ModelScope
  initial?: ModelSampling
  onDone?: () => void
}) {
  const local = useLocal()
  const dialog = useDialog()
  const target = createMemo(() => local.model.forAgent(props.targetAgent))
  const sampling = createMemo<ModelSampling | undefined>(() => {
    const model = target()
    return props.initial ?? (model ? local.model.samplingLayerView(model, props.scope) : undefined)
  })
  function finish() {
    if (props.onDone) props.onDone()
    else dialog.clear()
  }

  function reopen(next: ModelSampling) {
    dialog.replace(() => <DialogModelParameters {...props} initial={next} />)
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

  function save() {
    const model = target()
    const value = sampling()
    if (!model || !value) return
    void local.model
      .setModelSampling(model, value, props.scope)
      .then(finish)
      .catch((error: unknown) => {
        Log.Default.warn("bug: model sampling save failed", {
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
      title={`Model sampling — ${target()?.providerID ?? "?"}/${target()?.modelID ?? "?"} · ${props.scope}`}
      options={options()}
      flat={true}
    />
  )
}
