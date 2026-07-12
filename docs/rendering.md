# Rendering Pipeline — LLM Response → Terminal Display

**Status:** production  
**Last Updated:** 2026-07-12

---

## 1. Overview

The rendering pipeline has **two distinct paths**:

| Path | Target | Framework | Key Libraries |
|------|--------|-----------|---------------|
| **TUI (OpenTUI)** | CLI terminal | SolidJS + OpenTUI custom renderables | `@opentui/core`, `@opentui/solid`, `@opentui/three` |
| **Web/Desktop** | HTML DOM | SolidJS/React + marked + DOMPurify | `marked`, `DOMPurify`, `remend` |

The TUI path is the primary rendering pipeline for the interactive CLI. This document traces the **end-to-end flow from LLM response → terminal display**.

---

## 2. End-to-End Data Flow

```
LLM Provider Response
  │
  ▼
Session Processor (processor.ts:695-748)
  └─ text-delta event → session.updatePartDelta()
       │
       ▼
Bus (bus/index.ts:80)
  └─ publish via typed PubSub + GlobalBus.emit()
       │
       ▼
SDK SSE Stream (sdk.tsx:100-103)
  └─ event → handleEvent → 16ms batch queue → emitter.emit("event", event)
       │
       ▼
Sync Store (sync.tsx:229)
  └─ event.subscribe → switch(event.type)
       ├─ "message.part.delta" (sync.tsx:448-488):
       │     deltaBuffer → Binary.search → produce → setStore
       ├─ "message.part.updated" (sync.tsx:423-445):
       │     Binary.search → reconcile → setStore
       └─ "message.part.removed" (sync.tsx:491-503)
            │
            ▼
SolidJS Reactivity
  └─ createMemo → store.part[messageID]
       │
       ▼
Session Route (index.tsx:1244)
  └─ <For each={messagesList()}>
       ├─ UserMessage (index.tsx:1317): plain text + file badges
       └─ AssistantMessage (index.tsx:1343)
            └─ <For each={props.parts}>
                 ├─ TextPart (index.tsx:1697-1805):
                 │     splitTextSegments → <code filetype="markdown"> or <markdown>
                 │     └─ tree-sitter syntax highlighting + streaming fallback
                 ├─ ReasoningPart (index.tsx:1664-1695):
                 │     <code filetype="markdown"> dimmed, [REDACTED] stripped
                 └─ ToolPart (index.tsx:1809-2712):
                       ├─ InlineTool (index.tsx:1992): compact icon+text
                       └─ BlockTool (index.tsx:2061): bordered, expandable
                            └─ <diff> for edits, <code> for writes, nested media
                              │
                              ▼
OpenTUI Core (@opentui/core)
  └─ CliRenderer → targetFps:30 → render loop
       └─ ScrollBoxRenderable for scrollable content (stickyScroll="bottom")
            └─ ThreeRenderable for 3D image planes
                 └─ Kitty/Sixel/Symbols escape codes
                      │
                      ▼
Terminal Output
```

---

## 3. Stage-by-Stage Details

### Stage A: Provider Streaming → Session Processor

**File:** `packages/opencode/src/session/processor.ts`

| Line | Event Type | Handler | What it does |
|------|-----------|---------|-------------|
| 695-713 | `text-start` | `case "text-start"` | Creates `ctx.currentText` part, calls `session.updatePart()` → publishes `message.part.updated` |
| 716-727 | `text-delta` | `case "text-delta"` | Appends text to `StringBuilder`, calls `session.updatePartDelta()` → publishes `message.part.delta` via bus |
| 729-748 | `text-end` | `case "text-end"` | Finalizes text part with `ctx.textBuilder.toString()`, triggers `experimental.text.complete` plugin hook |
| 402-421 | `reasoning-start` | `case "reasoning-start"` | Creates reasoning part in `ctx.reasoningMap` |
| 424-435 | `reasoning-delta` | `case "reasoning-delta"` | Appends to `StringBuilder`, calls `updatePartDelta()` |
| 437-439 | `reasoning-end` | `case "reasoning-end"` | Finalizes reasoning part |

