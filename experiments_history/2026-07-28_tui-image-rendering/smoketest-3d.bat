@echo off
set "PROJECT=D:\zPython\opencode\packages\opencode"
set "SCRIPT=experiments\tui-image-rendering\smoketest-kitty.tsx"
wezterm start --cwd "%PROJECT%" -- cmd /c bun run "%SCRIPT%"
