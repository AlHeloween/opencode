@echo off
:: OpenTUI 3D Smoketest launcher
:: Opens in Windows Terminal if available, otherwise WezTerm, else falls back to direct run.
setlocal
set "ROOT=%~dp0..\.."
set "CWD=%ROOT%\packages\opencode"
set "SCRIPT=experiments/tui-image-rendering/smoketest-3d.tsx"

:: Try Windows Terminal first
where wt >nul 2>nul
if %errorlevel% equ 0 (
    start wt -d "%CWD%" bun run %SCRIPT%
    goto :done
)

:: Try WezTerm
where wezterm >nul 2>nul
if %errorlevel% equ 0 (
    start wezterm start --cwd "%CWD%" -- bun run %SCRIPT%
    goto :done
)

:: Fallback: direct (for terminals that support ANSI/TUI)
echo Running in current terminal...
cd /d "%CWD%"
bun run %SCRIPT%

:done
