@echo off
:: OpenTUI 3D Smoketest launcher
:: Opens in Windows Terminal if available, otherwise WezTerm, else falls back to direct run.
setlocal enabledelayedexpansion
set "ROOT=%~dp0..\.."
set "CWD=%ROOT%\packages\opencode"
set "SCRIPT=experiments\tui-image-rendering\smoketest-3d.tsx"

:: Find bun
set "BUN="
where bun >nul 2>nul
if %errorlevel% equ 0 set "BUN=bun"
if "%BUN%"=="" (
    if exist "%ROOT%\tools\bun.exe" set "BUN=%ROOT%\tools\bun.exe"
)
if "%BUN%"=="" (
    echo bun not found in PATH or tools\
    pause
    exit /b 1
)

:: Try Windows Terminal first
where wt >nul 2>nul
if %errorlevel% equ 0 (
    start wt -d "%CWD%" "%BUN%" run "%SCRIPT%"
    goto :done
)

:: Try WezTerm
where wezterm >nul 2>nul
if %errorlevel% equ 0 (
    start wezterm start --cwd "%CWD%" -- "%BUN%" run "%SCRIPT%"
    goto :done
)

:: Fallback: direct
echo Running in current terminal...
cd /d "%CWD%"
"%BUN%" run "%SCRIPT%"

:done
