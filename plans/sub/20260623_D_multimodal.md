# D — Multimodal Message Model + Capability Injection

**Parent:** `plans/20260623_agent_pipeline_media_plan.md`
**Status:** [ ] Pending
**Effort:** 2.0h

---

## Abstract Definition

Expand the assistant message data model to treat images, audio, and video as first-class message parts (not just tool attachments). Inject model output capabilities into the system prompt so the model knows what it can produce.

---

## Structural Diagram

```
Current:
  AssistantMessage.parts = [TextPart | ToolPart | ReasoningPart | StepPart]
                              ↑ no FilePart

New:
  AssistantMessage.parts = [TextPart | FilePart | ToolPart | ReasoningPart | StepPart]
                              ↑ new: model can emit media directly
```

```
System prompt assembly (before):
  [session: ...] [rules] [instructions] [environment] [skills]
                          ↑ no capability info

System prompt assembly (after):
  [session: ...] [rules] [instructions] [environment] [skills]
  Output modalities: text, image         ← D.3: conditional injection
```

```
Model response stream:
  text-delta → TextPart
  tool-call → ToolPart
  file → FilePart          ← D.2: new event handler
  finish-step → finalize
```

---

## D.1 — Add FilePart to AssistantMessage parts union

**File:** `packages/opencode/src/session/message-v2.ts` (MODIFY)
**Effort:** 20 min

### Current (line ~310)
```typescript
export const AssistantMessagePart = Schema.Union([
  TextPart, ToolPart, ReasoningPart, StepStartPart, StepFinishPart
])
```

### New
```typescript
export const AssistantMessagePart = Schema.Union([
  TextPart, FilePart, ToolPart, ReasoningPart, StepStartPart, StepFinishPart
])
```

### Reason
Minimal change. `FilePart` already exists and is used for user messages and tool results. Adding it to the assistant message union allows the model to emit file/media content as part of its response. No schema changes to FilePart itself.

### Downstream impact
- `toModelMessagesEffect()` already handles `FilePart` in any message — no change needed there
- TUI rendering already handles `FilePart` in user messages — need D.4 for assistant messages
- Database storage: FilePart serializes to JSON in the Part table — no migration needed

---

## D.2 — Handle provider `file` stream events

**File:** `packages/opencode/src/session/processor.ts` (MODIFY)
**Effort:** 30 min

### Location
In `handleEvent()` switch statement (~line 430), add before or after `case "tool-result"`:

### Code

```typescript
case "file": {
  // Provider emitted a file/media part in the response stream
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: ctx.assistantMessage.id,
    sessionID: ctx.sessionID,
    type: "file",
    mime: value.mediaType,
    url: value.url,
    filename: value.filename,
  } satisfies MessageV2.FilePart)
  return
}
```

### Reason
Some providers (via AI SDK) can emit `file` events in their stream — typically for generated images, audio synthesis results, or extracted data. This handler creates a `FilePart` in the assistant message, which the TUI then renders via the media components from Module C.

### Note
If the AI SDK doesn't emit `file` events for the current providers, this handler becomes forward-compatible. The `type: "file"` part in the assistant message can also be created by tool code that programmatically inserts media.

---

## D.3 — Capability-aware system prompt injection

**File:** `packages/opencode/src/session/system.ts` or `prompt.ts` (MODIFY)
**Effort:** 20 min

### Code (in `environment()` function or prompt assembly)

```typescript
function outputCapabilityLine(model: Provider.Model): string | undefined {
  const modalities = Object.entries(model.capabilities.output)
    .filter(([_, supported]) => supported)
    .map(([mod]) => mod)
  
  if (modalities.length <= 1) return undefined  // text-only = no injection
  
  return `Output modalities: ${modalities.join(", ")}`
}
```

### Where to inject
At the end of the system prompt, after skill descriptions:

```typescript
const system = [
  sessionIdBanner,
  ...rules,
  ...instructions,
  ...env,
  ...(skills ? [skills] : []),
  ...(outputCapabilityLine(model) ? [outputCapabilityLine(model)] : []),
]
```

### Example output
```
Output modalities: text, image
Output modalities: text, image, audio
```

### Reason
The 40+ multimodal models (GPT-5.1, Gemini 3 Pro Image, etc.) can output text + image + audio through the same endpoint. Without this hint, models default to text-only behavior. A single line at the end of the system prompt tells the model exactly what it can produce. 

Text-only models get nothing — no token waste.

---

## D.4 — Render FilePart in assistant messages

**File:** `packages/ui/src/components/message-part.tsx` (MODIFY, ~line 1400)
**Effort:** 30 min

### Code
In the assistant message renderer, add a `FilePart` handler:

```typescript
// In PART_MAPPING or similar:
file: (props) => {
  const part = () => props.part as FilePart
  
  if (part().mime.startsWith("image/")) {
    return <ImageDisplay url={part().url} mime={part().mime} />
  }
  if (part().mime.startsWith("video/")) {
    return <VideoCard url={part().url} metadata={part()} />
  }
  if (part().mime.startsWith("audio/")) {
    return <AudioCard url={part().url} metadata={part()} />
  }
  
  // Unknown file type — show as text reference
  return (
    <div data-slot="assistant-file">
      📎 {part().filename ?? part().mime}
    </div>
  )
}
```

### Reason
Currently `FilePart` only appears in user messages (rendered as image thumbnail or file icon) and tool results. Assistant-originated `FilePart` entries need the same rendering treatment, but in the assistant message bubble rather than the user bubble.

---

## D.5 — Update toModelMessagesEffect for assistant media

**File:** `packages/opencode/src/session/message-v2.ts` (MODIFY)
**Effort:** 20 min

### What changes
The `toModelMessagesEffect()` function converts message parts for provider consumption. Currently it handles `FilePart` in user messages (line ~860) and tool result attachments (line ~921). Assistant-originated `FilePart` entries need to be included when building conversation history for subsequent turns.

### Code
In the assistant message processing section (~line 890), add:

```typescript
if (part.type === "file") {
  // Assistant-generated media — include as file part in context
  if (options?.stripMedia) {
    assistantMessage.parts.push({
      type: "text",
      text: `[Generated ${part.mime}: ${part.filename ?? "media"}]`,
    })
  } else {
    assistantMessage.parts.push({
      type: "file",
      url: part.url,
      mediaType: part.mime,
      filename: part.filename,
    })
  }
}
```

### Reason
The model may need to reference media it generated in previous turns ("the image I generated earlier"). Without this, assistant-originated media is invisible in the conversation context for multi-turn interactions.