### Stage B: Session → Event Bus

**File:** `packages/opencode/src/session/session.ts`

| Method | Line | What it publishes | Event Type |
|--------|------|-------------------|------------|
| `updatePart` | 633-646 | `SyncEvent.run(MessageV2.Event.PartUpdated, ...)` — persists to DB + bus | `message.part.updated` |
| `updatePartDelta` | 807-815 | `bus.publish(MessageV2.Event.PartDelta, input)` — live streaming only (no DB write) | `message.part.delta` |

**File:** `packages/opencode/src/bus/index.ts`
- `publish()` (line 80): Publishes event to typed PubSub AND wildcard PubSub AND `GlobalBus.emit()`
- `subscribe()` / `subscribeAll()`: Stream-based subscriptions

### Stage C: Event Bus → SDK Client → TUI

**Files:**
- `packages/opencode/src/cli/cmd/tui/context/sdk.tsx` — SSE connection (line 128: `startSSE()`)
- `packages/opencode/src/cli/context/event.ts` — Event subscription

Key behavior:
1. **sdk.tsx:128**: `startSSE()` initiates SSE stream via `sdk.global.event()`
2. **sdk.tsx:100-103**: Each event → `handleEvent(event)`
3. **sdk.tsx:66-78**: Events queued with **16ms batch window**, flushed in SolidJS `batch()` call
4. **event.ts:9-31**: `useEvent().subscribe()` subscribes via `sdk.event.on("event", ...)`, filters by workspace/directory

### Stage D: TUI Sync Store → SolidJS Reactivity

**File:** `packages/opencode/src/cli/cmd/tui/context/sync.tsx`

The sync store receives events and updates the SolidJS store:

| Event Type | Handler (line) | Store Mutation | Notes |
|------------|---------------|----------------|-------|
| `message.part.updated` | 423-445 | `setStore("part", messageID, index, reconcile(...))` | Flushes delta buffer for this messageID |
| `message.part.delta` | 448-488 | `setStore("part", messageID, produce(...))` | Guarded by `DELTA_SAFE_FIELDS` (line 122): `["text", "output"]` |
| `message.updated` | 366-408 | Updates store.message[sessionID][index], evicts oldest if > 100 | Eviction only if no active parts |
| `message.removed` | 409-421 | Removes from `store.message` | — |
| `session.diff` | 313-315 | Stores `store.session_diff` | — |
| `session.deleted` | 317-344 | Cleans up **all** orphaned session-keyed stores | Prevents RSS leak (was causing 1.18 GB Bun segfault on Windows) |

**Delta buffering** (sync.tsx:114-153): If a delta event arrives before the part is created, it's buffered in `deltaBuffer` (Map<messageID, Map<partID, accumulatedText>). When the part arrives via `part.updated`, `flushDeltaBuffer()` is called to apply buffered content.

---

## 4. TUI Rendering Components

### 4a. App Entry Point

**File:** `packages/opencode/src/cli/cmd/tui/app.tsx`

| Line | What it does |
|------|-------------|
| 78 | `extend({ "image-plane": TexturePlaneRenderable })` — registers custom 3D image renderable |
| 84 | `targetFps: 30` — rendering rate |
| 145-146 | `createCliRenderer(config)` + `renderer.waitForThemeMode(1000)` — initialize OpenTUI renderer |

**Provider tree** (lines 153-208):
```
ErrorBoundary → Args → Exit → KV → Toast → Route → TuiConfig
  → SDK → Project → Sync → Theme → Local → Keybind → PromptStash
    → Dialog → Command → Frecency → PromptHistory → PromptRef
      → EditorContext → App
```

### 4b. Session Route — Main Display View

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
**Size:** 2775 lines (largest component file)

