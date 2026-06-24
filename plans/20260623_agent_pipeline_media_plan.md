# Agent Pipeline & Media Capability Plan

**Created:** 2026-06-23
**Status:** Active — Module A (capability) and Module B (pipeline) complete. Modules C (media TUI) and D (multimodal messages) remain.

## Audit Update — 2026-06-23

Current code state:
- `packages/opencode/src/capability/index.ts` exists and was stabilized with schema-decoded YAML, provider-backed lookup, deterministic ranking, and focused tests.
- `packages/opencode/src/tool/capability.ts` exists, is registered in `packages/opencode/src/tool/registry.ts`, and delegates lookup to `Capability.Service`.
- `pipeline` is not implemented: no `packages/opencode/src/tool/pipeline.ts`, no pipeline registration, and no dedicated pipeline TUI renderer.
- `coder`, `researcher`, and `media` native agents are not implemented; only `general` and `explore` exist as visible native subagents.
- Attachment handlers and media dependencies already exist in `packages/opencode/src/attachment/handlers/`; the remaining media backend work is tests/fixtures/runtime validation.
- `FilePart` already exists in the message union and user/tool media conversion paths exist; assistant-originated media rendering/context support still needs focused review.

Recommended cleanup order:
1. Stabilize capability service/tool and tests.
2. Validate existing attachment handlers with fixtures.
3. Add assistant media rendering/context only after the existing media path is proven.
4. Implement `pipeline` last, after task-agent and capability foundations are stable.

---

## Module A: Model Capability Tool + YAML

**Goal:** Assistant-usable tool that queries model capabilities from a portable YAML file next to the executable, cross-references with `auth.json` for API keys, and returns ranked model choices.

### A.1 `models_capabilities.yaml` — Schema & template — implemented, verify

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

### A.2 `CapabilityService` — Effect service — implemented, verify in downstream use

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

**Audit:** `packages/opencode/src/capability/index.ts` now uses schema-decoded YAML, provider service model data, auth annotation, and deterministic sorting. Focused capability tests cover absent YAML, valid YAML, malformed YAML, filtering, auth annotation, and ranking.

### A.3 `capability` tool — implemented

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

**Audit:** `packages/opencode/src/tool/capability.ts` now delegates to `Capability.Service`, uses narrowed modality schema, and has focused tool coverage for formatted output and schema rejection.

### A.4 Tool registration — implemented

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

**Audit:** Capability is already imported, initialized, and included in the builtin tool list. Pipeline remains unimplemented.

### A.5 Terminal TUI renderer — implemented

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (MODIFY)
**Effort:** 30 min

Register renderer in the terminal TUI switch:
```typescript
<Match when={props.part.tool === "capability"}>
  <Capability {...toolprops} />
</Match>
```

---

## Module B: Chained Agent Pipeline — [x] complete (2026-06-24)

**Goal:** Compose multiple sub-agents sequentially where agent N's output feeds as context to agent N+1.

### B.1 New agent types — open

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

### B.2 `pipeline` tool — open

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

### B.3 Pipeline TUI renderer — open

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

## Module C: Multimedia TUI Output — open TUI layer, backend partly implemented

**Goal:** Render non-text tool outputs (images, audio, video) via child processes (chafa, mpv, ffmpeg). No custom escape sequences — proven approach from experiments.

**Test results (2026-06-23, Windows Terminal, cmd_runner --terminal wt):**
| Renderer | Result | Use |
|----------|--------|-----|
| chafa `--format kitty` | No render | Drop |
| chafa `--format sixel` | No render | Drop |
| chafa `--format symbols --color-space rgb` | Works | **Primary image renderer** |
| mpv `--vo=tct --tct-algo=half-blocks` | Works | **Video inline preview** |
| mpv `--vo=gpu` (spawned) | Works | **Video full playback** |
| mpv `--vo=null` (audio) | Works | **Audio playback** |

### C.1 Image rendering — chafa symbols

**File:** `packages/ui/src/components/media/image.tsx` (NEW)
**Effort:** 30 min

Single renderer, single path. No protocol detection.

```typescript
export function ImageDisplay(props: { url: string; mime: string }): JSX.Element {
  // 1. Write data URL bytes to temp file
  // 2. Get terminal dimensions from TUI context
  // 3. Spawn: chafa --format symbols --color-space rgb --size {W}x{H} temp.png
  // 4. chafa output renders directly to terminal stdout
  // 5. Clean up temp file
}
```

**Command template:**
```
chafa --format symbols --color-space rgb --size {cols}x{rows} {file}
```

### C.2 Video rendering — mpv tct (inline) + mpv gpu (external)

**File:** `packages/ui/src/components/media/video.tsx` (NEW)
**Effort:** 30 min

Two modes:
1. **Thumbnail/inline preview**: `ffmpeg` extract first frame → `chafa` symbols
2. **Full playback**: `start "" mpv --vo=gpu {file}` (opens separate window)
3. **Inline tct preview**: `mpv --vo=tct --tct-algo=half-blocks --no-audio --length=5 {file}`

Metadata card shows: duration, dimensions, fps, codec + [Play] button.

### C.3 Audio rendering — metadata card + play

**File:** `packages/ui/src/components/media/audio.tsx` (NEW)
**Effort:** 20 min

Metadata card: duration, sample rate, channels, codec.
[Play] spawns: `mpv --vo=null {file}` (terminal-integrated playback).

### C.4 Tool attachment → media routing

**File:** `packages/ui/src/components/message-part.tsx` (MODIFY, ~line 1301)
**Effort:** 30 min

In `ToolPartDisplay`, route by mime type on `attachments`:

