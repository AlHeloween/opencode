# Orchestrator Chain Extension — Detailed Implementation Plan
> sv=[[pipeline, orchestrator, chain, variant, context-passing, checkpoint, configurable],[0.22,0.18,0.15,0.15,0.12,0.10,0.08]]
> abstract="Extend existing pipeline.ts with variant support, configurable context passing, and named pipeline configs from opencode.json."

## Current State

**Existing `pipeline.ts`** (191 lines):
- ✅ Sequential agent execution
- ✅ Context passing (output → next prompt)
- ✅ Isolated sessions per step
- ✅ Checkpoint isolation
- ❌ No variant support per step
- ❌ No configurable context modes (only full output)
- ❌ No named pipeline configs from `opencode.json`

## Target State

1. **Variant support**: Each step can specify variant (reasoning effort)
2. **Configurable context**: full/summary/fields/maxTokens modes
3. **Named pipelines**: Config in `opencode.json`, invoked by name
4. **TUI integration**: `/pipeline` command to select and run pipelines

## Implementation

### Phase 1: Extend Pipeline Schema with Variant + Context Modes

**File:** `packages/opencode/src/tool/pipeline.ts`

Add variant and context config to step schema:

```ts
const ContextModeSchema = Schema.Union([
  Schema.Literal("full"),
  Schema.Literal("summary"),
  Schema.Literal("fields"),
  Schema.Literal("maxTokens"),
])

const ContextConfigSchema = Schema.Struct({
  from: Schema.optional(Schema.Union([Schema.Number, Schema.Array(Schema.Number)])),
  mode: Schema.optional(ContextModeSchema),
  fields: Schema.optional(Schema.Array(Schema.String)),
  maxTokens: Schema.optional(Schema.Number),
})

const StepSchema = Schema.Struct({
  agent: Schema.String,
  description: Schema.String,
  prompt: Schema.String,
  variant: Schema.optional(Schema.String),
  context: Schema.optional(ContextConfigSchema),
})
```

### Phase 2: Implement Context Preparation Function

**File:** `packages/opencode/src/tool/pipeline.ts`

```ts
function prepareContext(
  contextConfig: ContextConfig | undefined,
  stepIndex: number,
  allResults: PipelineStepResult[],
  originalPrompt: string,
): string {
  // First step always gets original prompt
  if (stepIndex === 0) return originalPrompt
  
  // No context config → use default (previous step output)
  if (!contextConfig) {
    const prev = allResults[stepIndex - 1]
    return `${originalPrompt}\n\n## Context from previous step:\n${prev.output}`
  }
  
  // Determine source results
  const sourceIndexes = contextConfig.from === undefined
    ? [stepIndex - 1]
    : Array.isArray(contextConfig.from) ? contextConfig.from : [contextConfig.from]
  
  const sourceResults = sourceIndexes
    .filter(i => i >= 0 && i < allResults.length)
    .map(i => allResults[i])
  
  if (sourceResults.length === 0) {
    return `${originalPrompt}\n\n## Context from previous step:\n(No previous results available)`
  }
  
  // Apply context mode
  switch (contextConfig.mode) {
    case "summary":
      return `${originalPrompt}\n\n## Summary of previous steps:\n${summarizeContext(sourceResults, contextConfig.maxTokens)}`
    
    case "fields":
      return `${originalPrompt}\n\n## Extracted fields:\n${extractFields(sourceResults, contextConfig.fields ?? [])}`
    
    case "maxTokens":
      return `${originalPrompt}\n\n## Context from previous steps (truncated):\n${truncateContext(sourceResults, contextConfig.maxTokens ?? 4000)}`
    
    case "full":
    default:
      return `${originalPrompt}\n\n## Context from previous steps:\n${sourceResults.map(r => `### ${r.agent} — ${r.description}\n${r.output}`).join("\n\n")}`
  }
}
```

### Phase 3: Add Helper Functions

**File:** `packages/opencode/src/tool/pipeline.ts`

```ts
function summarizeContext(results: PipelineStepResult[], maxTokens?: number): string {
  // Simple heuristic: take first 500 chars of each result
  // In production, could use LLM to generate summary
  const combined = results.map(r => `${r.agent}: ${r.output.slice(0, 500)}`).join("\n\n")
  return maxTokens ? combined.slice(0, maxTokens * 4) : combined  // ~4 chars per token
}

