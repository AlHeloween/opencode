import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

interface PipelineConfig {
  description?: string
  steps: Array<{
    agent: string
    prompt: string
    variant?: string
    context?: {
      from?: number | number[]
      mode?: "full" | "summary" | "fields" | "maxTokens"
      fields?: string[]
      maxTokens?: number
    }
  }>
}

export function DialogPipeline() {
  const sync = useSync()
  const dialog = useDialog()
  const [input, setInput] = createSignal("")

  const pipelines = createMemo(() => {
    const cfg = sync.data.config as { pipelines?: Record<string, PipelineConfig> }
    const pipelines = cfg.pipelines ?? {}
    return Object.entries(pipelines).map(([name, pipeline]) => ({
      value: name,
      title: name,
      description: pipeline.description ?? `${pipeline.steps.length} steps: ${pipeline.steps.map(s => s.agent).join(" → ")}`,
      footer: pipeline.steps.map(s => `${s.agent}${s.variant ? `(${s.variant})` : ""}`).join(" → "),
      onSelect: () => {
        // Show input dialog for pipeline input
        dialog.replace(() => (
          <PipelineInput
            pipelineName={name}
            steps={pipeline.steps}
            onCancel={() => dialog.replace(() => <DialogPipeline />)}
          />
        ))
      },
    }))
  })

  if (pipelines().length === 0) {
    return (
      <DialogSelect
        title="Pipelines"
        options={[{
          value: "none",
          title: "No pipelines configured",
          description: "Add pipelines to opencode.json to use this feature",
          disabled: true,
        }]}
      />
    )
  }

  return (
    <DialogSelect
      title="Select Pipeline"
      options={pipelines()}
      flat={true}
    />
  )
}

function PipelineInput(props: {
  pipelineName: string
  steps: PipelineConfig["steps"]
  onCancel: () => void
}) {
  const dialog = useDialog()
  const [inputValue, setInputValue] = createSignal("")

  return (
    <DialogSelect
      title={`Pipeline: ${props.pipelineName}`}
      options={[{
        value: "execute",
        title: "Execute Pipeline",
        description: `Input: ${inputValue() || "(empty)"}`,
        onSelect: () => {
          // Execute pipeline with input
          // TODO: Call pipeline tool via SDK
          dialog.clear()
        },
      }]}
      onFilter={setInputValue}
      placeholder="Enter pipeline input..."
    />
  )
}
