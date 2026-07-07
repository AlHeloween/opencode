# ============================================================================
# _setup_terminal.ps1 — One-time WezTerm portable setup
# ============================================================================
# Downloads WezTerm nightly to external\wezterm\ (portable, no installer).
# Creates wezterm.lua with optimal opencode settings.
# Run once. After that, _launch_wezterm.bat works forever.
# ============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WezTermDir = Join-Path $ScriptDir "external\wezterm"
$WezTermExe = Join-Path $WezTermDir "wezterm.exe"
$WezTermConfig = Join-Path $WezTermDir "wezterm.lua"

# ── Check if already installed ──────────────────────────────────────
if (Test-Path $WezTermExe) {
    Write-Host "[ok] WezTerm already installed: $WezTermDir" -ForegroundColor Green
    exit 0
}

# ── Download WezTerm nightly (portable zip) ─────────────────────────
$Url = "https://github.com/wezterm/wezterm/releases/download/nightly/WezTerm-nightly-x86_64-pc-windows-msvc.zip"
$ZipFile = Join-Path $env:TEMP "WezTerm-nightly.zip"

Write-Host "Downloading WezTerm nightly..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri $Url -OutFile $ZipFile -UseBasicParsing
} catch {
    Write-Host "Download failed: $_" -ForegroundColor Red
    Write-Host "Install manually: winget install wez.wezterm.nightly"
    Write-Host "Or download from: https://wezterm.org/install/windows.html"
    pause
    exit 1
}

# ── Extract to external\wezterm ─────────────────────────────────────
Write-Host "Extracting to $WezTermDir ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $WezTermDir | Out-Null
Expand-Archive -Path $ZipFile -DestinationPath $WezTermDir -Force
Remove-Item $ZipFile -Force

# After extraction, the .exe might be in a subfolder. Find it.
$Found = Get-ChildItem -Path $WezTermDir -Recurse -Filter "wezterm.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Found) {
    # Move all files up one level if they're in a subfolder
    $Parent = Split-Path -Parent $Found.FullName
    if ($Parent -ne $WezTermDir) {
        Get-ChildItem -Path $Parent | Move-Item -Destination $WezTermDir -Force
        Remove-Item $Parent -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host "[ok] WezTerm installed: $WezTermExe" -ForegroundColor Green
} else {
    Write-Host "Error: wezterm.exe not found after extraction" -ForegroundColor Red
    exit 1
}

# ── Generate config ─────────────────────────────────────────────────
Write-Host "Creating wezterm.lua..." -ForegroundColor Cyan
@"
local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- Kitty Graphics Protocol — opencode inline images (24-bit, animation)
config.enable_kitty_graphics = true

-- Font
-- Window
config.window_decorations = "TITLE | RESIZE"
config.window_padding = { left = 8, right = 8, top = 8, bottom = 8 }
config.window_background_opacity = 0.95
config.win32_system_backdrop = "Acrylic"

-- Font -- built-in JetBrains Mono with Nerd Font icons
config.font = wezterm.font("JetBrains Mono")
config.font_size = 13.0

-- Theme
config.color_scheme = "Dracula"

-- Launch menu -- right-click '+' tab button
config.launch_menu = {
  { label = "PowerShell", args = { "powershell.exe", "-NoLogo" } },
  { label = "CMD",        args = { "cmd.exe" } },
}

-- Leader key: Ctrl+A (tmux-style pane management)
config.leader = { key = "a", mods = "CTRL", timeout_milliseconds = 1000 }

-- Keys
config.keys = {
  -- Copy/paste
  { key = "c", mods = "CTRL",       action = wezterm.action.CopyTo("Clipboard") },
  { key = "C", mods = "CTRL|SHIFT", action = wezterm.action.CopyTo("Clipboard") },
  { key = "v", mods = "CTRL",       action = wezterm.action.PasteFrom("Clipboard") },
  { key = "V", mods = "CTRL|SHIFT", action = wezterm.action.PasteFrom("Clipboard") },
  -- Tabs
  { key = "T", mods = "CTRL|SHIFT", action = wezterm.action.SpawnTab("CurrentPaneDomain") },
  { key = "w", mods = "CTRL",       action = wezterm.action.CloseCurrentTab({ confirm = true }) },
  -- Leader + | : vertical split  |  Leader + - : horizontal split
  { key = "|", mods = "LEADER", action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
  { key = "-", mods = "LEADER", action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }) },
  -- Leader + arrows : navigate panes
  { key = "LeftArrow",  mods = "LEADER", action = wezterm.action.ActivatePaneDirection("Left") },
  { key = "RightArrow", mods = "LEADER", action = wezterm.action.ActivatePaneDirection("Right") },
  { key = "UpArrow",    mods = "LEADER", action = wezterm.action.ActivatePaneDirection("Up") },
  { key = "DownArrow",  mods = "LEADER", action = wezterm.action.ActivatePaneDirection("Down") },
}

config.initial_cols = 140
config.initial_rows = 40
config.use_fancy_tab_bar = false
config.max_fps = 60
config.audible_bell = "Disabled"
config.hide_mouse_cursor_when_typing = false

return config
"@ | Out-File -FilePath $WezTermConfig -Encoding UTF8

Write-Host ""
Write-Host "Done! WezTerm portable is ready." -ForegroundColor Green
Write-Host "  Terminal:  $WezTermExe" -ForegroundColor White
Write-Host "  Config:    $WezTermConfig" -ForegroundColor White
Write-Host ""
Write-Host "Double-click _launch_wezterm.bat to start opencode in WezTerm." -ForegroundColor Yellow