function extractFields(results: PipelineStepResult[], fields: string[]): string {
  // Extract lines containing field names
  return results.flatMap(r => 
    r.output.split("\n").filter(line => 
      fields.some(f => line.toLowerCase().includes(f.toLowerCase()))
    )
  ).join("\n")
}

function truncateContext(results: PipelineStepResult[], maxTokens: number): string {
  const maxChars = maxTokens * 4  // ~4 chars per token
  const combined = results.map(r => `${r.agent}: ${r.output}`).join("\n\n")
  return combined.slice(0, maxChars)
}
```

### Phase 4: Update Pipeline Execution Loop

**File:** `packages/opencode/src/tool/pipeline.ts`

Replace the context passing logic in the main loop:

```ts
for (const [i, step] of params.steps.entries()) {
  // ... agent lookup (unchanged) ...
  
  // Prepare context with new config
  const augmentedPrompt = prepareContext(step.context, i, results, step.prompt)
  
  // ... session creation (unchanged) ...
  
  // Add variant to prompt call
  const promptResult = yield* promptOps.prompt({
    messageID,
    sessionID: subSession.id,
    model: { modelID: model.modelID, providerID: model.providerID },
    agent: stepAgent.name,
    variant: step.variant,  // NEW: pass variant
    tools: { todowrite: false, task: false },
    parts,
  })
  
  // ... rest unchanged ...
}
```

### Phase 5: Add Named Pipeline Config Schema

**File:** `packages/opencode/src/config/pipeline.ts` (new)

```ts
import { Schema } from "effect"

const PipelineStepConfig = Schema.Struct({
  agent: Schema.String,
  variant: Schema.optional(Schema.String),
  prompt: Schema.String,
  context: Schema.optional(Schema.Struct({
    from: Schema.optional(Schema.Union([Schema.Number, Schema.Array(Schema.Number)])),
    mode: Schema.optional(Schema.Literal("full", "summary", "fields", "maxTokens")),
    fields: Schema.optional(Schema.Array(Schema.String)),
    maxTokens: Schema.optional(Schema.Number),
  })),
})

const PipelineConfig = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  steps: Schema.Array(PipelineStepConfig),
})

export const PipelinesConfig = Schema.Record(Schema.String, PipelineConfig)
export type PipelinesConfig = Schema.Schema.Type<typeof PipelinesConfig>
```

### Phase 6: Load Pipelines from Config

**File:** `packages/opencode/src/config/config.ts`

Add pipeline loading:

```ts
// In config loading:
result.pipelines = cfg.pipelines ?? {}
```

### Phase 7: Create Pipeline Invocation Tool

**File:** `packages/opencode/src/tool/pipeline.ts`

Add a new `PipelineInvokeTool` for named pipelines:

```ts
export const PipelineInvokeParameters = Schema.Struct({
  name: Schema.String.annotate({
    description: "Name of the pipeline to run from opencode.json config",
  }),
  input: Schema.String.annotate({
    description: "Input prompt for the pipeline",
  }),
})