| Line | Component | Role |
|------|-----------|------|
| 104 | `addDefaultParsers(parsers.parsers)` | Registers 28 tree-sitter parsers for syntax highlighting |
| 1222-1419 | `<box>` layout | Root flex container: messages + sidebar |
| 1225-1252 | `<scrollbox>` | Scrollable message container, `stickyScroll="bottom"` |
| 1244 | `<For each={messagesList()}>` | Iterates over messages |
| 1317 | `<UserMessage>` | Renders user messages with file badges, compaction markers |
| 1343 | `<AssistantMessage>` | Renders assistant messages with parts loop |
| 1657-1662 | `PART_MAPPING` | Maps part types to renderer components |

### 4c. Part Rendering Components

#### TextPart (index.tsx:1697-1805) — Primary text rendering

The core streaming text renderer. Key behavior:

1. **Line 1701**: `splitTextSegments(props.part.text)` — splits on `` ```mermaid `` fences into `TextSegment[]`
2. **Lines 1706-1728**: **Progressive mermaid rendering** — renders each completed mermaid block as soon as its fence closes, instead of waiting for the entire part to finalize. Uses `renderedSources` Map to avoid re-rendering unchanged blocks.
3. **Lines 1734-1801**: For each segment:
   - **Markdown segment**: `<code filetype="markdown">` with `streaming=true`, tree-sitter highlighting, **markdown stream healing** via `healMarkdown()`
   - **Mermaid segment**: `<image-plane>` once rendered, raw text fallback during rendering

**Streaming highlight fallback** (index.tsx:1757-1788): Persists last known good highlights. Tree-sitter frequently returns zero highlights for incomplete markdown mid-stream. When that happens, `@opentui/core`'s CodeRenderable overwrites the styled text buffer with plain text. The fallback returns last known highlights, keeping the styled path active.

#### healMarkdown() (index.tsx, before 1697) — Markdown stream healing

Closes unclosed formatting before tree-sitter processing:
- Closes `**bold**`, `*italic*`, `~~strikethrough~~`, `` `inline code` ``
- Operates on text **outside** code blocks (strips fenced/inline code before counting)
- Drastically reduces zero-highlights events during streaming

#### ReasoningPart (index.tsx:1664-1695)

- Strips `[REDACTED]` from OpenRouter reasoning (line 1670)
- Renders as `<code filetype="markdown">` with `streaming=true`, muted colors, dimmed border
- Controlled by `ctx.showThinking()` toggle

#### ToolPart (index.tsx:1809-2712)

Uses `PART_MAPPING` with tool-specific renderers:

| Tool | Handler (line) | Display |
|------|---------------|---------|
| bash | 2108 | Full output with expand/collapse (10 line threshold) |
| write | 2175 | Code content with line numbers + diagnostics |
| edit | 2476 | Diff view (`<diff>` renderable) — split/unified auto-detect |
| multiedit | 2658 | Multi-diff stacked display |
| read | 2217 | File paths + inline attachment previews |
| grep | 2271 | Pattern + match count |
| glob | 2206 | Pattern + match count |
| webfetch | 2282 | URL + attachment previews |
| task | 2406 | Sub-agent progress, toolcalls, duration |
| question | 2624 | Questions + answers display |
| todowrite | 2603 | Todo list with status checkboxes |

**Inline vs Block tools:**
- `InlineTool` (line 1992): Compact single-line display with icon, spinner, hover
- `BlockTool` (line 2061): Full-width bordered display with expand/collapse

---

## 5. MarkdownRenderable Internals (@opentui/core)

**File:** `node_modules/@opentui/core/renderables/Markdown.d.ts` (types)  
**Implementation:** Bundled in `@opentui/core/index.js` (~388 KB)  
**Status:** patched via bun `patchedDependencies` — see `patches/@opentui%2Fcore@0.4.3.patch`

The TUI has two rendering paths for markdown, controlled by `Flag.OPENCODE_MARKDOWN` (default `true`):

| Path | Component | Tokenizer | Inline Formatting |
|------|-----------|-----------|-------------------|
| **New** (default) | `<markdown>` → `MarkdownRenderable` | `marked@17` (`gfm: true`) | `renderInlineContent()` on marked tokens |
| **Legacy** | `<code filetype="markdown">` → `CodeRenderable` | tree-sitter markdown grammar | tree-sitter `highlights.scm` queries |

### 5a. MarkdownRenderable Architecture

```
Assistant text content
  │
  ├── splitTextSegments(): mermaid fences only
  │   └── non-mermaid → { type: "markdown", text }
  │
  └── MarkdownRenderable.renderSelf()
        │
        ├── parseMarkdownIncremental(newContent, prevState, trailingUnstable)
        │     └── marked Lexer.lex(newContent, { gfm: true })
        │           → MarkedToken[] (heading, list, paragraph, table, code, etc.)
        │
        └── internalBlockMode?
              │
              ├── "coalesced" (default) ───────────────────────────────────┐
              │   └── buildRenderableTokens(tokens)                        │
              │         │                                                  │
              │         ├── shouldRenderSeparately(token)?                 │
              │         │     ├── code / table / blockquote / hr           │
              │         │     │   └── flush raw buffer → render separately │
              │         │     ├── heading / list (PATCHED)                 │
              │         │     │   └── flush raw buffer → render separately │
              │         │     └── paragraph / space / others               │
              │         │           └── accumulate into markdownRaw        │
              │         │                                                  │
              │         └── remaining raw → createMarkdownBlockToken()     │
              │               → type:"paragraph", tokens:[] (FLAT)         │
              │                                                  │
              └── "top-level" ──────────────────────────────────┤
                  └── buildTopLevelRenderBlocks(tokens)         │
                        └── each block keeps its token identity │
                                                                 │
                    ┌────────────────────────────────────────────┘
                    ▼
          createDefaultRenderable(token, index, nextToken)
                │
                ├── code     → createCodeRenderable()
                ├── blockquote → createBlockquoteRenderable()
                ├── list     → createListRenderable()
                │               └── per item → createListItemRenderable()
                │                     └── per child → createListChildRenderable()
                │                           → createMarkdownCodeRenderable(...)
                ├── hr       → createHorizontalRuleRenderable()
                ├── table    → createTableBlock() → TextTableRenderable
                └── heading / paragraph → createMarkdownCodeRenderable(raw, ..., initialStyledText)
                                              │
                                              └── CodeRenderable
                                                    │
                                                    ├── streaming: true (hardcoded)
                                                    ├── initialStyledText? ─┬─ styled → drawUnstyledText: true
                                                    │                       └─ undefined → drawUnstyledText: false
                                                    └── tree-sitter async highlight
                                                          └── success → styled text via highlights
                                                          └── failure → plain text fallback
