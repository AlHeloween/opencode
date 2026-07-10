# Markdown Formatting Not Rendering — Investigation & Fix Plan

**Goal:** Restore markdown formatting (bold, italic, headings, etc.) in the TUI that was lost when the experimental markdown pipeline was removed.

**Status:** Investigation phase — root cause identified, fix approach TBD.

## Root Cause

Commit `96944901d` ("fix: remove experimental markdown pipeline to fix scroll B/W flash") replaced OpenTUI's `<markdown>` component with `<code filetype="markdown">`:

| Aspect | `<markdown>` (removed) | `<code filetype="markdown">` (current) |
|--------|------------------------|---------------------------------------|
| Parser | `marked` (structured) | tree-sitter (flat tokenizer) |
| Output | Structured blocks (tables, lists, headings) | Flat syntax-highlighted text |
| Formatting | Native block rendering (bold, italic, tables, lists) | Colored text by scope only |
| Color prop | `fg={theme.markdownText}` | `fg={theme.text}` (removed by our fix) |
| Scroll flash | Had flicker during scroll | No flicker |

The `<markdown>` component used the `marked` library to produce structured renderables — tables rendered as tables, lists as indented items, headings as large bold text. The `<code filetype="markdown">` component only colors text by tree-sitter scope — it does NOT produce structural formatting.

**Our `fg` removal did NOT cause this** — the formatting was already degraded after `96944901d`. However, removing `fg` made plain text render in terminal default color instead of `theme.text`, compounding the visual issue.

## Investigation Complete

- **Q1:** Markdown formatting was lost when commit `96944901d` replaced `<markdown>` with `<code filetype="markdown">` — not caused by our `fg` removal
- **Q2:** `<code>` produces flat scope-colored text only — no structural formatting. Only `<markdown>` produces proper tables, lists, headings
- **Flag default:** `!falsy(...)` = enabled by default (opt-out), so all users had markdown formatting before `96944901d`

## Fix: Option B — Restore `<markdown>` Component

**Selected by user.** Revert the `<markdown>` removal while keeping the `<code>` fallback path.

### Changes — 3 files

#### 1. `packages/core/src/flag/flag.ts` — Restore flag

**Insert after line 89** (`OPENCODE_EXPERIMENTAL_PLAN_MODE`, before `OPENCODE_MODELS_URL`):
```ts
OPENCODE_EXPERIMENTAL_MARKDOWN: !falsy("OPENCODE_EXPERIMENTAL_MARKDOWN"),
```

#### 2. `packages/opencode/src/config/config.ts` — Restore config wiring

**Insert at line 911** (after `planMode`, before `iconDiscovery`):
```ts
OPENCODE_EXPERIMENTAL_MARKDOWN: result.experimental?.markdown,
```

**Insert at line 1083** (ENV_TO_CONFIG_MAP, after `planMode`, before `iconDiscovery`):
```ts
OPENCODE_EXPERIMENTAL_MARKDOWN: "experimental.markdown",
```

#### 3. `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — Restore Switch/Match

**Re-add import** (after existing `Flag` removal commit reversed — it's already gone):
```ts
import { Flag } from "@opencode-ai/core/flag/flag"
```

**Replace TextPart `<code>`** (lines 1738-1756) with Switch:
```tsx
<Switch>
  <Match when={Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
    <markdown
      syntaxStyle={syntax()}
      streaming={true}
      content={displayText()}
      conceal={ctx.conceal()}
      fg={theme.markdownText}
      bg={theme.background}
    />
  </Match>
  <Match when={!Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
    <code
      filetype="markdown"
      drawUnstyledText={true}
      streaming={true}
      syntaxStyle={syntax()}
      content={displayText()}
      conceal={ctx.conceal()}
      onHighlight={(highlights, context) => {
        Log.Default.debug("tree-sitter highlight completed", {
          partId: props.part.id,
          filetype: context?.filetype,
          highlightCount: highlights?.length ?? 0,
          contentLength: context?.content?.length ?? 0,
        })
        return highlights
      }}
    />
  </Match>
</Switch>
```

**Do the same for ReasoningPart** if it has markdown content (it uses `filetype="markdown"` too — same pattern applies).

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `<markdown>` uses `fg={theme.markdownText}` | Original prop — this is the dedicated markdown foreground color |
| `<code>` fallback has NO `fg` | Our earlier fix — prevents fg from overriding syntax colors |
| `drawUnstyledText={true}` on `<code>` fallback | Proven fix — text visible immediately while highlighting loads |
| Flag is opt-out (enabled by default) | Same as before `96944901d` — all users get enhanced markdown |
| Keep `<code>` fallback via Switch | Graceful degradation — users can disable via `OPENCODE_EXPERIMENTAL_MARKDOWN=false` if flicker returns |

### Scroll Flicker Risk

**Concern:** The original removal was to fix "scroll B/W flash." This may have been caused by OpenTUI 0.4.3, which was later downgraded to 0.4.2 (commit `f44e6e669`). Since we're on 0.4.2, the flicker may not reproduce. If it does, users can disable via the flag and get the `<code>` fallback.

## Critical Files

| File | Role |
|------|------|
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | TextPart/ReasoningPart `<code>` elements |
| `packages/opencode/src/cli/cmd/tui/context/theme.tsx` | Markdown scope rules (lines 951-1196) |
| `packages/core/src/flag/flag.ts` | Removed `OPENCODE_EXPERIMENTAL_MARKDOWN` flag |
| `node_modules/@opentui/core/renderables/Markdown.d.ts` | `<markdown>` component definition |
| `node_modules/@opentui/core/renderables/Code.d.ts` | `<code>` component definition |

## Verification

1. After Option A: markdown text renders with proper `theme.text` color
2. After Option B: markdown headings render bold and large, lists indent correctly, tables render with borders
3. Check: no scroll B/W flash
4. Check: syntax highlighting for code blocks still works (our original fix)
