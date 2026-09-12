import { createMemo, createSignal } from "solid-js"
import { useLocal, type ModelScope } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import * as Log from "@opencode-ai/core/util/log"

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

// GLM (docs.z.ai): 5.3/5.3-flash are FORCED-thinking — "off" exists only for
// 5.2 and 4.x; 5.3/5.2 use reasoning_effort, 4.x uses the thinking toggle.
const glmThinkingVariant = {
  default: {
    title: "Default (Thinking)",
    description: "Thinking enabled · GLM chooses the reasoning budget",
  },
  low: {
    title: "Low",
    description: "Thinking enabled · low reasoning effort",
  },
  high: {
    title: "High",
    description: "Thinking enabled · high reasoning effort",
  },
  max: {
    title: "Max",
    description: "Thinking enabled · maximum reasoning effort",
  },
  off: {
    title: "Off",
    description: "Thinking disabled (GLM-5.2 / 4.x — GLM-5.3 is forced-thinking)",
  },
  on: {
    title: "On",
    description: "Thinking enabled (GLM-4.x toggle)",
  },
}

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
  const model = createMemo(
    () => props.pendingModel ?? (props.targetAgent ? local.model.forAgent(props.targetAgent) : local.model.current()),
  )
  const isDeepSeekV4 = createMemo(() => model()?.modelID.includes("deepseek-v4") === true)
  const isGlm = createMemo(() => model()?.modelID.includes("glm") === true)
  const staged = props.scope === "global" && props.targetAgent !== undefined
  const [selected, setSelected] = createSignal<string | undefined>(
    props.pendingModel ? undefined : local.model.variant.selected(props.targetAgent),
  )

  function finish() {
    if (props.onDone) props.onDone()
    else dialog.clear()
  }

  function apply(value: string | undefined) {
    local.model.variant.set(value, props.targetAgent, props.scope)
    finish()
  }

  function choose(value: string | undefined) {
    if (staged) {
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
    const details = isDeepSeekV4() ? deepseekThinkingVariant : isGlm() ? glmThinkingVariant : undefined
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
        const detail = details?.[variant as keyof typeof deepseekThinkingVariant]
        return {
          value: variant,
          title: detail?.title ?? variant,
          description: detail?.description,
          onSelect: () => choose(variant),
        }
      }),
    ]
    if (!staged) return variants
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
        staged
          ? props.pendingModel
            ? "Configure model variant — then Save"
            : "Configure variant — then Save"
          : isDeepSeekV4()
            ? "Select thinking mode"
            : "Select variant"
      }
      current={staged ? (selected() ?? "default") : local.model.variant.selected(props.targetAgent)}
      flat={true}
    />
  )
}