```

### 5b. Token Dispatch Table

`shouldRenderSeparately(token)` controls which block types get individual renderables vs being coalesced into raw text:

| Token Type | `shouldRenderSeparately` | Render Path | Inline Tokens Preserved? |
|------------|-------------------------|-------------|--------------------------|
| `code`     | ✅ `true` | `CodeRenderable` (syntax-highlighted) | N/A (code block) |
| `table`    | ✅ `true` | `TextTableRenderable` via `marked` token tree | ✅ Yes — `renderInlineContent` per cell |
| `blockquote` | ✅ `true` | `BoxRenderable` with left border → `CodeRenderable` | ❌ No — uses token.raw → tree-sitter |
| `hr`       | ✅ `true` | `BoxRenderable` with top border | N/A |
| `heading`  | ✅ `true` (patched) | `createMarkdownCodeRenderable(raw, ..., initialStyledText)` | ✅ Yes — marked inline tokens → `createInitialStyledText` |
| `list`     | ✅ `true` (patched) | `createListRenderable()` → per-item `createListChildRenderable()` | ✅ Yes — marked inline tokens in each paragraph/text child |
| `paragraph` | ❌ `false` (coalesced) | Accumulated into flat raw → single `CodeRenderable` | ⚠️ Partial — via `x.lexInline()` fallback when streaming guard removed |

### 5c. Coalescing Behavior and Impact

In `buildRenderableTokens()` (default coalesced mode), non-separate tokens are concatenated into a single raw string via `markdownRaw += token.raw`. A synthetic `paragraph` token with `tokens: []` is created from the combined raw text. This:

- **Destroys all inline token structure** — `strong`, `em`, `codespan`, `link` tokens are lost
- **Lists lose their hierarchical structure** — markers, nesting, item boundaries are flattened
- **Headings lose their depth and inline tokens** — the `###` prefix and inline bold/italic become raw text

