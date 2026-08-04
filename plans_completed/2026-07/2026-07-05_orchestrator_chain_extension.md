# Orchestrator Chain Extension Plan
> sv=[[orchestrator, pipeline, chain, context-passing, checkpoint, separate-sessions, configurable],[0.22,0.18,0.15,0.15,0.12,0.10,0.08]]
> abstract="Extend existing orchestrator with chain mode for sequential agent execution. Configurable context passing between steps. Separate sessions with isolated checkpoints per agent."

## Architecture

### Current Orchestrator
```
User → Orchestrator (hidden session) → delegates to sub-agents → returns result
```

### Proposed Chain Mode
```
User → Orchestrator (hidden session)
         ↓
       Step 1: Create session with agent-1
               Input: user prompt (or previous step output)
               Output: agent-1 result
               Checkpoint: isolated to agent-1 session
         ↓
       Step 2: Create session with agent-2
               Input: configurable (full/summary/fields from step 1)
               Output: agent-2 result
               Checkpoint: isolated to agent-2 session
         ↓
       Step N: Create session with agent-N
               Input: configurable from step N-1
               Output: final result
               Checkpoint: isolated to agent-N session
         ↓
       Orchestrator returns combined result to user
```

## Key Design Decisions

### 1. Separate Sessions (Confirmed)
Each agent in the chain gets its own session:
- **Checkpoint isolation**: Compaction in agent-2 doesn't affect agent-1
- **Variant isolation**: Each agent can have different variant settings
- **Clean separation**: No cross-contamination of context

### 2. Configurable Context Passing (Confirmed)
Each step defines what context to pass:

```json
{
  "pipeline": {
    "build-review": {
      "steps": [
        {
          "agent": "plan",
          "variant": "high",
          "context": {
            "input": "user"  // First step gets user input
          }
        },
        {
          "agent": "coder",
          "variant": "medium",
          "context": {
            "from": 0,  // Step index
            "mode": "full"  // or "summary", "fields", "maxTokens"
          }
        },
        {
          "agent": "general",
          "variant": "max",
          "context": {
            "from": [0, 1],  // Both previous steps
            "mode": "summary",
            "maxTokens": 4000
          }
        }
      ]
    }
  }
}
```

### 3. Context Passing Modes

| Mode | Description | Token Cost | Detail Level |
|------|-------------|------------|--------------|
| `full` | Complete output from previous step | High | 100% |
| `summary` | LLM-generated summary | Medium | ~20% |
| `fields` | Extract specific fields | Low | Configurable |
| `maxTokens` | Truncate to N tokens | Fixed | Partial |

## Implementation

### 1. Chain Configuration Schema
**File:** `packages/opencode/src/config/pipeline.ts` (new)

```ts
const StepSchema = Schema.Struct({
  agent: Schema.String,
  variant: Schema.optional(Schema.String),
  context: Schema.Struct({
    input: Schema.optional(Schema.Literal("user")),
    from: Schema.optional(Schema.Union([Schema.Number, Schema.Array(Schema.Number)])),
    mode: Schema.optional(Schema.Literal("full", "summary", "fields", "maxTokens")),
    fields: Schema.optional(Schema.Array(Schema.String)),
    maxTokens: Schema.optional(Schema.Number),
  }),
})

const PipelineSchema = Schema.Struct({
  name: Schema.String,
  steps: Schema.Array(StepSchema),
})
```

### 2. Orchestrator Chain Executor
**File:** `packages/opencode/src/session/orchestrator.ts` (extend)

```ts
async function executeChain(pipeline: Pipeline, userInput: string) {
  const results: string[] = []
  
  for (const [index, step] of pipeline.steps.entries()) {
    // Create isolated session for this step
    const session = await Session.create({
      agent: step.agent,
      variant: step.variant,
    })
    
    // Prepare input based on context config
    const input = prepareContext(step.context, userInput, results)
    
    // Execute in isolated session
    const output = await session.prompt(input)
    
    // Store result for next step
    results.push(output)
    
    // Checkpoint is automatic per-session
  }
  
  return results[results.length - 1]  // Final agent's output
}
```

### 3. Context Preparation Function
**File:** `packages/opencode/src/session/orchestrator.ts`

