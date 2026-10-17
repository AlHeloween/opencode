# Scheduled tasks — the tracked source of every Claude desktop routine

The Claude desktop app keeps its scheduled-task list **per account**. On 2026-10-17 the owner signed in under another
account: the list came back empty, the hourly fleet check stopped, and nobody watched org. The task folders were
still on disk (`C:/Users/Alexander/.claude/scheduled-tasks/<id>/SKILL.md`), but the new account's app did not list
them. Owner, 2026-10-17: «Настройки не сохранились надо что-то на эту тему придумать».

The rule is therefore: **a task's behaviour lives in git, here; the app holds only a one-line pointer.** Losing the app's
list then costs one re-registration, not the task.

## The tasks

| taskId | title | cron (local) | prompt (tracked) | purpose |
|---|---|---|---|---|
| `org-watch` | Наблюдение за org | `45 * * * *` | `scripts/scheduled-tasks/org-watch.md` | orgd health, claude's tickets, watched tickets, DONE receipts, chat/forum; report only |
| `hourly-robot-fleet-check` | Почасовая проверка флота роботов | `7 * * * *` (read from the old account's registry `claude-code-sessions/7c19a8b0…/scheduled-tasks.json`) | `experiments/2026-10-08_robot-wave/hourly-task-prompt.md` — **UNTRACKED** (experiments/ is gitignored); moving it here is the orchestrator lane's call | robots: verify finished work, refill up to 3 slots |

`robot-fleet-hourly` (folder dated 2026-10-08 08:32) is the older inline version of the fleet check. It was superseded
by `hourly-robot-fleet-check` and is not re-registered.

Both the fleet check and `org-watch` read org. The fleet check's step 1 reads the inbox; `org-watch` owns the ticket
lifecycle report. If both run, the fleet check should drop org from its own steps. This is an open decision for the
orchestrator lane.

## Where the app keeps per-account state (measured 2026-10-17)

`%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude-code-sessions\<account-id>\<org-id>\`:

- `local_<id>.json` — one record per session: `title`, `cliSessionId` (the transcript
  `~/.claude/projects/<slug>/<cliSessionId>.jsonl`), `cwd`, `model`, `scheduledTaskId`. Deleted sessions show up as
  `deleted_<id>`.
- `scheduled-tasks.json` — this account's task registry: id, cron, `filePath` pointing into
  `~/.claude/scheduled-tasks/<id>/SKILL.md`, approved permissions, `notifySessionId`.

The old account is `7c19a8b0…` (174 session records); the new one since 2026-10-17 18:10 is `2586824a…`. Switching
accounts loses nothing on disk. Only the app's view changes.

## Re-register after an account switch (or any empty task list)

The pointer prompt for each row is:

> Working directory: D:\zPython\opencode. Read the file `<prompt path>` and execute it exactly as written.

1. In a Claude session in this repo, call `list_scheduled_tasks`. For every row of the table that is missing, call
   `create_scheduled_task` with that taskId, title, cron and pointer prompt.
2. Start each task once by hand (`run_scheduled_task`), then read the run (`list_task_runs`, then the session). A
   task counts as registered only after a run that finished with its report. A run that ends with «You've hit your
   weekly limit» is NOT a running task: the account or model limit is the cause, so say so.
3. Record the re-registration in `_progress_log.md`.
