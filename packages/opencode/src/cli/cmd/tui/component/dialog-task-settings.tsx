import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogTaskSettings() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()

  const current = createMemo(() => {
    const tm = local.model.taskModel()
    if (tm) return tm
    return undefined
  })

  const parsed = createMemo(() => {
    const m = current()
    if (!m) return { provider: "None", model: "No model configured" }
    const provider = sync.data.provider.find((x) => x.id === m.providerID)
    const info = provider?.models[m.modelID]
    return {
      provider: provider?.name ?? m.providerID,
      model: info?.name ?? m.modelID,
    }
  })

  const options = createMemo(() =>
    local.model.recent().map((item) => {
      const provider = sync.data.provider.find((x) => x.id === item.providerID)
      const model = provider?.models[item.modelID]
      return {
        value: { providerID: item.providerID, modelID: item.modelID },
        title: model?.name ?? item.modelID,
        description: provider?.name ?? item.providerID,
        onSelect: () => {
          local.model.taskSet({
            providerID: item.providerID,
            modelID: item.modelID,
          })
          dialog.clear()
        },
      }
    }),
  )

  return (
    <DialogSelect
      title={`Task Agent — ${parsed().provider} / ${parsed().model}`}
      options={options()}
      current={current()}
      placeholder="Recent models"
      flat={true}
      skipFilter={true}
    />
  )
}
