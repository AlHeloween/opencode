@echo off
echo ============================================
echo   Kitty vs Sixel Head-to-Head
echo   Windows Terminal + chafa v1.18.2
echo ============================================
echo.

ffmpeg -y -i "D:\zPython\opencode\artifacts\Alcohol-Purification.mp4" -vframes 1 frame.png 2>nul

echo [1] KITTY PROTOCOL
echo --------------------------------------------------
chafa --format kitty frame.png
echo.
echo ^^^ Above should be the actual image ^^^
echo.

echo [2] SIXEL PROTOCOL  
echo --------------------------------------------------
chafa --format sixel frame.png 2>&1
echo.
echo ^^^ Above should be the actual image ^^^
echo.

echo [3] SYMBOLS (fallback)
echo --------------------------------------------------
chafa --format symbols --color-space rgb frame.png
echo.

echo ============================================
echo   Legend:
echo   [1] kitty  = highest quality, pixel-accurate
echo   [2] sixel  = pixel-accurate, legacy protocol
echo   [3] symbol = character blocks, universal fallback
echo ============================================
pause