```ts
function prepareContext(
  context: ContextConfig,
  userInput: string,
  previousResults: string[]
): string {
  if (context.input === "user") return userInput
  
  const sourceResults = context.from === undefined
    ? [previousResults[previousResults.length - 1]]
    : Array.isArray(context.from)
      ? context.from.map(i => previousResults[i])
      : [previousResults[context.from]]
  
  switch (context.mode) {
    case "full":
      return sourceResults.join("\n\n")
    
    case "summary":
      return summarize(sourceResults.join("\n\n"), context.maxTokens)
    
    case "fields":
      return extractFields(sourceResults, context.fields ?? [])
    
    case "maxTokens":
      return truncate(sourceResults.join("\n\n"), context.maxTokens ?? 4000)
    
    default:
      return sourceResults.join("\n\n")
  }
}
```

### 4. TUI Integration
**File:** `packages/opencode/src/cli/cmd/tui/app.tsx`

Add new command:
```ts
{
  title: "Run pipeline",
  value: "pipeline.run",
  keybind: "<leader>p",
  category: "Agent",
  onSelect: () => {
    dialog.replace(() => <DialogPipeline />)
  },
}
```

### 5. Pipeline Selection Dialog
**File:** `packages/opencode/src/cli/cmd/tui/component/dialog-pipeline.tsx` (new)

```tsx
export function DialogPipeline() {
  const pipelines = loadPipelines()
  
  return (
    <DialogSelect
      title="Select Pipeline"
      options={pipelines.map(p => ({
        value: p.name,
        title: p.name,
        description: `${p.steps.length} steps: ${p.steps.map(s => s.agent).join(" → ")}`,
        onSelect: () => runPipeline(p),
      }))}
    />
  )
}
```

## Usage Examples

### Example 1: Build Review Pipeline
```bash
# User invokes:
/pipeline build-review "implement dark mode"

# System executes:
Step 1: plan agent → proposes build procedure
Step 2: coder agent → reviews and corrects code
Step 3: general agent → provides final insights

# Returns combined result to user
```

### Example 2: Research Pipeline
```bash
/pipeline research "analyze performance bottlenecks"

Step 1: explore agent → finds relevant files
Step 2: researcher agent → deep analysis
Step 3: general agent → synthesizes findings
```

### Example 3: Code Review Pipeline
```bash
/pipeline review "src/auth.ts"

Step 1: coder agent → identifies issues
Step 2: researcher agent → checks best practices
Step 3: plan agent → suggests improvements
```

## Benefits

1. **No manual agent switching**: Pipeline automates the flow
2. **Checkpoint isolation**: Compaction per agent, no cross-contamination
3. **Configurable context**: Each step controls what it receives
4. **Variant optimization**: Different reasoning effort per step
5. **Reproducible**: Pipeline config is saved and reusable
6. **Extensible**: Easy to add new pipelines via config

## Integration with Existing Systems

### Variant Storage
Each agent in pipeline uses `agentVariant` from `model.json`:
```json
{
  "agentVariant": {
    "plan/openai/gpt-5": "high",
    "coder/opencode/mimo-v2.5-free": "medium",
    "general/opencode/big-pickle": "max"
  }
}
```

### Checkpoint System
Each step creates isolated session with own checkpoint:
```
{log}/.checkpoints/openai_gpt-5_{session1}.enc  // plan agent
{log}/.checkpoints/opencode_mimo_{session2}.enc  // coder agent
{log}/.checkpoints/opencode_bigpickle_{session3}.enc  // general agent
```

### Compaction
Each agent compacts independently:
- Plan agent compacts at 80% context → preserves proposal
- Coder agent compacts at 70% context → preserves code review
- General agent compacts at 90% context → preserves synthesis

**Status:** Design complete, implemented in orchestrator-chain-implementation

## Implementation Order

1. [x] Create pipeline config schema (`config/pipeline.ts`)
2. [x] Implement chain executor in orchestrator
3. [x] Add context preparation function
4. [x] Create pipeline selection dialog
5. [x] Add TUI command and keybind
6. [~] Test with sample pipelines (deferred to runtime)
7. [x] Document pipeline configuration