The coalesced raw string is passed to `createMarkdownCodeRenderable()` which creates a `CodeRenderable` with `filetype: "markdown"`. This CodeRenderable depends on **tree-sitter's markdown grammar** to recover the formatting from the raw text.

### 5d. Streaming Guard (createInitialStyledText)

`createInitialStyledText(token)` generates pre-computed styled text from marked's inline tokenizer:

```javascript
createInitialStyledText(token) {
    // streaming guard removed (PATCHED) — now runs for all content
    const chunks = [];
    if ("tokens" in token && Array.isArray(token.tokens)) {
        this.renderInlineContent(token.tokens, chunks);  // from marked tokens
    }
    if (chunks.length === 0 && "text" in token && typeof token.text === "string") {
        this.renderInlineContent(x.lexInline(token.text), chunks);  // inline re-parse
    }
    return chunks.length > 0 ? new StyledText(chunks) : undefined;
}
```

When `initialStyledText` is provided to `createMarkdownCodeRenderable()`:
- `drawUnstyledText: true` — CodeRenderable immediately renders the pre-computed styled text
- Content is **visible immediately** without waiting for async tree-sitter highlighting
- Inline formatting (`**bold**`, `*italic*`, `` `code` ``) is rendered correctly

When `initialStyledText` is `undefined`:
- `drawUnstyledText: false` — CodeRenderable's `_shouldRenderTextBuffer` is set to `false`
- Content is **invisible** until tree-sitter highlighting completes asynchronously
- If tree-sitter highlighting fails, falls back to plain text

**Pre-patch:** The streaming guard (`if (!this._streaming) return;`) prevented `initialStyledText` from being generated for static (non-streaming) content, leaving all non-separately-rendered blocks dependent on tree-sitter for inline formatting.

### 5e. renderInlineContent — Inline Token Rendering

Maps marked inline token types to OpenTUI styled text chunks:

