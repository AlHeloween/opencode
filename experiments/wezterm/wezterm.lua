-- ============================================================================
-- WezTerm configuration template for opencode
-- ============================================================================
-- Copy to:  Windows:  %USERPROFILE%\.config\wezterm\wezterm.lua
--           macOS:    ~/.config/wezterm/wezterm.lua
--           Linux:    ~/.config/wezterm/wezterm.lua
--
-- Reload:   Ctrl+Shift+R (no restart needed)
-- Verify:   wezterm --config-file "this/file/wezterm.lua" start
-- ============================================================================

local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- ---------------------------------------------------------------------------
-- Window
-- ---------------------------------------------------------------------------
config.initial_cols = 140
config.initial_rows = 40
config.window_decorations = "RESIZE"

-- ---------------------------------------------------------------------------
-- Font
-- ---------------------------------------------------------------------------
config.font = wezterm.font("JetBrains Mono")
config.font_size = 13.0

-- ---------------------------------------------------------------------------
-- Colour scheme (built-in: https://wezterm.org/colorschemes)
-- ---------------------------------------------------------------------------
config.color_scheme = "Catppuccin Mocha"

-- ---------------------------------------------------------------------------
-- Graphics: Kitty protocol for opencode inline images (24-bit, animation)
-- opencode auto-detects WezTerm and uses Kitty; falls back to symbols if off.
-- ---------------------------------------------------------------------------
config.enable_kitty_graphics = true

-- ---------------------------------------------------------------------------
-- Keys — Ctrl+C/V copy/paste (copies only when text is selected)
-- ---------------------------------------------------------------------------
config.keys = {
  { key = "c", mods = "CTRL", action = wezterm.action.CopyTo("Clipboard") },
  { key = "v", mods = "CTRL", action = wezterm.action.PasteFrom("Clipboard") },
}

-- ---------------------------------------------------------------------------
-- Performance
-- ---------------------------------------------------------------------------
config.max_fps = 60
config.audible_bell = "Disabled"
config.use_fancy_tab_bar = false
config.hide_mouse_cursor_when_typing = false

return config
