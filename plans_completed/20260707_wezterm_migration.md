# WezTerm Migration

**Status:** [x] Complete — implemented 2026-07-07
**Effort:** ~0.5h

**Abstract:** Adopt WezTerm as the recommended terminal for opencode. WezTerm is the only cross-platform terminal that supports all three graphics protocols (Kitty, Sixel, iTerm2). Migration requires only 1 line of code change — the existing chafa-wasm renderer already supports all protocols.

---

## Sub-plans

### A — WezTerm → Kitty detection
**Scope:** 1 line change + 1 test update
**Status:** [x] Done

| File | Change |
|------|--------|
| `terminal-graphics.ts:55-61` | WezTerm → `"kitty"` (was `"sixel"`) |
| `terminal-graphics.test.ts:75` | Test expectation updated |

**Reasoning:** WezTerm with `enable_kitty_graphics=true` supports 24-bit color + animation. The existing fallback chain (Kitty → Symbols → binary chafa) handles the case where Kitty is not enabled in wezterm.lua.

### B — wezterm.lua config template
**Scope:** 1 new file
**Status:** [x] Done

| File | Content |
|------|---------|
| `experiments/wezterm/wezterm.lua` | Optimal config for opencode |

Key settings:
- `enable_kitty_graphics = true` — Kitty protocol for best image quality
- `enable_sixel = true` — Sixel fallback for SSH/tmux
- `font = "JetBrains Mono"`, `font_size = 13.0`
- `color_scheme = "Catppuccin Mocha"`
- `use_fancy_tab_bar = false` — clean UI

### D — Documentation
**Scope:** 1 line change
**Status:** [x] Done

| File | Change |
|------|--------|
| `system.ts:113` | Mention WezTerm as recommended terminal |

---

## Verification

| Oracle | Result |
|--------|--------|
| `bun typecheck` | 0 errors |
| `bun test test/util/terminal-graphics.test.ts` | 18/18 pass |

## Architecture Notes

- **No renderer changes needed** — chafa-wasm already supports `CHAFA_PIXEL_MODE_KITTY`
- **No TUI framework changes** — @opentui is terminal-agnostic
- **No ConPTY changes** — WezTerm uses the same Windows console API as Windows Terminal
- **Fallback chain handles degradation**: Kitty → Symbols → binary chafa — works automatically
