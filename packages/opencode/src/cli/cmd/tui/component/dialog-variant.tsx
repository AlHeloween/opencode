import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

const deepseekThinkingVariant = {
  default: {
    title: "Default (Thinking)",
    description: "Thinking enabled · DeepSeek chooses the reasoning budget",
  },
  off: {
    title: "Off",
    description: "Thinking disabled",
  },
  low: {
    title: "Low",
    description: "Thinking enabled · low reasoning budget",
  },
  high: {
    title: "High",
    description: "Thinking enabled · high reasoning budget",
  },
  max: {
    title: "Max",
    description: "Thinking enabled · maximum reasoning budget",
  },
}

export function DialogVariant() {
  const local = useLocal()
  const dialog = useDialog()
  const isDeepSeekV4 = createMemo(() => local.model.current()?.modelID.includes("deepseek-v4") === true)

  const options = createMemo(() => {
    const details = isDeepSeekV4() ? deepseekThinkingVariant : undefined
    return [
      {
        value: "default",
        title: details?.default.title ?? "Default",
        description: details?.default.description ?? "Use model defaults",
        onSelect: () => {
          dialog.clear()
          local.model.variant.set(undefined)
        },
      },
      ...local.model.variant.list().map((variant) => {
        const detail = details?.[variant as keyof typeof deepseekThinkingVariant]
        return {
          value: variant,
          title: detail?.title ?? variant,
          description: detail?.description,
          onSelect: () => {
            dialog.clear()
            local.model.variant.set(variant)
          },
        }
      }),
    ]
  })

  return (
    <DialogSelect<string>
      options={options()}
      title={isDeepSeekV4() ? "Select thinking mode" : "Select variant"}
      current={local.model.variant.selected()}
      flat={true}
    />
  )
}
