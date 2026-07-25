# Module C+D — Media TUI + Multimodal Messages Plan

**Created:** 2026-06-24
**Parent:** `plans/20260623_agent_pipeline_media_plan.md`
**Status:** [x] Complete — implemented 2026-06-24. Typecheck clean. Modules C (all 4) + D (D.2, D.3, D.5) done. D.4 satisfied via C.4 FilePartRenderer.

---

## State Evidence Summary

**[Exact]** from explorer grounding:

| What | Where | Key fact |
|------|-------|----------|
| Terminal TUI tool rendering | `cli/cmd/tui/routes/session/index.tsx:1798` | `BlockTool` + `InlineTool` are local components using OpenTUI primitives (`<box>`, `<text>`) |
| Processor event switch | `processor.ts:339-658` | `handleEvent` handles 15 event types; no `"file"` case exists |
| System prompt assembly | `system.ts:106-142` | `environment()` returns string array; `capabilities()` lists tool capabilities but NOT output modalities |
| `toModelMessagesEffect` | `message-v2.ts:897-1027` | Assistant parts loop handles `text`, `tool`, `reasoning`, `step-start` — no `"file"` handling |
| `Model.capabilities.output` | `provider.ts:840-848` | Has `text`, `audio`, `image`, `video`, `pdf` booleans — already populated from models.dev |
| `FilePart` in `Part` union | `message-v2.ts:427-458` | Already present — D.1 is satisfied |
| `session.updatePart` | `processor.ts:605-616` | Pattern: construct `{ id, messageID, sessionID, type, ...fields }` → `yield* session.updatePart(...)` |
| `completeToolCall.attachments` | `processor.ts:255-279` | Tool results carry `FilePart[]` on `state.attachments` |
| Proven renderers | experiments | chafa `--format symbols --color-space rgb` works; mpv `--vo=tct`/`--vo=gpu`/`--vo=null` work |
| Web UI media | `packages/ui/src/components/` | `FileMedia`, `ImagePreview` — HTML-based, not applicable to terminal TUI |

## Architecture Note

The web UI (`packages/ui/`) and terminal TUI (`packages/opencode/src/cli/cmd/tui/`) use **completely different rendering primitives**:
- Web UI: SolidJS HTML (`<img>`, `<audio>`, `<div>`, CSS classes)
- Terminal TUI: OpenTUI components (`<box>`, `<text>`, `BlockTool`, `InlineTool`, ANSI colors)

Module C builds **terminal-native** media rendering via child processes (chafa, mpv, ffmpeg). The web UI's `FileMedia` component is not applicable.

---

## Module C — Terminal Media TUI (1.8h)

### C.1 — Image Display via chafa (30 min)

**File:** `packages/opencode/src/cli/cmd/tui/component/media-image.tsx` (NEW)

**Abstract:** Terminal-native image renderer. Writes data URL bytes to temp file, spawns `chafa --format symbols --color-space rgb`, captures text output, renders inline.

**Why new location:** `cli/cmd/tui/component/` is where terminal-specific components live (31 component files: `todo-item.tsx`, `dialog-session-rename.tsx`, etc.). `packages/ui/` is for web UI. **[Exact] confirmed by explorer.**

**Dependency note:** chafa, mpv, ffmpeg are **external system tools** (not npm packages). Use the codebase `which()` util (`src/util/which.ts`) + `ChildProcessSpawner` from Effect instead of raw `execSync`. Pattern: `yield* Effect.sync(() => which("chafa"))` → if not found, return graceful error message.

**Input:** `{ url: string, mime: string }` — FilePart data URL

**Implementation:**
```typescript
// Node.js APIs (available in Bun)
import { writeFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { execSync } from "child_process"
import { join } from "path"

function renderImageViaChafa(url: string): string {
  const ext = url.startsWith("data:image/png") ? ".png"
    : url.startsWith("data:image/jpeg") ? ".jpg"
    : url.startsWith("data:image/webp") ? ".webp"
    : url.startsWith("data:image/gif") ? ".gif"
    : ".png"
  const tmpFile = join(tmpdir(), `opencode_img_${Date.now()}${ext}`)
  const base64 = url.split(",")[1]
  if (!base64) return "[Image: invalid data URL]"
  writeFileSync(tmpFile, Buffer.from(base64, "base64"))
  const cols = process.stdout.columns ?? 80
  const rows = Math.floor((process.stdout.rows ?? 24) * 0.5)
  try {
    const output = execSync(
      `chafa --format symbols --color-space rgb --size ${cols}x${rows} "${tmpFile}"`,
      { encoding: "utf-8", timeout: 5000, maxBuffer: 1024 * 1024 },
    )
    return output
  } catch {
    return "[Image: chafa not available — install chafa for terminal image rendering]"
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}
```

