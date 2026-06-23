# Agent Pipeline & Media Capability Plan

**Created:** 2026-06-23
**Status:** Plan — three-module feature: capability tool, chained agents, TUI media output

---

## Module A: Model Capability Tool + YAML

**Goal:** Assistant-usable tool that queries model capabilities from a portable YAML file next to the executable, cross-references with `auth.json` for API keys, and returns ranked model choices.

### A.1 `models_capabilities.yaml` — Schema & template

**File:** `{Global.Path.config}/models_capabilities.yaml` (NEW, next to executable)
**Effort:** 30 min

**Schema:**
```yaml
version: 1

models:
  - provider_id: "openai"
    model_id: "gpt-5-pro"
    proven: true
    tested_at: "2026-06-20T14:30:00Z"
    notes: "Image gen native, reasoning works"
    
  - provider_id: "google"
    model_id: "gemini-3.1-flash-image-preview"
    proven: false
    tested_at: null
    notes: "Awaiting API key"
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider_id` | string | yes | Provider ID matching models.json |
| `model_id` | string | yes | Model ID matching models.json |
| `proven` | boolean | yes | Whether tested and verified working |
| `tested_at` | ISO8601 or null | yes | Last test timestamp |
| `notes` | string | no | Freeform notes about behavior |

**Input parameters:** `Schema.Struct` for YAML parsing/validation.
**Output:** `CapabilityEntry[]`
**Test:** Parse valid YAML, reject invalid, default `proven: false` / `tested_at: null`

### A.2 `CapabilityService` — Effect service

**File:** `packages/opencode/src/capability/index.ts` (NEW)
**Effort:** 1h

**Interface:**
```typescript
export interface Interface {
  readonly read: () => Effect.Effect<CapabilityEntry[], CapabilityError>
  readonly write: (entries: CapabilityEntry[]) => Effect.Effect<void, CapabilityError>
  readonly lookup: (criteria: LookupCriteria) => Effect.Effect<LookupResult[], CapabilityError>
}
```

**`lookup()` logic:**
1. Read `models_capabilities.yaml` → `CapabilityEntry[]`
2. Read `models.json` (via existing `Provider.Service`) → full model data
3. Read `auth.json` (via existing `Auth.Service`) → available API keys
4. Filter by criteria (capability, modality, provider)
5. Sort: proven first → recently tested → cost ascending
6. Annotate each result with `has_api_key: boolean`

**Input parameters:**
```typescript
LookupCriteria {
  task: string           // natural language: "generate an image", "read a PDF"
  modality?: "image" | "audio" | "video" | "text"
  direction?: "input" | "output"
  capability?: string     // "generate", "process", "reason", "tool_call"
}
LookupResult {
  provider_id: string
  model_id: string
  proven: boolean
  tested_at: string | null
  has_api_key: boolean
  capabilities: ProviderCapabilities
  cost: ProviderCost
  notes?: string
}
```

**Test:** Mock YAML, models.json, auth.json → verify correct filter/sort/annotate

### A.3 `capability` tool

**File:** `packages/opencode/src/tool/capability.ts` (NEW)
**Effort:** 1h

**Tool definition** (follows `edit.ts` / `bash.ts` pattern):
```typescript
export const Parameters = Schema.Struct({
  task: Schema.String.annotate({
    description: "Natural language task description, e.g. 'generate an image', 'transcribe audio'"
  }),
  modality: Schema.optional(Schema.Literals("image", "audio", "video", "text")).annotate({
    description: "Filter by output modality"
  }),
  sort_by: Schema.optional(Schema.Literals("proven", "cost", "recent")).annotate({
    description: "Sort results by proven status, cost, or most recently tested"
  }),
})

export const CapabilityTool = Tool.define("capability", Effect.gen(function* () {
  const svc = yield* Capability.Service
  const auth = yield* Auth.Service
  return {
    description: `Look up which models support a given capability. Cross-references with available API keys and proven/tested status. Use before generating images, audio, video, or processing non-text attachments.`,
    parameters: Parameters,
    execute: (params, ctx) => Effect.gen(function* () {
      const results = yield* svc.lookup({
        task: params.task,
        modality: params.modality,
      })
      // Sort
      const sorted = sortResults(results, params.sort_by ?? "proven")
      // Format table
      const output = formatTable(sorted)
      return {
        title: `Model capability lookup: ${params.task}`,
        metadata: { results: sorted },
        output,
      }
    }),
  }
}))
```

