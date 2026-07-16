---
name: cmd-runner
description: Run interactive commands safely via cmd_runner with per-run logs, inbox bridge, terminal auto-detection, and image capture support.
---

intent:
Run interactive commands safely with per-run logs, inbox bridge, and terminal auto-detection.
Use for long builds, package installs, test suites, interactive TUIs, and crash-prone commands.

state:
  tool: cmd_runner.exe

scope:
  - long builds
  - package installs
  - test suites
  - interactive TUIs
  - image rendering
  - crash-prone commands

constraints:
  - prefer_start_then_tail: True
  - no_long_fixed_waits: True

invariants:
  - All subprocesses open with SW_SHOWMINNOACTIVE (minimized, no focus steal)
  - Logs stored at logs/cmd_runner/<run_id>/
  - Input bridge at logs/cmd_runner/<run_id>/inbox.jsonl

forbidden_actions:
  - Using cmd_runner for quick checks (ls, git status, echo)
  - Using cmd_runner for simple file ops (cp, mv, rm)
  - Using cmd_runner for commands completing in <1s

## When to use
Use for: long builds (cargo build, msbuild, make), package installs (npm install, pip install),
test suites (pytest, cargo test), interactive TUIs (htop, ncurses), image rendering (chafa, timg),
crash-prone commands, commands producing thousands of output lines.
Do NOT use for: quick checks (ls, git status, echo), simple file ops (cp, mv, rm),
commands completing in <1s.

## Core workflow
1. START: cmd_runner start [--terminal HOST] [--raw|--no-raw] [--cwd PATH] -- <command ...>
   Prints run_id and inbox path. Auto-tails last 5 lines.
   --raw: raw pipes (no ConPTY), for non-interactive batch commands.
   --no-raw: ConPTY mode (default), supports interactive send/inbox.
2. STATUS: cmd_runner list [--all] [--json] / cmd_runner status <run_id> [--json]
3. TAIL: cmd_runner tail <run_id> [--follow] [-n N] [--wait-ms N]
   Start with non-follow for snapshot, --follow for live streaming.
4. SEND: cmd_runner send <run_id> --text "..." --crlf / --keys "ctrl+c" / --keys "TEXT:text,ENTER"
   --keys tokens: LEFT,RIGHT,UP,DOWN,HOME,END,INSERT,DELETE,TAB,ESC,ENTER,BACKSPACE,ctrl+a..ctrl+z,TEXT:text,CHAR:char,HEX:hex
5. STOP: cmd_runner stop <run_id> --reason "done"
   cmd_runner wait <run_id> [--timeout-s N] [--json]

## Terminal selection
--terminal wezterm / --terminal wt / --terminal conhost / --terminal alacritty
Auto-detection priority (Windows): wezterm > wt > conhost > bash
Auto-detection priority (Linux): wezterm > guake > yakuake > xterm > bash

## Image capture (--raw)
Raw mode for non-interactive batch commands only. Does NOT support send/inbox.
Kitty/Sixel/iTerm2 escape sequences survive raw pipes. Output captured with [IMG:...] markers.

## Quoting tips (PowerShell)
cmd_runner send <id> --crlf -- "python3 -c 'print(1+2)'"
cmd_runner send <id> --crlf -- 'echo ~~~hello~~~'   (use ~ instead of ")

## Log layout
logs/cmd_runner/<run_id>/: meta.json, state.json, stdout.log, stdout_text.log, stderr.log, inbox.jsonl
