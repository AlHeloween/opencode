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
        echo config.font = wezterm.font^("Cascadia Code"^)
        echo config.font_size = 13.0
        echo config.color_scheme = "Catppuccin Mocha"
        echo config.use_fancy_tab_bar = false
        echo config.window_decorations = "RESIZE"
        echo config.max_fps = 60
        echo return config
    ) > "%WEZTERM_CONFIG%"
)

:: ── Step 4: Launch WezTerm in the opencode directory ───────────────
echo [ok] Launching opencode in WezTerm...
start "" "%WEZTERM%" start --cwd "%SCRIPT_DIR%."

:: Wait a moment for WezTerm to start, then send opencode
timeout /t 2 /nobreak >nul

exit /b 0
