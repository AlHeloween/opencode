@echo off
setlocal

echo ============================================
echo   Chafa Rendering Smoke Test
echo   chafa v1.18.2 + ffmpeg
echo ============================================
echo.

:: Extract first frame as PNG
echo Extracting first frame from video...
ffmpeg -y -i "D:\zPython\opencode\artifacts\Alcohol-Purification.mp4" ^
  -vframes 1 -f image2 frame.png 2>nul
if exist frame.png (
  echo Frame extracted: frame.png
) else (
  echo FAILED to extract frame
  pause & exit /b 1
)
echo.

:: --- Test 1: kitty protocol ---
echo [TEST 1] chafa --format kitty
echo --------------------------------------------------
chafa --format kitty --size 80x24 frame.png
echo.

:: --- Test 2: sixel protocol ---
echo [TEST 2] chafa --format sixel
echo --------------------------------------------------
chafa --format sixel --size 80x24 frame.png 2>&1
echo exit: %ERRORLEVEL% (0=OK, non-zero=not supported)
echo.

:: --- Test 3: symbols (block chars) ---
echo [TEST 3] chafa --format symbols (always works)
echo --------------------------------------------------
chafa --format symbols --size 80x24 frame.png
echo.

:: --- Test 4: symbols + color ---
echo [TEST 4] chafa --format symbols --color-space rgb
echo --------------------------------------------------
chafa --format symbols --color-space rgb --size 80x24 frame.png
echo.

:: --- Test 5: larger symbols ---
echo [TEST 5] chafa --format symbols --size 120x40
echo --------------------------------------------------
chafa --format symbols --size 120x40 frame.png
echo.

echo ============================================
echo   Which mode rendered best?
echo   [ ] kitty   - full image
echo   [ ] sixel   - full image  
echo   [ ] symbols - block characters
echo ============================================
pause
