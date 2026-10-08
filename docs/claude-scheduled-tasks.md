intent:
How to run a Claude Desktop scheduled task unattended on this host without permission prompts.
Measured 2026-10-08; every line carries its status (CONFIRMED with the instrument, or NOT CONFIRMED).

# Claude Desktop scheduled tasks — unattended permission mode

## The working setup (CONFIRMED, owner's run 2026-10-08)

`C:\Users\Alexander\.claude\settings.json` (USER settings) carries a `permissions` block:

- `"defaultMode": "auto"`
- a narrow `allow` list: `git status/log/show`, `git add` limited to `experiments/2026-10-08_robot-wave/*` and
  `docs/robot-protocol-log.md`, `python experiments/2026-10-08_robot-wave/*`, `python tools/opencode_host.py*`,
  `python $HOME/.org/genesis/*`, `cmd_runner.exe start*`, plus the PowerShell twins and `Get-Content` on the
  wave folder, `Select-Object*`, `Select-String*`.

After a Desktop restart, task `hourly-robot-fleet-check` ("Run now") ran without a permission prompt
(CONFIRMED by the owner watching the session; the session API does not report its permission mode).

## What does NOT work (CONFIRMED by the owner's runs)

- `defaultMode: auto` in the PROJECT `.claude/settings.local.json` — the scheduled run still started in Manual.
  The docs say `auto` / `bypassPermissions` in project settings files is ignored (terminal section of the
  permission-modes page; NOT stated for Desktop, matches the observation).
- «Always allow» in the prompt dialog on a compound command: it stores that exact command; the next run builds a
  different compound one. Each sub-command of a compound must match an allow rule on its own.
- `set_session_permission_mode` on a running scheduled session helps that run only, not the next one.

## Not confirmed — do not guess, measure

- The default of a task's own permission mode field, and whether the Scheduled UI exposes it (NOT CONFIRMED).
- Whether project `settings.local.json` allow rules apply to scheduled sessions (NOT CONFIRMED; user settings are
  documented to).
- Whether «Run now» pre-approves compound commands (NOT CONFIRMED).
- A community report that «Allow for all scheduled runs» does not persist on Windows (search snippet only).

## Limits

- Desktop tasks fire only while the app is open and the machine is awake; a missed run fires on next launch.
- `defaultMode: auto` in user settings applies to ALL projects. Rollback: delete the `permissions` block.
- Alternative with the app closed: Windows Task Scheduler + `claude -p --permission-mode dontAsk --allowedTools ...`
  (no official Windows guidance found; NOT CONFIRMED).
- Orchestration without Claude: robot lane (queue.md t20); it does not depend on any of the above.

Sources (agent read, 2026-10-08): code.claude.com/docs — desktop-scheduled-tasks, desktop, permission-modes,
permissions, headless.
