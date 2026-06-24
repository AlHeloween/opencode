# C — Media TUI Rendering

**Parent:** `plans/20260623_agent_pipeline_media_plan.md`
**Status:** [x] Complete — implemented 2026-06-24  
**Effort:** 1.8h

**Smoke-tested:** chafa `--format symbols --color-space rgb` works. mpv `--vo=tct`/`--vo=gpu`/`--vo=null` work. Kitty/sixel do NOT render on Windows Terminal.

---

## Abstract Definition

Render non-text tool outputs (images, audio, video) in the terminal UI via child processes. Single renderer per modality with zero escape-sequence encoding.

---

## Proven Rendering Matrix (2026-06-23 experiments)

| Content | Renderer | Command |
|---------|----------|---------|
| Image (inline) | chafa symbols | `chafa --format symbols --color-space rgb --size {W}x{H} {file}` |
| Video (inline preview) | mpv tct | `mpv --vo=tct --tct-algo=half-blocks --no-audio --length=5 {file}` |
| Video (full) | mpv gpu | `start "" mpv --vo=gpu {file}` |
| Audio (play) | mpv null | `mpv --vo=null {file}` |
| Video thumbnail | ffmpeg + chafa | Extract frame → chafa |

---

## Structural Diagram

```
Tool result with attachments[]
  │
  ▼
ToolPartDisplay (message-part.tsx)
  │  detects part.state.attachments[].mime
  ├── image/* ──→ ImageDisplay ──→ chafa symbols → terminal
  ├── video/* ──→ VideoCard     ──→ ffmpeg frame → chafa thumbnail
  │                               └─→ [Play] spawns mpv --vo=gpu
  ├── audio/* ──→ AudioCard     ──→ metadata (duration, rate, channels)
  │                               └─→ [Play] spawns mpv --vo=null
  └── other     ──→ filename badge
```

```
Assistant message FilePart
  │
  ▼
AssistantMessageDisplay (message-part.tsx)
  │  detects part.type === "file"
  ├── image/* ──→ ImageDisplay
  ├── video/* ──→ VideoCard
  ├── audio/* ──→ AudioCard
  └── other    ──→ file icon + name
```

---

## C.1 — Image Display (chafa)

**File:** `packages/ui/src/components/media/image.tsx` (NEW)
**Effort:** 30 min

### Code

```typescript
import { createMemo } from "solid-js"

export function ImageDisplay(props: { url: string; mime: string }) {
  // FilePart.url is a data URL (data:image/png;base64,...)
  // Write to temp file, spawn chafa, capture output
  
  const spawnChafa = async () => {
    const fs = require("fs")
    const path = require("path")
    const tmpDir = require("os").tmpdir()
    const tmpFile = path.join(tmpDir, `opencode_img_${Date.now()}.png`)
    
    // Decode data URL and write to temp file
    const base64 = props.url.split(",")[1]
    const buf = Buffer.from(base64, "base64")
    fs.writeFileSync(tmpFile, buf)
    
    // Get terminal size
    const cols = process.stdout.columns ?? 80
    const rows = Math.floor((process.stdout.rows ?? 24) * 0.6)
    
    // Spawn chafa
    const { execSync } = require("child_process")
    try {
      const output = execSync(
        `chafa --format symbols --color-space rgb --size ${cols}x${rows} "${tmpFile}"`,
        { encoding: "utf-8", timeout: 5000 }
      )
      fs.unlinkSync(tmpFile)
      return output
    } catch {
      fs.unlinkSync(tmpFile)
      return "[Image: could not render]"
    }
  }
  
  createMemo(() => {
    // Schedule async render, update component state
  })
  
  return <div data-slot="media-image">{/* rendered output */}</div>
}
```

**Note:** The chafa output is text (block characters with ANSI colors), so it renders naturally in the terminal via the existing `pre` code block.

---

## C.2 — Video Display (mpv + ffmpeg)

**File:** `packages/ui/src/components/media/video.tsx` (NEW)  
**Effort:** 30 min

### Code

```typescript
export function VideoCard(props: { url: string; metadata?: Record<string, any> }) {
  // Show thumbnail via ffmpeg + chafa, plus [Play] button
  
  return (
    <div data-slot="media-video">
      <div data-slot="media-video-thumb">
        {/* ffmpeg extract keyframe → chafa symbols */}
      </div>
      <div data-slot="media-video-info">
        Duration: {props.metadata?.duration ?? "?"} | 
        {props.metadata?.width}x{props.metadata?.height} | 
        {props.metadata?.fps ?? "?"}fps
      </div>
      <button data-slot="media-video-play"
        onClick={() => spawnPlayer(props.url)}>
        ▶ Play
      </button>
    </div>
  )
}

function spawnPlayer(url: string) {
  const { exec } = require("child_process")
  exec(`start "" mpv --vo=gpu "${url}"`)
}
```

---

## C.3 — Audio Display (mpv)

**File:** `packages/ui/src/components/media/audio.tsx` (NEW)
**Effort:** 20 min

```typescript
export function AudioCard(props: { url: string; metadata?: Record<string, any> }) {
  return (
    <div data-slot="media-audio">
      <div data-slot="media-audio-icon">🔊</div>
      <div data-slot="media-audio-info">
        {props.metadata?.duration ?? "?"}s |
        {props.metadata?.sampleRate ?? "?"}Hz |
        {props.metadata?.channels ?? "?"}ch |
        {props.metadata?.codec ?? "?"}
      </div>
      <button onClick={() => spawnAudio(props.url)}>▶ Play</button>
    </div>
  )
}

function spawnAudio(url: string) {
  const { exec } = require("child_process")
  exec(`mpv --vo=null --really-quiet "${url}"`)
}
```

---

## C.4 — Message-Part Media Routing

**File:** `packages/ui/src/components/message-part.tsx` (MODIFY, ~line 1301)
**Effort:** 30 min

### Code

```typescript
// In ToolPartDisplay, after existing tool render logic:

// Check for media attachments on completed tool results
const attachments = createMemo(() => 
  part().state?.attachments ?? []
)

// Render media if attachments present
if (attachments().length > 0) {
  const mediaElements = attachments().map((att) => {
    if (att.mime.startsWith("image/"))
      return ImageDisplay({ url: att.url, mime: att.mime })
    if (att.mime.startsWith("video/"))
      return VideoCard({ url: att.url, metadata: att })
    if (att.mime.startsWith("audio/"))
      return AudioCard({ url: att.url, metadata: att })
    return null
  }).filter(Boolean)
  
  // Render alongside tool output
}
```

### Reason
Tool results with `attachments[]` currently show as plain text. This routing detects mime types and delegates to chafa/mpv components, keeping the tool card UI intact. The existing `BasicTool`/`Dynamic` pattern is preserved — media content renders inside the tool card alongside the text output.
