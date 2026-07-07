@echo off
:: OpenTUI 3D Smoketest launcher
setlocal
set "ROOT=%~dp0..\.."
set "PKG=%ROOT%\packages\opencode"
set "SCRIPT=%PKG%\experiments\tui-image-rendering\smoketest-3d.tsx"

:: Find bun
for %%i in (bun) do set "BUN=%%~$PATH:i"
if "%BUN%"=="" if exist "%ROOT%\tools\bun.exe" set "BUN=%ROOT%\tools\bun.exe"
if "%BUN%"=="" (echo bun not found & pause & exit /b 1)

:: Windows Terminal
where wt >nul 2>nul && (
    start wt -d "%PKG%" cmd /c "%BUN% run %SCRIPT% %*"
    exit /b 0
)

:: WezTerm
where wezterm >nul 2>nul && (
    start wezterm start --cwd "%PKG%" -- "%BUN%" run "%SCRIPT%"
    exit /b 0
)

:: Fallback
cd /d "%PKG%"
"%BUN%" run "%SCRIPT%" %*