**Output format** (plaintext table):
```
Model                    | Provider  | Proven | API Key | Cost/1M tokens
gpt-5-pro                | openai    | ✓      | ✓       | $2.50 / $10.00
gemini-3.1-flash-image   | google    | ✗      | ✗       | $0.50 / $2.00
imagen-4                 | google    | -      | ✗       | $0.02 / image

✓ = tested and verified  ✗ = tested, not working  - = untested
```

**Test:** Given mock service → tool returns formatted table

### A.4 Tool registration

**File:** `packages/opencode/src/tool/registry.ts` (MODIFY)
**Effort:** 10 min

Three insertion points (following the pattern of all 21 built-in tools):

1. **Yield the raw definition** (~line 108, after `const jobwait =`):
   ```typescript
   const capability = yield* CapabilityTool
   ```

2. **Initialize in Effect.all** (~line 200-223, after `jobwait`):
   ```typescript
   capability: Tool.init(capability),
   ```

3. **Add to builtin array** (~line 227-250, after `tool.jobwait`):
   ```typescript
   tool.capability,
   ```

Same 3-step pattern for `pipeline` tool.

### A.5 TUI renderer

**File:** `packages/ui/src/components/message-part.tsx` (MODIFY)
**Effort:** 30 min

Register renderer:
```typescript
ToolRegistry.register({
  name: "capability",
  render(props) {
    return (
      <BasicTool icon="search" trigger={{ title: "Capability lookup", subtitle: props.input.task }}>
        <pre><code>{props.output}</code></pre>
      </BasicTool>
    )
  },
})
```

---

## Module B: Chained Agent Pipeline

**Goal:** Compose multiple sub-agents sequentially where agent N's output feeds as context to agent N+1.

### B.1 New agent types

**File:** `packages/opencode/src/agent/agent.ts` (MODIFY)
**Effort:** 30 min

Add three new subagent definitions alongside `general` and `explore`:

```typescript
// Lines 140-182 (after explore)

coder: {
  name: "coder",
  description: `Specialized agent for implementing code changes. Has full edit/write/bash access.`,
  permission: Permission.merge(defaults, Permission.fromConfig({ todowrite: "deny" }), user),
  prompt: PROMPT_CODER,   // from agent/prompt/coder.txt
  options: {},
  mode: "subagent",
  native: true,
}

researcher: {
  name: "researcher",
  description: `Specialized agent for information gathering. Read-only: search, fetch, read, glob, grep.`,
  permission: Permission.merge(defaults, Permission.fromConfig({
    "*": "deny",
    read: "allow", glob: "allow", grep: "allow", list: "allow",
    bash: "allow",   // for rg
    webfetch: "allow", universalsearch: "allow",
    messagesearch: "allow", "session-read": "allow",
  }), user),
  prompt: PROMPT_RESEARCHER,  // from agent/prompt/researcher.txt
  options: {},
  mode: "subagent",
  native: true,
}

media: {
  name: "media",
  description: `Specialized agent for media generation (images, audio, video). Knows model capabilities via capability tool.`,
  permission: Permission.merge(defaults, Permission.fromConfig({
    "*": "deny",
    read: "allow", write: "allow",
    capability: "allow",    // can use capability tool
    bash: "allow",
  }), user),
  prompt: PROMPT_MEDIA,     // from agent/prompt/media.txt
  options: {},
  mode: "subagent",
  native: true,
}
```