| Marked Inline Token | Styled Text Chunk(s) | Concealed? |
|--------------------|---------------------|------------|
| `text` | `default` chunk | — |
| `strong` | `markup.strong` wrapper + child tokens | `**` markers concealed when `conceal: true` |
| `em` | `markup.italic` wrapper + child tokens | `*` markers concealed |
| `codespan` | `markup.raw` chunk | `` ` `` markers concealed |
| `del` | `markup.strikethrough` wrapper | `~~` markers concealed |
| `link` | `markup.link` + `markup.link.label` + `markup.link.url` | URL hidden when `conceal: true` |

### 5f. Known Issues and Edge Cases

| Issue | Context | Workaround |
|-------|---------|------------|
| Inline formatting in coalesced paragraphs | Coalesced `paragraph` tokens have `tokens: []`, so `renderInlineContent` falls through to `x.lexInline(raw)` | `x.lexInline` fully handles inline formatting from raw text |
| Consecutive paragraphs without separation | Multiple paragraphs without intervening separate blocks accumulate into one raw block | Add an explicit flush on double-newline within `buildRenderableTokens` |
| List item paragraph margin | List items use `marginTop: /\n[ \t]*\n$/.test(item.raw) ? 1 : 0` — double-newline inside item adds paragraph break | Controlled by marked's list item tokenization |
| tree-sitter highlight failure | If markdown highlight query file is missing or parser fails to load | `ensureVisibleTextBeforeHighlight` sets `textBuffer.setText(content)` as plain text |
| Zero-highlights during streaming | Incomplete markdown mid-stream produces zero tree-sitter highlights | `onHighlight` callback in `index.tsx` preserves last known good highlights |

### 5g. Incremental Parsing for Streaming

`parseMarkdownIncremental()` reuses previous parse state by matching `token.raw` at character offsets:

1. Compares `newContent.startsWith(token.raw, offset)` for each previous token
2. Reuses matching tokens up to `reuseCount`
3. Subtracts `trailingUnstable` (default `2` when `streaming: true`) from reuseCount
4. Re-parses only the remaining `newContent.slice(offset)` with `x.lex()`

The `trailingUnstable` parameter:
- `streaming: true` → `trailingUnstable = 2` — last 2 tokens always re-parsed
- `streaming: false` → `trailingUnstable = 0` — all matching tokens are stable

## 6. Mermaid Diagram Rendering

### Pipeline

```
Mermaid source
  → renderMermaidToPngDataUrl (mermaid.ts:47)
    → renderMermaidToSvg (mermaid.ts:20) — mermaid-wasm-renderer WASM
    → renderSvgToPngDataUrl (mermaid.ts:31) — resvg-js rasterization
  → PNG data URL → <image-plane> → TexturePlaneRenderable
    → Three.js → WebGPU → block-char rendering → terminal
```

**Files:**
- `packages/opencode/src/util/mermaid.ts` (68 lines) — WASM SVG → PNG pipeline
- `packages/opencode/src/cli/cmd/tui/routes/session/text-segments.ts` (27 lines) — Text splitter for ` ```mermaid ` fences
- `packages/opencode/src/cli/cmd/tui/component/texture-plane-renderable.ts` (90 lines) — Three.js 3D image renderable
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — text-part render integration (lines 1706-1728)

### Progressive Rendering (2026-07-12 improvement)