**Rendering:** Returns text (Unicode block characters with ANSI colors). Rendered inside a `BlockTool` as `<text>` — the ANSI escape sequences in chafa output render natively in the terminal.

**Oracle:** Manual test with a PNG data URL. Verify chafa symbols appear in terminal.

---

### C.2 — Video Display via mpv + ffmpeg (30 min)

**File:** `packages/opencode/src/cli/cmd/tui/component/media-video.tsx` (NEW)

**Abstract:** Two modes: (1) thumbnail via ffmpeg frame extraction → chafa, (2) [Play] button spawns mpv in external window. Metadata card shows duration/dimensions/fps.

**Input:** `{ url: string, metadata?: { duration?: number, width?: number, height?: number, fps?: number } }`

**Implementation:**
```typescript
// Extract first keyframe as PNG → chafa symbols
function renderVideoThumbnail(url: string): string {
  const tmpImg = join(tmpdir(), `opencode_vthumb_${Date.now()}.png`)
  const tmpFile = writeDataUrlToFile(url)
  try {
    execSync(`ffmpeg -y -i "${tmpFile}" -vframes 1 -f image2 "${tmpImg}"`, { timeout: 10000 })
    const cols = process.stdout.columns ?? 80
    const rows = Math.floor((process.stdout.rows ?? 24) * 0.3)
    return execSync(`chafa --format symbols --color-space rgb --size ${cols}x${rows} "${tmpImg}"`, { encoding: "utf-8" })
  } catch {
    return "[Video thumbnail unavailable]"
  } finally {
    try { unlinkSync(tmpImg) } catch {}
    try { unlinkSync(tmpFile) } catch {}
  }
}

function playVideo(url: string) {
  const tmpFile = writeDataUrlToFile(url)
  exec(`start "" mpv --vo=gpu "${tmpFile}"`)
}
```

**Rendering:** `BlockTool` with thumbnail + metadata + [Play] button (rendered as clickable text region).

---

### C.3 — Audio Display via mpv (20 min)

**File:** `packages/opencode/src/cli/cmd/tui/component/media-audio.tsx` (NEW)

**Abstract:** Metadata card (duration, sample rate, channels, codec) + [Play] spawns mpv with `--vo=null`.

**Input:** `{ url: string, metadata?: { duration?: number, sampleRate?: number, channels?: number, codec?: string } }`

**Rendering:** `BlockTool` with metadata lines + [Play] button.

---

### C.4 — Media Routing in TUI Session (30 min)

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (MODIFY)

**Abstract:** Detect media attachments on tool results and assistant FileParts, route to C.1-C.3 components.

**[Exact] Correction from explorer:** The tool Switch (line 1626) dispatches on `props.part.tool` (tool name), NOT part type. Assistant message parts use `PART_MAPPING` (line 1515). The plan has two distinct integration points:

**Location 1 — Tool result attachments:** Modify `GenericTool` (line 1691) — the catch-all tool renderer. After tool output text, check `props.part.state?.attachments` and render media components inline:

```tsx
// Inside GenericTool, after output text, before closing BlockTool:
<Show when={attachments().length > 0}>
  <For each={attachments()}>
    {(att) => (
      <Switch>
        <Match when={att.mime.startsWith("image/")}>
          <MediaImage url={att.url} mime={att.mime} />
        </Match>
        <Match when={att.mime.startsWith("video/")}>
          <MediaVideo url={att.url} metadata={att} />
        </Match>
        <Match when={att.mime.startsWith("audio/")}>
          <MediaAudio url={att.url} metadata={att} />
        </Match>
      </Switch>
    )}
  </For>
</Show>
```

**Location 2 — Assistant FilePart:** Add to `PART_MAPPING` (line 1515-1519):
```tsx
const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
  file: FilePartRenderer,  // NEW
}
```

Create a `FilePartRenderer` component with internal media-type Switch:
```tsx
function FilePartRenderer(props: { part: FilePart }) {
  return (
    <Switch>
      <Match when={props.part.mime.startsWith("image/")}>
        <MediaImage url={props.part.url} mime={props.part.mime} />
      </Match>
      <Match when={props.part.mime.startsWith("video/")}>
        <MediaVideo url={props.part.url} metadata={props.part} />
      </Match>
      <Match when={props.part.mime.startsWith("audio/")}>
        <MediaAudio url={props.part.url} metadata={props.part} />
      </Match>
      <Match when={true}>
        <text fg={theme.textMuted}>[File: {props.part.filename ?? props.part.mime}]</text>
      </Match>
    </Switch>
  )
}
```

---

## Module D — Multimodal Messages (1.6h)

### D.1 — FilePart in AssistantMessage → [x] Already satisfied

**[Exact]** `FilePart` is in the unified `Part` union at `message-v2.ts:427-458`. No change needed. The `Part` type is used for both user and assistant messages.

