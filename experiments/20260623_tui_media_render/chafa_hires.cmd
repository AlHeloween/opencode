@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   Chafa Hi-Res Test
echo ============================================
echo.

:: Get terminal size via PowerShell (reliable)
for /f "usebackq tokens=1,2 delims=x" %%a in (`powershell -NoProfile -c "$h=(Get-Host).UI.RawUI.WindowSize; Write-Host ('{0}x{1}' -f $h.Width,$h.Height)"`) do (
  set COLS=%%a
  set ROWS=%%b
)
echo Terminal: %COLS%x%ROWS%
echo.

:: Extract frame
ffmpeg -y -i "D:\zPython\opencode\artifacts\Alcohol-Purification.mp4" ^
  -vframes 1 -f image2 frame.png 2>nul
echo Frame: frame.png
echo.

:: Test 1: auto-detect terminal size
echo [TEST 1] chafa auto-size (no --size flag)
echo --------------------------------------------------
chafa --format symbols --color-space rgb frame.png
echo.

:: Test 2: full terminal width, half height
set /a HALF_ROWS=%ROWS% / 2
echo [TEST 2] chafa --size %COLS%x%HALF_ROWS%
echo --------------------------------------------------
chafa --format symbols --color-space rgb --size %COLS%x%HALF_ROWS% frame.png
echo.

:: Test 3: full terminal
echo [TEST 3] chafa --size %COLS%x%ROWS% (full terminal)
echo --------------------------------------------------
chafa --format symbols --color-space rgb --size %COLS%x%ROWS% frame.png
echo.

:: Test 4: 2x terminal (if chafa can handle it)
set /a COLS2=%COLS% * 2
set /a ROWS2=%ROWS% * 2
echo [TEST 4] chafa --size %COLS2%x%ROWS2% (2x terminal)
echo --------------------------------------------------
chafa --format symbols --color-space rgb --size %COLS2%x%ROWS2% frame.png 2>&1
echo.

:: Test 5: kitty mode with full terminal size
echo [TEST 5] chafa --format kitty --size %COLS%x%ROWS%
echo --------------------------------------------------
chafa --format kitty --size %COLS%x%ROWS% frame.png 2>&1
echo exit: %ERRORLEVEL%

echo.
echo ============================================
pause