**Before:** Mermaid diagrams only rendered after `part.time?.end` — entire LLM response had to finish. Users saw raw ` ```mermaid ` code as plain text fallback for the entire streaming duration.

**After:** Renders each mermaid block as soon as its code fence closes, even if the LLM continues writing after it. Uses `renderedSources` Map keyed by segment index + source hash to skip re-rendering unchanged blocks on every streaming tick.

---

## 7. Image & Media Rendering

### 7a. TexturePlaneRenderable — 3D Image Display

**File:** `packages/opencode/src/cli/cmd/tui/component/texture-plane-renderable.ts`

Registered as `<image-plane>` via `extend()` in `app.tsx:78`.

- Uses `@opentui/three` `ThreeRenderable` for GPU-accelerated block-char conversion
- Loads image as Three.js texture → PlaneGeometry → Mesh → PerspectiveCamera → ThreeRenderable
- Temporary file in `os.tmpdir()`, cleaned up in `finally` block

### 7b. Terminal Graphics Protocol Detection

**File:** `packages/opencode/src/util/terminal-graphics.ts`

- `detectGraphicsProtocol()` detects Kitty, iTerm2, Sixel, or Unicode symbols fallback
- Detection based on `TERM`, `TERM_PROGRAM`, `KITTY_WINDOW_ID`, `WT_SESSION` env vars
- WezTerm: prefers Kitty, falls back through chain
- VS Code terminal: always "symbols" fallback

### 7c. Image Components

| File | Component | Rendering |
|------|-----------|-----------|
| `media-image.tsx` | `<MediaImage>` | `<image-plane>` → TexturePlaneRenderable → Three.js |
| `media-video.tsx` | `<MediaVideo>` | Video playback widget |
| `media-audio.tsx` | `<MediaAudio>` | Audio playback widget |
| `media-mermaid.tsx` | `<MediaMermaid>` | Mermaid → SVG → PNG → `<image-plane>` |

### 7d. ANSI / Kitty Renderers

| File | Purpose | Key Details |
|------|---------|-------------|
| `kitty-render.ts` | Kitty protocol escape sequences | Chunked for images > 4096 bytes |
| `image-to-ansi.ts` | Pure ANSI TrueColor fallback | Half-block characters (▀), Jimp-based |

---

## 8. Markdown Rendering (Web/Desktop)

**File:** `packages/ui/src/components/markdown.tsx`

- Uses `marked` for markdown → HTML conversion
- `DOMPurify` for XSS sanitization
- 200-entry LRU cache (`Map<string, Entry>`)
- Code blocks get copy buttons

**File:** `packages/ui/src/components/markdown-stream.ts`

- `heal(text)` — closes unclosed formatting via `remend` library
- `stream(text, live)` — splits markdown into stable content vs incomplete trailing code fence
- Used by web UI for streaming markdown display

### Document Conversion (Binary → Markdown)

**File:** `packages/opencode/src/util/markdownify.ts`

- Uses external binary `opencode-markdownify`
- Supports PDF, docx, xlsx, pptx, CSV, HTML, media files
- Resolves from `Global.Path.bin`, config, executable dir, source checkout

---

## 9. Syntax Highlighting (Tree-sitter)

### Configuration

**File:** `packages/opencode/parsers-config.ts`

Defines 28 language parsers (Python, Rust, Go, TypeScript, etc.) with WASM files and tree-sitter query URLs.

### Parser Loading

**File:** `packages/opencode/src/util/parser-wasm.ts`

- Line 56-60: `getGrammarWasm(filetype)` — loads from local WASM cache or CDN fallback
- Line 66-71: `preloadGrammars()` — preloads all grammars during initialization
- Registered in session route at `index.tsx:104`: `addDefaultParsers(parsers.parsers)`

---

## 10. Attachment Rendering

**File:** `packages/opencode/src/attachment/registry.ts`

Each attachment type has a `render()` method returning `TuiRenderResult`:

| Handler File | Type | render() result |
|-------------|------|-----------------|
| `handlers/image.ts:95` | Images | TuiRenderResult → `<MediaImage>` |
| `handlers/video.ts:108` | Video | → `<MediaVideo>` |
| `handlers/audio.ts:72` | Audio | → `<MediaAudio>` |
| `handlers/document.ts:32` | Documents | → "describe" (converted to markdown) |
| `handlers/archive.ts:73` | Archives | → Directory listing |
| `handlers/data.ts:77` | Data files | → Structured display |
| `handlers/spatial.ts:99` | GIS | → Map/geo display |
| `handlers/sensor.ts:140` | Sensor data | → Gauge/chart display |

---

## 11. TUI Configuration

**File:** `packages/opencode/src/cli/cmd/tui/config/tui-schema.ts`

| Setting | Values | Default | Line |
|---------|--------|---------|------|
| `diff_style` | `"auto"`, `"stacked"` | — | 26 |
| `image_protocol` | `"auto"`, `"kitty"`, `"sixel"`, `"iterm2"`, `"symbols"` | — | 31 |

**Themes:** 30+ theme JSON files in `tui/themes/` with full color/syntax definitions.

---

## 12. Test Infrastructure

### Test Fixtures

**File:** `packages/opencode/test/fixture/fixture.ts`

- `tmpdir(options?)` — creates temporary directories with optional git/config/init
- `tmpdirScoped(options?)` — Effect-scoped temp directory
- `provideTmpdirInstance((dir) => effect, options?)` — convenience helper

### Known Test Considerations

**SolidJS SSR Evaluation:** SolidJS evaluates renderable components during module import (when `.tsx` files are loaded). If a component requires context providers (Toast, Dialog, Theme) that don't exist at module-load time, it throws. Mitigations:
- `DialogProvider` (dialog.tsx:154-184) gracefully handles missing `ToastProvider` — `useToast()` is wrapped in try/catch, copy-on-select guards with `if (!toast) return`
- Tests that don't depend on SolidJS should be placed **outside** `test/cli/tui/` to avoid the SSR cascade (e.g., `test/cli/editor-context.test.ts`)

**Log Spy Target:** The plugin loader (`runtime.ts`) routes warnings through `Log.Default.warn()` → JSONL file I/O, not `console.warn`. Tests must spy on the log module, not `console.warn`.

---

## 13. Key File Index

| File | Lines | Purpose |
|------|-------|---------|
| `packages/opencode/src/session/processor.ts` | 695-748 | Delta event generation |
| `packages/opencode/src/session/session.ts` | 633-646, 807-815 | Event bus publishing |
| `packages/opencode/src/cli/cmd/tui/context/sync.tsx` | 448-488 | Delta store mutations |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | 1697-1805 | TextPart rendering (markdown + mermaid) |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | 1757-1788 | Streaming highlight fallback |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | 1706-1728 | Progressive mermaid rendering |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | before 1697 | `healMarkdown()` function |
| `packages/opencode/src/cli/cmd/tui/routes/session/text-segments.ts` | 1-27 | Mermaid text splitter |
| `packages/opencode/src/util/mermaid.ts` | 1-68 | Mermaid SVG→PNG pipeline |
| `packages/opencode/src/cli/cmd/tui/component/texture-plane-renderable.ts` | 1-90 | 3D image renderable |
| `packages/opencode/src/util/terminal-graphics.ts` | 1-50+ | Protocol detection |
| `packages/opencode/src/util/kitty-render.ts` | 1-60 | Kitty escape sequences |
| `packages/opencode/src/util/image-to-ansi.ts` | 1-100+ | ANSI TrueColor fallback |
| `packages/opencode/src/util/markdownify.ts` | 1-170 | Document→Markdown conversion |
| `packages/ui/src/components/markdown-stream.ts` | 1-49 | Web markdown stream healing |
| `packages/ui/src/components/markdown.tsx` | 1-120+ | Web markdown→HTML rendering |
| `packages/opencode/src/cli/cmd/tui/ui/dialog.tsx` | 154-184 | DialogProvider (optional toast) |
| `packages/opencode/src/cli/cmd/tui/ui/toast.tsx` | 1-109 | Toast notifications |
| `packages/opencode/parsers-config.ts` | 1-100+ | Tree-sitter parser config (28 langs) |
| `packages/opencode/src/util/parser-wasm.ts` | 56-71 | Parser WASM loading |
| `packages/opencode/src/attachment/registry.ts` | 1-50+ | Attachment type registry |
| `packages/opencode/src/cli/cmd/tui/config/tui-schema.ts` | 26-31 | TUI config schema |
| `packages/opencode/test/cli/editor-context.test.ts` | 1-93 | ZED editor tests (moved from TUI dir) |
| `packages/opencode/test/cli/tui/plugin-loader-entrypoint.test.ts` | 259-321 | Plugin entrypoint tests |
| `node_modules/@opentui/core/renderables/Markdown.d.ts` | 1-255 | MarkdownRenderable type declarations |
| `node_modules/@opentui/core/renderables/markdown-parser.d.ts` | 1-11 | `parseMarkdownIncremental()` types |
| `node_modules/@opentui/core/index.js` | 8550-8555 | `shouldRenderSeparately()` dispatch |
| `node_modules/@opentui/core/index.js` | 8113-8123 | `createInitialStyledText()` |
| `node_modules/@opentui/core/index.js` | 8585-8625 | `buildRenderableTokens()` coalescing logic |
| `node_modules/@opentui/core/index.js` | 8948-8973 | `createDefaultRenderable()` routing |
| `node_modules/@opentui/core/index.js` | 8289-8300 | `createListRenderable()` list rendering |
| `node_modules/@opentui/core/index-6xr3rbbe.js` | 3335-3358 | `ensureVisibleTextBeforeHighlight()` |
| `patches/@opentui%2Fcore@0.4.3.patch` | 1-23 | Patch: markdown list/heading + streaming guard fix |
