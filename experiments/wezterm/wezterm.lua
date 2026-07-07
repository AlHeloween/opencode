-- ============================================================================
-- WezTerm configuration for opencode
-- ============================================================================
-- Copy to:  Windows:  %USERPROFILE%\.config\wezterm\wezterm.lua
--           macOS:    ~/.config/wezterm/wezterm.lua
--           Linux:    ~/.config/wezterm/wezterm.lua
--
-- WezTerm is the recommended terminal for opencode because it supports ALL
-- three terminal graphics protocols (Kitty, Sixel, iTerm2) on ALL platforms
-- (Windows, macOS, Linux).  This config enables the best possible image
-- rendering quality for opencode's TUI.
-- ============================================================================

local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- ---------------------------------------------------------------------------
-- Graphics protocols — required for inline image rendering in opencode
-- ---------------------------------------------------------------------------

-- Kitty Graphics Protocol: 24-bit colour, animation, GPU-accelerated.
-- This is the preferred protocol for WezTerm.
-- opencode will auto-detect WezTerm and use Kitty, falling back to
-- Unicode symbols if the protocol is unavailable.
config.enable_kitty_graphics = true

-- Sixel: 256-colour fallback for maximum compatibility (SSH, tmux).
-- Also enabled so that chafa/sixel-aware tools work inside opencode's PTY.
-- (WezTerm supports both protocols simultaneously.)
config.enable_sixel = true

-- ---------------------------------------------------------------------------
-- Appearance
-- ---------------------------------------------------------------------------

-- Font: any modern monospace works. JetBrains Mono is a safe default.
config.font = wezterm.font("JetBrains Mono", { weight = "Regular" })
config.font_size = 13.0

-- Colour scheme: Catppuccin Mocha looks great with opencode's default theme.
-- Override to match your opencode TUI theme (use /themes to see available).
config.color_scheme = "Catppuccin Mocha"

-- Clean title bar — opencode manages its own tabs via the built-in multiplexer.
config.use_fancy_tab_bar = false
config.window_decorations = "RESIZE"

-- ---------------------------------------------------------------------------
-- Keyboard — opencode uses Ctrl+X as the leader key by default.
-- These bindings avoid conflicts between WezTerm and opencode.
-- ---------------------------------------------------------------------------

config.keys = {
  -- Ctrl+Shift+C / Ctrl+Shift+V for copy/paste (WezTerm defaults are fine)
  -- Ctrl+X is opencode's leader key — WezTerm does NOT intercept it by default

  -- Ctrl+D: send to shell (opencode uses this for session list in some contexts)
  { key = "d", mods = "CTRL", action = wezterm.action.SendKey({ key = "d", mods = "CTRL" }) },
}

-- ---------------------------------------------------------------------------
-- Performance
-- ---------------------------------------------------------------------------

-- GPU-accelerated rendering (default in WezTerm)
config.front_end = "OpenGL"

-- Maximum framerate — smooth scrolling without excessive GPU usage
config.max_fps = 60

-- ---------------------------------------------------------------------------
-- Misc
-- ---------------------------------------------------------------------------

-- Disable audible bell (opencode plays attention sounds)
config.audible_bell = "Disabled"

-- WezTerm's built-in multiplexer replaces tmux for opencode users.
-- Panes, tabs, and workspaces are available via wezterm cli.
-- No extra configuration needed — just use wezterm cli split-pane, etc.

return config
