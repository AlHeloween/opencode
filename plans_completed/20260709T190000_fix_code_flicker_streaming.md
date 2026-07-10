# Fix B/W Flicker in `<code>` Component During Streaming

**Root cause:** `CodeRenderable.content` setter unconditionally calls `setText(value)` (plain text) before `ensureVisibleTextBeforeHighlight()` runs in `renderSelf()`. The render pipeline then shows the poisoned plain-text buffer until async highlights complete.

**Fix:** In the content setter, skip `setText()` when streaming with `drawUnstyledText=true` and `_hadInitialContent=true` — defer to `ensureVisibleTextBeforeHighlight()` which already handles `isInitialContent=false` by preserving the existing buffer.

## Change Plan

| # | File | Type | Summary |
|---|------|------|---------|
| 1 | `node_modules/@opentui/core/index-6xr3rbbe.js` | modify | Guard `setText()` in content setter |

### Change 1: Guard content setter (line ~3188 of `index-6xr3rbbe.js`)

Current code (after existing `if` and before `setText`):
```js
    if (this._streaming && this._filetype && !this._drawUnstyledText) {
      this.requestRender();
      return;
    }
    if (this._initialStyledText && this._drawUnstyledText) {
      this.textBuffer.setStyledText(this._initialStyledText);
    } else {
      this.textBuffer.setText(value);
    }
```

New code (insert guard before `setText`):
```js
    if (this._streaming && this._filetype && !this._drawUnstyledText) {
      this.requestRender();
      return;
    }
    // Streaming + drawUnstyled + not initial content: preserve existing styled text
    // in buffer. Let ensureVisibleTextBeforeHighlight() handle the display.
    // This prevents the B/W flash where setText(plain) overwrites styled text
    // before the async highlight replaces it.
    if (this._streaming && this._drawUnstyledText && this._hadInitialContent) {
      this._shouldRenderTextBuffer = true;
      this.requestRender();
      return;
    }
    if (this._initialStyledText && this._drawUnstyledText) {
      this.textBuffer.setStyledText(this._initialStyledText);
    } else {
      this.textBuffer.setText(value);
    }
```

### Why This Works

| Phase | Before | After |
|-------|--------|-------|
| Chunk N arrives | setText(plain) → buffer shows B/W | Skip setText → buffer keeps styled from chunk N-1 highlight |
| renderSelf() | draws plain text → B/W | draws previous styled text → colored + new chars as plain |
| startHighlight() completes | setStyledText → colored | setStyledText → colored |
| Visual result | Flash B/W between chunks | Smooth transition, only new chars appear without color briefly |

### Edge Cases

- **First chunk** (`_hadInitialContent=false`): Falls through to existing behavior — `setText(plain)` then highlight. Correct — there are no previous highlights to preserve.
- **`drawUnstyledText=false`**: Already handled by existing guard at line ~3186 — buffer is hidden until highlight completes. No change needed.
- **No filetype**: `_hadInitialContent` stays false (never set by highlight). Falls through to existing behavior. Correct.

## Verification

1. **Build**: `pwsh _build.ps1` from repo root
2. **Smoke test**: `dist/opencode-windows-x64/bin/opencode --version` → `10.0.397`
3. **TUI test**: Launch opencode from `dist/bin`, start a session, observe streaming responses:
   - Text should remain colored throughout streaming (no B/W flash between chunks)
   - After streaming ends, scroll should preserve colors
   - Resize should preserve colors
4. **Fallback test**: Set `OPENCODE_EXPERIMENTAL_MARKDOWN=false` — the `<code>` path should work without flicker

## Rollback

Restore from backup: `.opencode/data/backups/<sessionID>/<timestamp>_<callID>_node_modules-@opentui-core-index-6xr3rbbe.js.bak`
