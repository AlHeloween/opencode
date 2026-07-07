@echo off
:: ============================================================================
:: Тест: рендеринг dragon.jpg в opencode TUI через WezTerm + Kitty
::
:: Двойной клик → WezTerm → opencode → dragon.jpg внутри TUI
:: ============================================================================
setlocal

set "ROOT=%~dp0..\.."
set "WEZTERM=%ProgramFiles%\WezTerm\wezterm.exe"

if not exist "%WEZTERM%" (
    set "WEZTERM=%ROOT%\external\wezterm\wezterm.exe"
)

echo === TUI Image Rendering Test ===
echo Root: %ROOT%
echo WezTerm: %WEZTERM%
echo.

"%WEZTERM%" start --cwd "%ROOT%" -- bun run experiments/tui-image-rendering/render-full-pipeline.ts
