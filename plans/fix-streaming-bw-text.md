# Fix: Streaming BW Text — Restore `streaming={true}` Only

## Problem
Commit `3eb1bfcda2` changed `streaming={true}` to `streaming={!props.part.time?.end}` in both TextPart and ReasoningPart. Combined with `drawUnstyledText=false`, this causes `CodeRenderable.set content()` Branch 3 to fire — replacing the styled text buffer with plain BW text.

## What stays (no rollback)
- `splitTextSegments()` — mermaid/markdown segment splitting
- Per-index mermaid rendering
- `drawUnstyledText={false}`
- All other changes from `3eb1bfcda2`

## Fix (2 lines)

**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

### ReasoningPart (line ~1673)
```diff
- streaming={!props.part.time?.end}
+ streaming={true}
```

### TextPart (lines ~1743-1747) — remove streaming memo, use literal
```diff
- // Mark streaming complete when the part has finalized...
- // ...4-line comment block...
- const streaming = createMemo(() => !props.part.time?.end)
```
Then replace `streaming={streaming()}` with `streaming={true}` (2 occurrences: `<markdown>` and `<code>`).

## Why this works
With `streaming=true` + `drawUnstyledText=false` + `filetype="markdown"`:
- Branch 1: `_streaming && _filetype && !_drawUnstyledText` = `true && true && true` = **TAKEN**
- Returns early — textBuffer never replaced with plain text
- `ensureVisibleTextBeforeHighlight()`: enters `_streaming && !isInitialContent` branch → just enables render

## Verification
1. `bun run typecheck` in `packages/opencode/` — passes
2. Run opencode, observe streaming:
   - Reasoning text stays gray (subtleSyntax)
   - Markdown/code text stays colored with syntax highlighting
   - Mermaid diagrams still render correctly (per-index rendering preserved)
