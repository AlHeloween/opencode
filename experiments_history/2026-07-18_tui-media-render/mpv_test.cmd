@echo off
echo ============================================
echo   mpv External Player Test
echo ============================================
echo.

echo [1] mpv --vo=tct (text fallback, 5 sec)
echo --------------------------------------------------
mpv --vo=tct --no-audio --really-quiet --length=5 ^
  --osd-level=0 --no-border ^
  --tct-algo=half-blocks ^
  "D:\zPython\opencode\artifacts\Alcohol-Purification.mp4" 2>&1
echo exit: %ERRORLEVEL%
echo.

echo [2] mpv --vo=null --audio-only test
echo    (pure audio, should hear sound)
echo --------------------------------------------------
mpv --vo=null --really-quiet --length=5 ^
  "D:\zPython\opencode\artifacts\Alcohol-Purification.mp4" 2>&1
echo exit: %ERRORLEVEL%
echo.

echo [3] mpv external window (--vo=gpu)
echo    (should open separate mpv window)
echo --------------------------------------------------
start "" mpv --vo=gpu --really-quiet --length=5 ^
  "D:\zPython\opencode\artifacts\Alcohol-Purification.mp4"
echo spawn exit: %ERRORLEVEL%
echo.

echo ============================================
echo   Results:
echo   [1] tct text output visible?
echo   [2] audio played?
echo   [3] mpv window opened?
echo ============================================
pause
