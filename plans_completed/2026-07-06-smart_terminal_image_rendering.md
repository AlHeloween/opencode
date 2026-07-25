# Smart Terminal Image Rendering

**Status:** [x] Complete — implemented 2026-07-06
**Effort:** ~1.5h

**Abstract:** Replace binary `chafa` dependency with `chafa-wasm` (already bundled) and add automatic terminal graphics protocol detection with fallback chain: Kitty → Sixel → iTerm2 → Symbols → Binary chafa.

---

## Sub-plans

### A — Shared chafa-wasm renderer
**Scope:** 1 new file, 1 modified
**Status:** [x] Done

| File | Action | Lines |
|------|--------|-------|
| `src/util/chafa-wasm-render.ts` | NEW | 155 |
| `src/util/mermaid.ts` | MODIFY | -18 +2 |

- Extracted `getChafa()` singleton + `buildChafaConfig()` from mermaid.ts
- Added `renderImageToTerminal(imageBuffer, config)` with protocol selection
- Added `GraphicsProtocol` type + `GRAPHICS_PROTOCOL_PRIORITY` constant
- mermaid.ts now imports from shared module — behavior unchanged

### B — Terminal graphics capability detection
**Scope:** 1 new file, 1 new test file
**Status:** [x] Done

| File | Action | Lines |
|------|--------|-------|
| `src/util/terminal-graphics.ts` | NEW | 107 |
| `test/util/terminal-graphics.test.ts` | NEW | 218 |

- `detectGraphicsProtocol()`: reads TERM, TERM_PROGRAM, KITTY_WINDOW_ID, WT_SESSION
- Detection priority: Kitty → iTerm2 → WezTerm/Sixel → Windows Terminal/Sixel → Ghostty/Kitty → VSCode/Symbols → Symbols fallback
- 13 unit tests, all passing
- Every detection branch is logged — no silent fallbacks

### C — media-image.tsx WASM update
**Scope:** 1 file modified
**Status:** [x] Done

| File | Action | Lines |
|------|--------|-------|
| `src/cli/cmd/tui/component/media-image.tsx` | MODIFY | ~60 changed |

- Replaced `execFileSync("chafa")` with async `renderImageToTerminal()` via chafa-wasm
- Fallback chain: WASM(protocol) → WASM(symbols) → binary chafa → error text
- Switched from `createEffect` (sync/blocking) to `createResource` (async/non-blocking)
- Binary chafa retained as last-resort fallback for backward compatibility
- Every render attempt is logged with protocol, image size, and outcome

---

### D — `image_protocol` в tui.json конфиге
**Scope:** 1 schema file, 1 utility file, 1 component file, 1 test file
**Status:** [x] Done

| File | Action | Lines |
|------|--------|-------|
| `src/cli/cmd/tui/config/tui-schema.ts` | MODIFY | +5 |
| `src/util/terminal-graphics.ts` | MODIFY | +15 |
| `src/cli/cmd/tui/component/media-image.tsx` | MODIFY | +5 |
| `test/util/terminal-graphics.test.ts` | MODIFY | +45 |

- `image_protocol` в `tui.json`: `"auto"` (по умолчанию), `"kitty"`, `"sixel"`, `"iterm2"`, `"symbols"`
- `detectGraphicsProtocol(override?)` и `detectBestProtocol(override?)` — принимают опциональный оверрайд
- `MediaImage` читает `image_protocol` через `useTuiConfig()` и передаёт в `renderImageAsync()`
- Неизвестные значения логируются и игнорируются (fallback на авто-детекцию)
- +5 тестов на оверрайды

---

## Verification

| Oracle | Result |
|--------|--------|
| `bun typecheck` | 0 errors |
| `bun test test/util/terminal-graphics.test.ts` | 18/18 pass |
| `bun test test/util/wasm-embedded.test.ts` | 9/9 pass (no regression) |

## Design Decisions

- **Logging**: Every branch (success, fallback, failure) is logged at debug/warn level. No silent `catch {}` — all caught errors produce `log.warn("bug: ...")` or `log.debug(...)`.
- **Fallback chain**: WASM with detected protocol → WASM with symbols → binary chafa → error message. Each step is tried only if the previous one fails.
- **Backward compatibility**: Binary chafa path preserved as final fallback. Users without WASM support get the same behavior as before.
- **Protocol priority**: Kitty > Sixel > iTerm2 > Symbols. Sixel preferred for WezTerm (widest compat), Windows Terminal (WT_SESSION), xterm, foot, and Konsole.