**New prompt files** (NEW, ~50-100 lines each):
- `packages/opencode/src/agent/prompt/coder.txt`
- `packages/opencode/src/agent/prompt/researcher.txt`
- `packages/opencode/src/agent/prompt/media.txt`

### B.2 `pipeline` tool

**File:** `packages/opencode/src/tool/pipeline.ts` (NEW)
**Effort:** 1.5h

```typescript
export const Parameters = Schema.Struct({
  steps: Schema.Array(
    Schema.Struct({
      agent: Schema.String.annotate({ description: "Agent type: coder, researcher, media, general, explore" }),
      description: Schema.String.annotate({ description: "Short (3-5 word) description of this step" }),
      prompt: Schema.String.annotate({ description: "Task for this agent to perform" }),
    })
  ).annotate({ description: "Ordered list of agent steps. Output of step N is appended as context for step N+1." }),
})

export const PipelineTool = Tool.define("pipeline", Effect.gen(function* () {
  // Access TaskTool as a Tool.Def (not a Service), call execute() directly
  const taskDef = yield* TaskTool  // Effect yielding Tool.Info
  const taskInit = yield* Tool.init(taskDef)  // Resolve Info → Def
  return {
    description: `Chain multiple sub-agents sequentially. Each agent's output feeds as context to the next. Use for complex tasks that need research → code → validation.`,
    parameters: Parameters,
    execute: (params, ctx) => Effect.gen(function* () {
      const results: PipelineResult[] = []
      let context = ""
      
      for (const [i, step] of params.steps.entries()) {
        const augmentedPrompt = i === 0
          ? step.prompt
          : `${step.prompt}\n\n## Context from previous step:\n${context}`
        
        // Call execute as a plain function (returns Effect), passing ctx through
        const result = yield* taskInit.execute({
          subagent_type: step.agent,
          description: step.description,
          prompt: augmentedPrompt,
        }, ctx)
        
        context = result.output
        results.push({ step: i, agent: step.agent, output: result.output, metadata: result.metadata })
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

**Key design decisions:**
- `TaskTool` is accessed as `Tool.Info` via `yield*`, then resolved to `Tool.Def` via `Tool.init()`
- `taskInit.execute()` is called as a plain function (it's a field on `Tool.Def`, not a service method)
- Same `ctx` (Tool.Context) is threaded through to all sub-steps — sessionID/messageID/abort all propagate
- One tool call = one pipeline = one tool result row in the TUI

### B.3 Pipeline TUI renderer

**File:** `packages/ui/src/components/message-part.tsx` (MODIFY)
**Effort:** 45 min

```typescript
ToolRegistry.register({
  name: "pipeline",
  render(props) {
    const steps = () => props.metadata?.pipeline ?? []
    return (
      <BasicTool icon="git-branch" trigger={{ title: `Pipeline (${steps().length} steps)` }}>
        <For each={steps()}>
          {(step, i) => (
            <div>
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

---

## Module C: Multimedia TUI Output

**Goal:** Render non-text tool outputs (images, audio, video) in the terminal UI.

### C.1 Image rendering — terminal protocol + ASCII fallback

**File:** `packages/ui/src/components/media/image.tsx` (NEW)
**Effort:** 1h

```typescript
// Detect terminal capabilities
function detectImageProtocol(): "kitty" | "iterm2" | "sixel" | "none" {
  // kitty: $TERM == "xterm-kitty"
  // iterm2: $TERM_PROGRAM == "iTerm.app"  
  // sixel: $TERM includes "sixel"
  // fallback: "none"
}

// Kitty protocol: \x1b_Gf=24,t=d,...\x1b\\  (base64 PNG)
// iterm2: \x1b]1337;File=inline=1;size=12345;...\x07 (base64)
// sixel: print sixel-encoded data
// ASCII: convert to block characters (limited resolution)

export function ImageDisplay(props: { 
  data: Uint8Array
  mime: string 
  maxWidth?: number 
  maxHeight?: number 
}): JSX.Element {
  const protocol = detectImageProtocol()
  
  if (protocol === "kitty") return <KittyImage data={props.data} />
  if (protocol === "iterm2") return <ITerm2Image data={props.data} />
  if (protocol === "sixel") return <SixelImage data={props.data} />
  
  // ASCII fallback
  return <ASCIIArt data={props.data} maxWidth={props.maxWidth ?? 80} />
}
```

### C.2 Audio metadata display

**File:** `packages/ui/src/components/media/audio.tsx` (NEW)
**Effort:** 30 min

Display audio metadata as a card:
- Duration, sample rate, channels, codec
- "Play" action that opens default OS player via `open` / `xdg-open` / `start`
- Waveform placeholder (simple ASCII bar chart)

### C.3 Video metadata display

**File:** `packages/ui/src/components/media/video.tsx` (NEW)
**Effort:** 30 min

Display video metadata as a card:
- Duration, dimensions, fps, codec
- "Open" action for external player
- First-frame thumbnail via protocol or ASCII

### C.4 Tool attachment → media rendering

**File:** `packages/ui/src/components/message-part.tsx` (MODIFY, ~line 1301)
**Effort:** 45 min

In `ToolPartDisplay`, detect when a tool has `attachments` with non-text mime types:

```typescript
// After existing tool render
if (part().state.attachments?.length) {
  for (const att of part().state.attachments) {
    if (att.mime.startsWith("image/")) {
      // FilePart.url is a data URL (data:image/png;base64,...)
      return <ImageDisplay url={att.url} mime={att.mime} />
    }
    if (att.mime.startsWith("audio/")) {
      return <AudioCard metadata={att} />
    }
    if (att.mime.startsWith("video/")) {
      return <VideoCard metadata={att} />
    }
  }
}
```

### C.5 Image display — data URL decode

**File:** `packages/ui/src/components/media/image.tsx` (NEW, updated)
**Effort:** included in C.1

`FilePart` stores binary data as a `url` field (data URL like `data:image/png;base64,...`), NOT as a `Uint8Array` content field. The image renderer must:
1. Accept `url: string` (data URL)
2. Decode the base64 payload from the data URL
3. Pass decoded bytes to the terminal protocol renderer

```typescript
function dataUrlToBytes(url: string): Uint8Array {
  const base64 = url.split(",")[1]
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}
```

---

## Implementation Order

```
A.1 (YAML schema) ─┬─ A.2 (CapabilityService) ── A.3 (capability tool) ── A.4 (registry) ── A.5 (TUI renderer)
                   │
B.1 (agent types) ─┴─ B.2 (pipeline tool) ── B.3 (TUI renderer)
                   
C.1 (image) ──── C.2 (audio) ──── C.3 (video) ──── C.4 (attachments) ──── C.5 (file part)
```

**Parallelizable:** Modules A, B, C can start in parallel. Within each, subtasks are sequential.

| Module | Total Time |
|--------|-----------|
| A (Capability Tool) | 3.2h |
| B (Agent Pipeline) | 3.0h |
| C (Media TUI) | 3.1h |
| **Total** | **~9.3h** |

---

## Verification

### Per-tool oracle
- `capability`: `bun typecheck` + unit test with mock YAML/models.json/auth.json → verify sort order, API key annotation
- `pipeline`: test agent1 → agent2 chain with mock TaskTool → verify context propagation
- TUI media: manual verification with test image/audio/video files

### End-to-end
1. `bun run typecheck` — zero errors in `packages/opencode` and `packages/ui`
2. `capability` tool appears in tool list and model can invoke it
3. Pipeline chains two agents and second agent receives first agent's output
4. Image attachment from a tool result renders in TUI (protocol or ASCII)
5. Audio/video attachments show metadata card with open action