---

### D.2 — `case "file"` Stream Event Handler (30 min)

**File:** `packages/opencode/src/session/processor.ts` (MODIFY, ~line 434, between `tool-error` and `error`)

**Abstract:** Handle provider-emitted `file` stream events by creating a `FilePart` in the current assistant message.

**Implementation:**
```typescript
case "file": {
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: ctx.assistantMessage.id,
    sessionID: ctx.assistantMessage.sessionID,
    type: "file",
    mime: (value as any).mediaType ?? (value as any).mime ?? "application/octet-stream",
    url: (value as any).url ?? "",
    filename: (value as any).filename,
  } satisfies MessageV2.FilePart)
  return
}
```

**Oracle:** Unit test with mock `file` stream event → verify FilePart created in session.

---

### D.3 — Output Modalities in System Prompt (20 min)

**File:** `packages/opencode/src/session/system.ts` (MODIFY, ~line 106, inside `capabilities()` or as new section)

**Abstract:** Append a single line `Output modalities: text, image` to the system prompt when model.capabilities.output has more than just `text` enabled.

**[Exact] Correction from explorer:** `capabilities()` (lines 106-124) is a static function with no model parameter — it lists tool capabilities. The modality line must be computed in `environment(model)` (line 127) and appended AFTER `capabilities()` at line 140.

**Implementation (in `environment(model)`, line 127-142):**
```typescript
environment(model) {
  const project = Instance.project
  const family = resolvePrompt(model).family
  const outputModalityLine = ((): string | undefined => {
    const out = model.capabilities.output
    const modalities = Object.entries(out)
      .filter(([_, supported]) => supported)
      .map(([mod]) => mod)
    if (modalities.length <= 1 && out.text) return undefined
    return `Output modalities: ${modalities.join(", ")}`
  })()
  return [
    [
      `You are a ${family} coding assistant.`,
      // ... env block ...
      capabilities(),
      ...(outputModalityLine ? [outputModalityLine] : []),
    ].join("\n"),
  ]
}
```

**Why last line:** Minimal token cost (~5 tokens), maximal signaling. Placed after all other system content so it's fresh in context.

**Oracle:** Verify system prompt includes `Output modalities: text, image` for GPT-5.1 model; verify absent for text-only models.

---

### D.4 — Assistant FilePart TUI Rendering (30 min)

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (MODIFY)

Already addressed in C.4 Location 2 above — the assistant message part renderer detects `type === "file"` and routes to `MediaImage`/`MediaVideo`/`MediaAudio`. This task is to verify the C.4 routing works end-to-end with actual FilePart data.

**Oracle:** Manual test — assistant generates an image, TUI renders it via chafa.

---

### D.5 — `toModelMessagesEffect` for Assistant Media (20 min)

**[Exact] Verified by explorer:** The loop at line 909 iterates `msg.parts` with 4 if-checks: `"text"` (910), `"step-start"` (916), `"tool"` (920), `"reasoning"` (996).

**File:** `packages/opencode/src/session/message-v2.ts` (MODIFY, after line 998, before loop closing brace at 1003)

**Abstract:** When building conversation history for the model, include assistant-originated `FilePart` entries so the model can reference "the image I generated earlier."

**Implementation:**
```typescript
// Inside the for (const part of msg.parts) loop for assistant messages:
if (part.type === "file") {
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

**Oracle:** Verify multi-turn conversation includes `type: "file"` parts in assistant messages for the model.

---

## Implementation Order

```
C.1 (chafa image) ── C.2 (video) ── C.3 (audio) ── C.4 (routing)
                                                          │
                      D.2 (file event) ── D.3 (system prompt) ── D.5 (toModelMessages)
                                                          │
                      D.4 (assistant TUI) — blocked on C.4
```

**Parallelizable:** C.1, C.2, C.3 can start in parallel. D.2 + D.3 can start in parallel with C.

| Module | Tasks | Effort |
|--------|-------|--------|
| C (Media TUI) | C.1 + C.2 + C.3 + C.4 | 1.8h |
| D (Multimodal) | D.2 + D.3 + D.4 + D.5 | 1.6h |
| **Total** | | **~3.4h** |

---

## Verification

1. `bun typecheck` — `packages/opencode` zero errors
2. C.1: chafa renders a test PNG inline in terminal
3. C.2: mpv plays a test video; thumbnail appears
4. C.3: mpv plays a test audio; metadata card appears
5. C.4: Tool result with image attachment renders via chafa
6. D.2: `"file"` stream event creates FilePart in session
7. D.3: System prompt shows `Output modalities: text, image` for multimodal models
8. D.4: Assistant-originated FilePart renders inline in TUI
9. D.5: Multi-turn conversation includes assistant media in context