```typescript
if (part().state.attachments?.length) {
  for (const att of part().state.attachments) {
    // FilePart.url is a data URL (data:image/png;base64,...)
    if (att.mime.startsWith("image/")) return <ImageDisplay url={att.url} mime={att.mime} />
    if (att.mime.startsWith("video/")) return <VideoCard url={att.url} metadata={att} />
    if (att.mime.startsWith("audio/")) return <AudioCard url={att.url} metadata={att} />
  }
}
```

**Note:** No file part enrichment needed. `FilePart.url` (data URL) is already available — write to temp file, pass path to chafa/mpv.

---

## Module D: Multimodal Message Model + Capability Injection

**Goal:** Treat image, audio, video as first-class assistant message parts (not just tool attachments) and inject output capabilities into the system prompt so the model knows what it can produce.

### D.1 Add `FilePart` to assistant message parts — already present, verify assistant semantics

**File:** `packages/opencode/src/session/message-v2.ts` (MODIFY)
**Effort:** 20 min

Current union (line ~310):
```typescript
export const AssistantMessagePart = Schema.Union([
  TextPart, ToolPart, ReasoningPart, StepStartPart, StepFinishPart
])
```

New:
```typescript
export const AssistantMessagePart = Schema.Union([
  TextPart, ToolPart, ReasoningPart, StepStartPart, StepFinishPart, FilePart
])
```

### D.2 Handle provider `file` stream events in processor

**File:** `packages/opencode/src/session/processor.ts` (MODIFY)
**Effort:** 30 min

Add handler for provider `file` events in `handleEvent()`:
```typescript
case "file": {
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: ctx.assistantMessage.id,
    sessionID: ctx.sessionID,
    type: "file",
    mime: value.mediaType,
    url: value.url,
    filename: value.filename,
  })
  return
}
```

### D.3 Capability-aware system prompt injection

**File:** `packages/opencode/src/session/system.ts` or `prompt.ts` (MODIFY)
**Effort:** 20 min

In `environment()` or prompt assembly, append capability line based on `model.capabilities.output`:

```typescript
function outputCapabilityLine(model: Provider.Model): string | undefined {
  const modalities = Object.entries(model.capabilities.output)
    .filter(([_, supported]) => supported)
    .map(([mod]) => mod)
  if (modalities.length <= 1) return undefined  // text-only = no injection
  return `Output modalities: ${modalities.join(", ")}`
}
// Result: "Output modalities: text, image" or "Output modalities: text, image, audio"
```

Placed as the last line of the system prompt — minimal token cost, maximal signaling.

### D.4 Render `FilePart` in assistant messages in TUI

**File:** `packages/ui/src/components/message-part.tsx` (MODIFY, ~line 1400)
**Effort:** 30 min

In the assistant message renderer, detect `FilePart` and route to chafa/mpv:
```typescript
const partMapping = {
  // ...existing
  file: (props) => {
    const part = () => props.part as FilePart
    if (part().mime.startsWith("image/")) return <ImageDisplay url={part().url} mime={part().mime} />
    if (part().mime.startsWith("video/")) return <VideoCard url={part().url} metadata={part()} />
    if (part().mime.startsWith("audio/")) return <AudioCard url={part().url} metadata={part()} />
    return <span>{part().filename ?? part().mime}</span>  // unknown file type
  }
}
```

### D.5 Update `toModelMessagesEffect` for assistant media in context

**File:** `packages/opencode/src/session/message-v2.ts` (MODIFY)
**Effort:** 20 min

When converting conversation history for the model, assistant-originated `FilePart` entries need to be included. The model may need to reference "the image I generated earlier." Current code only handles user-originated file parts and tool result attachments.

---

## Module Connection Diagram

```
┌──────────────────────────────────────────────────────────┐
│  User: "generate a spectrogram of this audio"            │
│  UserMessage: [TextPart, FilePart(audio.mp3)]            │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  System prompt includes:                                 │
│  "Output modalities: text, image"     ← Module D.3       │
│                                                          │
│  Assistant calls capability tool:     ← Module A         │
│  "Which models process audio→image?"                     │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Assistant picks model, generates image                  │
│  Processor creates FilePart            ← Module D.2       │
│  AssistantMessage: [TextPart, FilePart(spectrogram.png)] │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  TUI renders:                                            │
│  "Here's the spectrogram:"                               │
│  ┌─────────────────────────────────┐                     │
│  │ ██████░░░░██████     ← Module C │  ← Module D.4       │
│  │ chafa symbols inline            │                     │
│  └─────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────┘
```

---

## Implementation Order

```
A.1 ── A.2 ── A.3 ── A.4 ── A.5     (Capability Tool)
B.1 ── B.2 ── B.3                    (Agent Pipeline)
C.1 ── C.2 ── C.3 ── C.4            (Media TUI Rendering)
D.1 ── D.2 ── D.3 ── D.4 ── D.5     (Multimodal Messages + Injection)
```

**Parallelizable:** Modules A, B, C, D can start in parallel. D.1 (schema change) should go first within Module D since everything depends on it.

| Module | Total Time |
|--------|-----------|
| A (Capability Tool) | 3.2h |
| B (Agent Pipeline) | 3.0h |
| C (Media TUI) | 1.8h |
| D (Multimodal Messages) | 2.0h |
| **Total** | **~10.0h** |

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
4. Image attachment renders via chafa symbols in TUI (tool result + assistant message)
5. Video attachment shows mpv tct preview + gpu playback button
6. Audio attachment shows metadata card + mpv playback button
7. Multimodal model receives `Output modalities: text, image` in its system prompt
8. Assistant `FilePart` renders inline between `TextPart` entries in the same turn
