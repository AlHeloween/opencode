# B — Agent Pipeline

**Parent:** `plans/20260623_agent_pipeline_media_plan.md`
**Status:** [x] Complete — implemented 2026-06-24
**Effort:** 3.0h

---

## Abstract Definition

Add three new subagent types (coder, researcher, media) and a `pipeline` tool that chains agents sequentially — output of agent N feeds as context for agent N+1.

---

## Structural Diagram

```
User prompt
  │
  ▼
┌──────────────────────────────────────────────────┐
│ pipeline tool                                     │
│   params: { steps: [{ agent, prompt }, ...] }     │
│                                                    │
│   Step 0: agent="researcher"                       │
│     ┌──────────────────────────────────┐          │
│     │ Child session (TaskTool)           │          │
│     │ search → fetch → read             │          │
│     │ output: "found 3 relevant files"   │──┐       │
│     └──────────────────────────────────┘  │       │
│                                            ▼       │
│   Step 1: agent="coder"                           │
│     ┌──────────────────────────────────┐          │
│     │ Child session (TaskTool)           │          │
│     │ prompt += "\n## Context:\n{step0}" │          │
│     │ edit → write → bash               │          │
│     │ output: "implemented changes"      │          │
│     └──────────────────────────────────┘          │
│                                                    │
│   return { steps: [result0, result1] }             │
└──────────────────────────────────────────────────┘
  │
  ▼
TUI: Pipeline card with per-step accordion
```

---

## B.1 — New Agent Types

**File:** `packages/opencode/src/agent/agent.ts` (MODIFY)
**Effort:** 30 min
**Files to create:** 
- `packages/opencode/src/agent/prompt/coder.txt`
- `packages/opencode/src/agent/prompt/researcher.txt`
- `packages/opencode/src/agent/prompt/media.txt`

### Input
Three agent definitions with scoped permissions, following the `general`/`explore` pattern exactly.

### Output
Three `Agent.Info` entries in the builtin agent registry.

### Code (in `agent.ts`, after `explore` definition at ~line 182)

```typescript
coder: {
  name: "coder",
  description: `Specialized agent for implementing code changes. Has full edit/write/bash access.`,
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({ todowrite: "deny" }),
    user,
  ),
  prompt: PROMPT_CODER,
  options: {},
  mode: "subagent",
  native: true,
},

researcher: {
  name: "researcher",
  description: `Specialized agent for information gathering. Read-only: search, fetch, read, glob, grep.`,
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "deny",
      read: "allow", glob: "allow", grep: "allow", list: "allow",
      bash: "allow",
      webfetch: "allow", universalsearch: "allow",
      messagesearch: "allow", "session-read": "allow",
    }),
    user,
  ),
  prompt: PROMPT_RESEARCHER,
  options: {},
  mode: "subagent",
  native: true,
},

media: {
  name: "media",
  description: `Specialized agent for media generation (images, audio, video). Uses capability tool to select models.`,
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "deny",
      read: "allow", write: "allow",
      capability: "allow",
      bash: "allow",
    }),
    user,
  ),
  prompt: PROMPT_MEDIA,
  options: {},
  mode: "subagent",
  native: true,
},
```

### Reason
`general` and `explore` are broad agents. `coder`/`researcher`/`media` give the model purpose-built tools for specific task categories. Each has scoped permissions: coder gets full edit access, researcher is read-only, media has capability tool access.

---

## B.2 — Pipeline Tool

**File:** `packages/opencode/src/tool/pipeline.ts` (NEW)
**Effort:** 1.5h

### Abstract
A tool that chains multiple sub-agent invocations sequentially. Each step runs a `TaskTool` sub-session. Step N's output text is prepended as context to step N+1's prompt.

### Input parameters
```typescript
Schema.Struct({
  steps: Schema.Array(Schema.Struct({
    agent: Schema.String,         // "coder" | "researcher" | "media" | "general" | "explore"
    description: Schema.String,   // short 3-5 word description
    prompt: Schema.String,        // task for this agent
  })),
})
```

### Output
```typescript
{
  title: string,                   // "Pipeline: N steps"
  metadata: { pipeline: PipelineResult[] },
  output: string,                  // formatted summary
}
```

### Implementation

```typescript
export const PipelineTool = Tool.define("pipeline", Effect.gen(function* () {
  // Access TaskTool as Tool.Info → Tool.Def (not a Service)
  const taskDef = yield* TaskTool           // Effect yielding Tool.Info
  const taskInit = yield* Tool.init(taskDef) // Resolve Info → Def

  return {
    description: `Chain multiple sub-agents sequentially...`,
    parameters: Parameters,
    execute: (params, ctx) => Effect.gen(function* () {
      const results: PipelineResult[] = []
      let context = ""

      for (const [i, step] of params.steps.entries()) {
        const augmentedPrompt = i === 0
          ? step.prompt
          : `${step.prompt}\n\n## Context from previous step:\n${context}`

        // Call TaskTool.execute as plain function, threading ctx
        const result = yield* taskInit.execute({
          subagent_type: step.agent,
          description: step.description,
          prompt: augmentedPrompt,
        }, ctx)

        context = result.output
        results.push({
          step: i, agent: step.agent,
          output: result.output, metadata: result.metadata,
        })
      }

      return {
        title: `Pipeline: ${params.steps.length} steps`,
        metadata: { pipeline: results },
        output: formatPipelineOutput(results),
      }
    }),
  }
}))
```

### Why this pattern
`TaskTool` is a `Tool.Def`, not an Effect Service. We access it as `Tool.Info` via `yield*`, then `Tool.init()` to get the resolved `Tool.Def`. The `execute` field on `Tool.Def` is a plain function `(params, ctx) => Effect` — we call it directly, propagating the same `ctx` (sessionID, messageID, abort, etc.).

### Registration
Same 3-point pattern as capability tool in `registry.ts`.

---

## B.3 — Pipeline TUI Renderer

**File:** `packages/ui/src/components/message-part.tsx` (MODIFY)
**Effort:** 45 min

```typescript
ToolRegistry.register({
  name: "pipeline",
  render(props) {
    const steps = () => props.metadata?.pipeline ?? []
    return (
      <BasicTool
        icon="git-branch"
        trigger={{ title: `Pipeline (${steps().length} steps)` }}
      >
        <For each={steps()}>
          {(step, i) => (
            <div data-slot="pipeline-step">
              <b>Step {i() + 1}: {step.agent}</b>
              <pre><code>{step.output.slice(0, 500)}...</code></pre>
            </div>
          )}
        </For>
      </BasicTool>
    )
  },
})
```

### Test
Manual: invoke pipeline with researcher→coder. Verify second agent sees first agent's output in context.
