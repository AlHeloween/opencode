# Fix: Scroll Flicker + Experimental Cleanup

## Problem

1. **Scroll flicker (B/W flash)**: `OPENCODE_EXPERIMENTAL_MARKDOWN` (flag.ts:90) is a static value `!falsy()` = always `true`. It's never read from config. The `<markdown>` pipeline is always active and has a B/W flash bug in code block rendering.

2. **Broken flag**: Static value means `Flag.fromConfig()` writes to `_configValues` but it's never read (no getter). Config setting `experimental.markdown` has zero effect.

3. **Experimental flags on stable codebase**: Many experimental flags gate features that are already working in production.

## Root Cause (Scroll Flicker)

The `<markdown>` pipeline creates child `CodeRenderable`s for code blocks. These get `drawUnstyledText=false` but the constructor writes unstyled text via `textBuffer.setText(content)`. During streaming, `_shouldRenderTextBuffer` flips to `true` before async tree-sitter completes → unstyled (B/W) text renders.

The `<code>` pipeline uses `drawUnstyledText={false}` explicitly and never renders unstyled text (Branch C: `_shouldRenderTextBuffer = false` until highlight completes).

## Fix: Remove `<markdown>` Pipeline, Keep `<code>` Pipeline

The `<code>` pipeline is correct. The `<markdown>` pipeline has the B/W flash bug. Remove the dual-pipeline `<Switch>` and keep only `<code>`.

### Files Modified

| # | File | Change |
|---|------|--------|
| 1 | `packages/core/src/flag/flag.ts:90` | Remove `OPENCODE_EXPERIMENTAL_MARKDOWN` line |
| 2 | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1740-1762` | Remove `<Switch>` with two `<Match>` branches. Keep only `<code filetype="markdown" drawUnstyledText={false} streaming={true} syntaxStyle={syntax()} content={displayText()} conceal={ctx.conceal()} fg={theme.text} />` |
| 3 | `packages/opencode/src/config/config.ts:912` | Remove `OPENCODE_EXPERIMENTAL_MARKDOWN` from `fromConfig` call |
| 4 | `packages/opencode/src/config/config.ts:1084` | Remove `OPENCODE_EXPERIMENTAL_MARKDOWN` from config key map |

### Code Change Detail

**session/index.tsx TextPart (lines 1737-1765):**

Before:
```tsx
<Switch>
  <Match when={Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
    <markdown syntaxStyle={syntax()} streaming={true} content={displayText()} conceal={ctx.conceal()} fg={theme.markdownText} bg={theme.background} />
  </Match>
  <Match when={!Flag.OPENCODE_EXPERIMENTAL_MARKDOWN}>
    <code filetype="markdown" drawUnstyledText={false} streaming={true} syntaxStyle={syntax()} content={displayText()} conceal={ctx.conceal()} fg={theme.text} />
  </Match>
</Switch>
```

After:
```tsx
<code filetype="markdown" drawUnstyledText={false} streaming={true} syntaxStyle={syntax()} content={displayText()} conceal={ctx.conceal()} fg={theme.text} />
```

**flag.ts line 90:** Delete the line entirely.

**config.ts:** Remove the two `OPENCODE_EXPERIMENTAL_MARKDOWN` references.

## Verification

1. `bun typecheck` — zero errors
2. `bun run script/build.ts --single`
3. Launch opencode, send a message with code blocks
4. Scroll through response — no B/W flash
5. Verify `import { Flag }` no longer references `OPENCODE_EXPERIMENTAL_MARKDOWN`
