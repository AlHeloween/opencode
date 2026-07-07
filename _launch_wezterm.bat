@echo off
:: ============================================================================
:: _launch_wezterm.bat — opencode Launcher для Windows (zero-friction)
:: ============================================================================
:: Двойной клик → opencode в WezTerm с Kitty-графикой.
:: Никаких установок, никаких конфигов вручную.
::
:: Порядок поиска WezTerm:
::   1. external\wezterm\wezterm.exe   (портабельный, на флешке)
::   2. %ProgramFiles%\WezTerm\wezterm.exe (winget/scoop)
::   3. %PATH% (wezterm)
:: Если не найден — запускает _setup_terminal.ps1
:: ============================================================================
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "WEZTERM_PORTABLE=%SCRIPT_DIR%external\wezterm\wezterm.exe"
set "WEZTERM_PROGRAMFILES=%ProgramFiles%\WezTerm\wezterm.exe"
set "WEZTERM_CONFIG=%SCRIPT_DIR%external\wezterm\wezterm.lua"

:: ── Step 1: Find WezTerm ──────────────────────────────────────────
set "WEZTERM="

if exist "%WEZTERM_PORTABLE%" (
    set "WEZTERM=%WEZTERM_PORTABLE%"
    echo [ok] Using portable WezTerm: external\wezterm\
) else (
    for %%p in ("%WEZTERM_PROGRAMFILES%") do if exist %%p (
        set "WEZTERM=%WEZTERM_PROGRAMFILES%"
        echo [ok] Using installed WezTerm: %ProgramFiles%\WezTerm
    )
)

if "%WEZTERM%"=="" (
    where wezterm >nul 2>&1
    if !errorlevel! equ 0 (
        set "WEZTERM=wezterm"
        echo [ok] WezTerm found in PATH
    )
)

:: ── Step 2: Not found → offer setup ───────────────────────────────
if "%WEZTERM%"=="" (
    echo.
    echo WezTerm not found. Launching setup...
    echo.
    powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%_setup_terminal.ps1"
    if errorlevel 1 (
        echo.
        echo Setup failed or was cancelled.
        echo Falling back to Windows Terminal / cmd.exe...
        echo Run: opencode
        pause
        exit /b 1
    )
    :: After setup, try again
    if exist "%WEZTERM_PORTABLE%" (
        set "WEZTERM=%WEZTERM_PORTABLE%"
    )
)

:: ── Step 3: Generate config if missing ─────────────────────────────
if not exist "%WEZTERM_CONFIG%" (
    echo [ok] Creating default WezTerm config...
    (
        echo local wezterm = require^("wezterm"^)
        echo local config = wezterm.config_builder^(^)
        echo config.enable_kitty_graphics = true
        echo config.font = wezterm.font^("JetBrains Mono"^)
        echo config.font_size = 13.0
        echo config.color_scheme = "Tokyo Night"
        echo config.window_decorations = "TITLE ^| RESIZE"
        echo config.window_padding = ^{ left = 8, right = 8, top = 8, bottom = 8 ^}
        echo config.window_background_opacity = 0.95
        echo config.win32_system_backdrop = "Acrylic"
        echo config.use_fancy_tab_bar = false
        echo config.max_fps = 60
        echo config.audible_bell = "Disabled"
        echo config.hide_mouse_cursor_when_typing = false
        echo config.leader = ^{ key = "a", mods = "CTRL", timeout_milliseconds = 1000 ^}
        echo config.keys = ^{
        echo   ^{ key = "c", mods = "CTRL",       action = wezterm.action.CopyTo^("Clipboard"^) ^},
        echo   ^{ key = "C", mods = "CTRL^|SHIFT", action = wezterm.action.CopyTo^("Clipboard"^) ^},
        echo   ^{ key = "v", mods = "CTRL",       action = wezterm.action.PasteFrom^("Clipboard"^) ^},
        echo   ^{ key = "V", mods = "CTRL^|SHIFT", action = wezterm.action.PasteFrom^("Clipboard"^) ^},
        echo   ^{ key = "T", mods = "CTRL^|SHIFT", action = wezterm.action.SpawnTab^("CurrentPaneDomain"^) ^},
        echo   ^{ key = "w", mods = "CTRL",       action = wezterm.action.CloseCurrentTab^(^{ confirm = true ^}^) ^},
        echo   ^{ key = "^|", mods = "LEADER", action = wezterm.action.SplitHorizontal^(^{ domain = "CurrentPaneDomain" ^}^) ^},
        echo   ^{ key = "-",  mods = "LEADER", action = wezterm.action.SplitVertical^(^{ domain = "CurrentPaneDomain" ^}^) ^},
        echo   ^{ key = "LeftArrow",  mods = "LEADER", action = wezterm.action.ActivatePaneDirection^("Left"^) ^},
        echo   ^{ key = "RightArrow", mods = "LEADER", action = wezterm.action.ActivatePaneDirection^("Right"^) ^},
        echo   ^{ key = "UpArrow",    mods = "LEADER", action = wezterm.action.ActivatePaneDirection^("Up"^) ^},
        echo   ^{ key = "DownArrow",  mods = "LEADER", action = wezterm.action.ActivatePaneDirection^("Down"^) ^},
        echo ^}
        echo return config
    ) > "%WEZTERM_CONFIG%"
)

:: ── Step 4: Launch WezTerm in the opencode directory ───────────────
echo [ok] Launching opencode in WezTerm...
start "" "%WEZTERM%" start --cwd "%SCRIPT_DIR%."

:: Wait a moment for WezTerm to start, then send opencode
timeout /t 2 /nobreak >nul

exit /b 0
