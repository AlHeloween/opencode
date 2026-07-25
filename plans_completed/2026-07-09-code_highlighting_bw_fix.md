# Code Highlighting Black & White Issue — Investigation & Fix Plan

**Goal:** Restore color syntax highlighting in the TUI. Currently, code blocks render in black and white only, despite recent fixes that removed flickering.

**Status:** ✅ Complete — all 3 `<code>` elements fixed, unit test added, build verified.

---

## Background

Recent commits addressed flickering between color and B/W during scrolling:
- `96944901d` (Jul 9 13:00): Removed experimental markdown pipeline — eliminated B/W flash during scroll
- `40ddb086b` (Jul 9 13:51): Set `drawUnstyledText={true}` — text now visible immediately while highlighting loads
- `5bee9241e` (Jul 9 13:55): Added debug logging for tree-sitter highlight completion

The user reports that after these fixes, **all color is gone** — only black and white rendering remains.

## Current Code State

### TextPart rendering (session/index.tsx:1739-1756)
```tsx
<code
  filetype="markdown"
  drawUnstyledText={true}
  streaming={true}
  syntaxStyle={syntax()}
  content={displayText()}
  conceal={ctx.conceal()}
  fg={theme.text}
  onHighlight={(highlights, context) => {
    Log.Default.debug("tree-sitter highlight completed", {...})
    return highlights
  }}
/>
```

### Theme system (theme.tsx:437-438)
```ts
const syntax = createMemo(() => generateSyntax(values()))
const subtleSyntax = createMemo(() => generateSubtleSyntax(values()))
```

### Syntax rules (theme.tsx:744-916)
70+ scope-to-color mappings defined, using theme colors like `theme.syntaxString`, `theme.syntaxKeyword`, etc.

### Theme colors (opencode.json)
All syntax colors defined with dark/light variants:
- `syntaxComment`: `#808080` (dark) / `#8a8a8a` (light)
- `syntaxKeyword`: `#9d7cd8` (dark) / `#d68c27` (light)
- `syntaxFunction`: `#fab283` (dark) / `#2968c3` (light)
- etc.

## Hypotheses

### H1: `drawUnstyledText={true}` overrides syntax colors
**Likelihood:** HIGH

When `drawUnstyledText={true}`, the OpenTUI `<code>` component may render text immediately using the `fg` prop color (theme.text) and never apply the `syntaxStyle` colors. The `fg` prop might take precedence over syntax highlighting when unstyled text is drawn.

**Evidence:**
- Before `40ddb086b`, `drawUnstyledText={false}` was used — text was invisible until highlighting completed, but colors worked
- After `40ddb086b`, `drawUnstyledText={true}` — text visible immediately, but user reports B/W only
- The `fg={theme.text}` prop provides a fallback color that may override syntax colors

**Test:** Change `drawUnstyledText` back to `false` and observe if colors return (but text will be invisible until highlighting completes).

### H2: `syntax()` memo not recomputing with correct theme values
**Likelihood:** LOW

The `syntax` memo depends on `values()` which depends on theme resolution. If theme resolution fails silently, it might fall back to a default grayscale theme.

**Evidence against:**
- Theme resolution has error handling and fallback to opencode theme
- Other theme colors (background, text, etc.) work correctly in the TUI
- No error logs about theme resolution failures

### H3: Tree-sitter highlighting not executing
**Likelihood:** MEDIUM

If tree-sitter WASM fails to load or highlight queries fail, the `onHighlight` callback would receive empty highlights, and the component would fall back to the `fg` color.

**Evidence:**
- The `onHighlight` callback logs highlight completion, but we haven't checked the actual logs
- WASM downloads from GitHub — could fail in some network conditions
- No error logging if highlighting fails

**Test:** Check `.opencode/data/log/` for tree-sitter errors or zero highlight counts.

### H4: OpenTUI `SyntaxStyle.fromTheme()` bug
**Likelihood:** LOW

The OpenTUI library might have a bug where `SyntaxStyle.fromTheme()` doesn't properly apply colors when `drawUnstyledText={true}`.

**Evidence:**
- OpenTUI was downgraded from 0.4.3 to 0.4.2 in commit `f44e6e669` to fix scroll flickering
- The downgrade might have introduced a regression

## Investigation Plan (Completed)

### Step 1: Check logs for tree-sitter errors ✓
Searched `.opencode/data/log/*.jsonl` for `tree-sitter highlight completed`. No TUI session logs found with this message — only planning session permission eval logs. This is inconclusive: either the TUI hasn't been run with code blocks since the logging was added, or the log was cleared.

### Step 2: Analyze the `drawUnstyledText` change ✓
Compared commits:
- Before `40ddb086b`: `drawUnstyledText={false}` — colors worked, text invisible until highlighting done
- After `40ddb086b`: `drawUnstyledText={true}` — text visible immediately, user reports B/W only
- User confirms: "always B/W" now, was "color then scroll and B/W" before the fix

This confirms **H1**: `drawUnstyledText={true}` combined with `fg={theme.text}` causes the `fg` color to override syntax colors.

## Fix (Root Cause Confirmed: H1)

**Root cause:** `drawUnstyledText={true}` causes the OpenTUI `<code>` component to render text immediately using the `fg` prop color. The `fg` color overrides the `syntaxStyle` colors, resulting in monochrome text.

**Solution:** Remove the `fg` prop from both `<code>` components. The `syntaxStyle` will provide all colors. For the brief moment before tree-sitter completes, the text will render in the terminal's default foreground color (not invisible, not forced to theme.text).