export const PipelineInvokeTool = Tool.define(
  "pipeline_invoke",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    
    return {
      description: "Run a named pipeline from opencode.json configuration.",
      parameters: PipelineInvokeParameters,
      execute: (params, ctx) => Effect.gen(function* () {
        const cfg = yield* config.get()
        const pipeline = cfg.pipelines?.[params.name]
        
        if (!pipeline) {
          return {
            title: "Pipeline Error",
            output: `Pipeline "${params.name}" not found in config. Available: ${Object.keys(cfg.pipelines ?? {}).join(", ")}`,
          }
        }
        
        // Convert config to steps format
        const steps = pipeline.steps.map(s => ({
          agent: s.agent,
          description: s.prompt.slice(0, 50) + "...",
          prompt: s.prompt.replace("{input}", params.input),
          variant: s.variant,
          context: s.context,
        }))
        
        // Execute using existing pipeline logic
        // ... (reuse PipelineTool execution)
      }),
    }
  }),
)
```

### Phase 8: TUI Integration

**File:** `packages/opencode/src/cli/cmd/tui/app.tsx`

Add pipeline command:

```ts
{
  title: "Run pipeline",
  value: "pipeline.run",
  keybind: "<leader>p",
  category: "Agent",
  onSelect: () => {
    dialog.replace(() => <DialogPipeline />)
  },
},
```

### Phase 9: Pipeline Selection Dialog

**File:** `packages/opencode/src/cli/cmd/tui/component/dialog-pipeline.tsx` (new)

```tsx
import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogPipeline() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  
  const pipelines = createMemo(() => {
    const cfg = sync.data.config.pipelines ?? {}
    return Object.entries(cfg).map(([name, pipeline]) => ({
      value: name,
      title: name,
      description: pipeline.description ?? `${pipeline.steps.length} steps: ${pipeline.steps.map(s => s.agent).join(" → ")}`,
      onSelect: () => {
        // TODO: Show input dialog, then invoke pipeline
        dialog.clear()
      },
    }))
  })
  
  return (
    <DialogSelect
      title="Select Pipeline"
      options={pipelines()}
      flat={true}
    />
  )
}
```

## Example Usage

### Config in `opencode.json`
```json
{
  "pipelines": {
    "build-review": {
      "description": "Plan → Code → Review pipeline",
      "steps": [
        {
          "agent": "plan",
          "variant": "high",
          "prompt": "Propose build procedure for: {input}"
        },
        {
          "agent": "coder",
          "variant": "medium",
          "prompt": "Implement the proposed build procedure",
          "context": { "from": 0, "mode": "full" }
        },
        {
          "agent": "general",
          "variant": "max",
          "prompt": "Review and provide insights on the implementation",
          "context": { "from": [0, 1], "mode": "summary", "maxTokens": 4000 }
        }
      ]
    }
  }
}
```

### TUI Usage
```bash
# Via command palette:
/pipeline build-review "implement dark mode"

# Via keybind:
<leader>p → select "build-review" → enter input
```

### Pipeline Tool Usage (by AI)
```json
{
  "steps": [
    {
      "agent": "plan",
      "description": "Plan build procedure",
      "prompt": "Propose build procedure for dark mode",
      "variant": "high"
    },
    {
      "agent": "coder",
      "description": "Implement dark mode",
      "prompt": "Implement the proposed build procedure",
      "variant": "medium",
      "context": { "from": 0, "mode": "full" }
    }
  ]
}
```

## Files to Create/Modify

| File | Action | Lines |
|------|--------|-------|
| `packages/opencode/src/tool/pipeline.ts` | Extend | +80 |
| `packages/opencode/src/config/pipeline.ts` | Create | ~40 |
| `packages/opencode/src/config/config.ts` | Modify | +5 |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | Modify | +10 |
| `packages/opencode/src/cli/cmd/tui/component/dialog-pipeline.tsx` | Create | ~60 |
| `packages/opencode/src/config/keybinds.ts` | Modify | +1 |

## Implementation Order

1. [ ] Create `config/pipeline.ts` schema
2. [ ] Extend `tool/pipeline.ts` with variant + context modes
3. [ ] Add pipeline loading to `config/config.ts`
4. [ ] Create `dialog-pipeline.tsx`
5. [ ] Add TUI command and keybind
6. [ ] Test with sample pipeline
