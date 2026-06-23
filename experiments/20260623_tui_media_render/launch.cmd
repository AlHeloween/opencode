@echo off
setlocal

echo ============================================
echo   Media Rendering Smoke Test v4
echo   Single frame + fallback tests
echo ============================================
echo.

:: --- Test A: kitty VO, single frame (no video playback) ---
echo [TEST A] kitty VO - first frame only
echo --------------------------------------------------
mpv --vo=kitty ^
  --no-audio --really-quiet ^
  --start=0 --end=0.1 --length=0 ^
  --osd-level=0 --no-border ^
  "D:\zPython\opencode\artifacts\Alcohol-Purification.mp4" 2>&1
echo exit: %ERRORLEVEL%
echo.

:: --- Test B: tct VO (always works, text-based) ---
echo [TEST B] tct VO (true-color text fallback)
echo --------------------------------------------------
mpv --vo=tct ^
  --no-audio --really-quiet ^
  --start=0 --end=0.1 --length=0 ^
  --osd-level=0 --no-border ^
  --tct-algo=half-blocks ^
  "D:\zPython\opencode\artifacts\Alcohol-Purification.mp4" 2>&1
echo exit: %ERRORLEVEL%
echo.

:: --- Test C: Extract frame to PNG, then render ---
echo [TEST C] Extract first frame to PNG, render with kitty
echo --------------------------------------------------
mpv --vo=image --vo-image-format=png ^
  --vo-image-outdir=. ^
  --no-audio --really-quiet --loop-file=no ^
  --frames=1 --osd-level=0 --no-border ^
  "D:\zPython\opencode\artifacts\Alcohol-Purification.mp4" 2>&1
if exist "*.png" (
  for %%f in (*.png) do (
    echo Frame extracted: %%f
    mpv --vo=kitty --no-audio --really-quiet "%%f" 2>&1
    echo kitty render exit: %ERRORLEVEL%
  )
) else (
  echo No PNG extracted - image VO not available
)
echo.

echo ============================================
echo   Results:
echo   Test A (kitty video): Did frames render?
echo   Test B (tct blocks):  Did colored blocks appear?
echo   Test C (kitty image): Did static PNG render?
echo ============================================
pause