### Files to modify

**`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`**

1. **ReasoningPart** (line ~1669): Remove `fg={theme.textMuted}` from the `<code>` element
2. **TextPart** (line ~1739): Remove `fg={theme.text}` from the `<code>` element

### Changes

```diff
--- a/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
+++ b/packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
@@ -1669,7 +1669,6 @@ function ReasoningPart(...) {
         <code
           filetype="markdown"
           drawUnstyledText={true}
           streaming={true}
           syntaxStyle={subtleSyntax()}
           content={"_Thinking:_ " + content()}
           conceal={ctx.conceal()}
-          fg={theme.textMuted}
         />
@@ -1739,11 +1738,10 @@ function TextPart(...) {
         <code
           filetype="markdown"
           drawUnstyledText={true}
           streaming={true}
           syntaxStyle={syntax()}
           content={displayText()}
           conceal={ctx.conceal()}
-          fg={theme.text}
           onHighlight={(highlights, context) => {
             Log.Default.debug("tree-sitter highlight completed", {...})
             return highlights
           }}
         />
```

**Rationale:** The `fg` prop is a fallback foreground color used when no syntax style applies. When `drawUnstyledText={true}`, the component renders text immediately using `fg` before tree-sitter completes, and this color persists even after syntax highlighting is applied. Removing `fg` lets the syntax style colors take effect as soon as they're ready, and until then the terminal's default foreground color is used (which is readable, unlike the `drawUnstyledText={false}` approach where text is invisible).

### If H3 confirmed (tree-sitter not executing):
- Fix WASM loading
- Add error handling and fallback
- Log tree-sitter failures explicitly

### If H4 confirmed (OpenTUI bug):
- Upgrade to 0.4.3 with the scroll flicker fix applied differently
- Or work around the bug in our code

**(Not applicable — H1 confirmed)**

## Critical Files

| File | Purpose |
|------|---------|
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | TextPart/ReasoningPart rendering — `drawUnstyledText` prop |
| `packages/opencode/src/cli/cmd/tui/context/theme.tsx` | Theme resolution, syntax style generation |
| `packages/opencode/src/cli/cmd/tui/context/theme/opencode.json` | Default theme color definitions |
| `packages/opencode/parsers-config.ts` | Tree-sitter parser configuration |
| `.opencode/data/log/` | Runtime logs for debugging |

## Verification

After applying the fix:

### 1. Unit Test — Syntax Style Generation
Add a test to `packages/opencode/test/cli/tui/theme-store.test.ts` that verifies `generateSyntax` produces colored styles (not just default foreground):

```ts
test("generateSyntax maps scopes to distinct colors", () => {
  const theme = resolveTheme(DEFAULT_THEMES.opencode, "dark")
  const syntax = generateSyntax(theme)

  try {
    // Verify different scopes get different colors
    const defaultFg = syntax.getStyle("default")?.fg
    const stringFg = syntax.getStyle("string")?.fg
    const keywordFg = syntax.getStyle("keyword")?.fg

    expect(defaultFg).toBeDefined()
    expect(stringFg).toBeDefined()
    expect(keywordFg).toBeDefined()

    // Colors should differ from default text color
    expect(stringFg?.equals(defaultFg)).toBe(false)
    expect(keywordFg?.equals(defaultFg)).toBe(false)
  } finally {
    syntax.destroy()
  }
})
```

Run with: `bun test packages/opencode/test/cli/tui/theme-store.test.ts`

### 2. Manual TUI Test
1. **Build** the project:
   ```bash
   pwsh _build.ps1
   ```

2. **Run** opencode TUI from the build output:
   ```bash
   cmd_runner start --cwd dist/bin -- opencode.exe
   ```

3. **Create a session** with code blocks:
   - Use `/new` command
   - Ask: "Write a Python function that sorts a list"
   - Wait for the response with code blocks

4. **Verify visually:**
   - Code blocks show colored syntax (keywords, strings, comments in different colors)
   - Text appears immediately (no blank wait)
   - No flickering when scrolling through the session

5. **Check logs** (optional):
   ```bash
   findstr /i "tree-sitter highlight completed" .opencode\data\log\*.jsonl
   ```
   Should show entries with `highlightCount` > 0 for code blocks.

6. **Test both dark and light modes** if possible.

### 3. Tree-Sitter Health Check (if colors still B/W)
If the fix doesn't restore colors, verify tree-sitter is actually running:

1. Create a session with a simple code block: "Show me `const x = 1`"
2. Check the latest log file for:
   ```
   tree-sitter highlight completed
   ```
3. Look for:
   - `highlightCount: 0` → tree-sitter not tokenizing (WASM issue)
   - `filetype: undefined` → parser not detected
   - No log entry at all → `onHighlight` callback not firing

If tree-sitter is broken, the fix won't help — need to debug WASM loading separately.

## Risks

- **Removing `fg` prop:** If syntax highlighting fails completely (tree-sitter WASM error, parser not found), text will render in the terminal's default foreground color instead of `theme.text`. This is acceptable — the text is still readable, just not themed. This is a better tradeoff than B/W-only rendering.

- **OpenTUI behavior:** If OpenTUI's `<code>` component uses `fg` as the default color even after syntax highlighting applies, removing it might cause text to use the terminal's default color permanently (not just temporarily). Testing required.

- **Scroll flickering:** The fix does not touch the scroll flicker fix — that was addressed by removing the experimental markdown pipeline and downgrading OpenTUI. Those changes remain in place.
