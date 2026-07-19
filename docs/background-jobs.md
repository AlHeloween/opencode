# Background Jobs — Non-blocking Command Execution

## Overview

All `bash` and `cmd` tool invocations run as **non-blocking background jobs** by default. The agent receives a job ID immediately and polls for output. This eliminates hangs from slow or stuck commands (Electron apps, network-dependent tools, database workers).

Synchronous execution is opt-in: `run_in_background: false` for quick commands like `echo` or `git status`.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AGENT                                │
│                                                             │
│  bash "logseq graph info"                                   │
│  (run_in_background: true by default)                       │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────┐    jobID: bash-1                              │
│  │ Jobs     │◄─── startEffect()                             │
│  │ Service  │    returns immediately                        │
│  └────┬─────┘                                               │
│       │                                                     │
│       ├─ fiber running command                              │
│       │  ├─ output chunks → persistUpdate()                  │
│       │  │                   → Bus.publish(JobsUpdated)      │
│       │  ├─ 15s no output → status: "stalled"               │
│       │  └─ complete → status: "done" / "failed"            │
│       │                                                     │
│  ┌────┴─────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ job_output│    │ job_wait     │    │ job_kill         │   │
│  │ Read      │    │ Poll until   │    │ Kill running or  │   │
│  │ output +  │    │ done/stalled │    │ stalled job      │   │
│  │ status    │    │ /timeout     │    │                  │   │
│  └──────────┘    └──────────────┘    └──────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ Bus.publish("jobs.updated")
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                        TUI (Solid)                           │
│                                                             │
│  ┌───────────────────────┐  ┌─────────────────────────────┐ │
│  │ Sidebar: Jobs panel   │  │ Chat: JobTool component     │ │
│  │                       │  │                             │ │
│  │ Background Jobs       │  │ ┃ ⏳ Job output bash-1      │ │
│  │ ⏳ bash-1      12s    │  │ ┃ bash-1  running           │ │
│  │ ⚠ bash-2      18s    │  │ ┃ [started] logseq graph... │ │
│  │ Recent (3)            │  │ ┃ Click to expand            │ │
│  │ ✓ bash-0 — echo quick │  │                             │ │
│  │ ✗ task-1 — failed     │  │ (click to expand full       │ │
│  │ ⊘ bash-3 — killed     │  │  output, same as ShellTool) │ │
│  └───────────────────────┘  └─────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## State Machine

```
                    startEffect()
                         │
                    ┌────▼────┐
                    │ running │──output written──→ Bus.publish(JobsUpdated)
                    └───┬─┬───┘
                        │ │
           15s no output│ │  run() completes
                        │ │
                   ┌────▼─┴────┐
                   │  stalled   │    Agent sees status via job_output
                   └────┬──────┘
                        │
              Agent calls job_kill
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────▼───┐     ┌─────▼────┐    ┌─────▼────┐
   │ killed │     │   done   │    │  failed  │
   └────────┘     └──────────┘    └──────────┘
```

## Tool Reference

| Tool | Purpose | Parameters |
|------|---------|------------|
| `bash` / `cmd` | Execute command (background by default) | `command`, `description`, `timeout`, `workdir`, `run_in_background` |
| `job_output` | Read incremental output + status of a job | `job_id` |
| `job_wait` | Poll until job(s) reach terminal state | `job_ids?`, `timeout?` (default 30s) |
| `job_kill` | Kill a running or stalled job | `job_id` |

## Status Values

| Status | Meaning | Agent action |
|--------|---------|-------------|
| `running` | Job is executing, producing output | Poll `job_output`, check output |
| `stalled` | No output for 15s — may be hung | Consider `job_kill` or wait longer |
| `done` | Completed successfully | Read final output with `job_output` |
| `failed` | Threw an error | Check error in output, decide next step |
| `killed` | Aborted by agent or crash recovery | Output up to kill point is preserved |

## Timeout & Safety Nets

| Mechanism | Timeout | What happens |
|-----------|---------|-------------|
| Inner timeout | `params.timeout` (default 60s via `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`) | Process killed via `taskkill /T /F` (tree kill) |
| Drain timeout | 10s per pipe (stdout, stderr) | Pipe drain times out instead of hanging forever |
| Safety net | `timeout + 5s` | Last-resort scope timeout prevents Effect fiber leak |
| Stalled detection | 15s no output, checked every 5s | Status → `stalled`, agent decides to kill or wait |
| Cleanup grace | 10s (was 250ms) | Pending tool calls get time to finish when stream ends |

## Configuration

```jsonc
// opencode.json
{
  "experimental": {
    // Override default bash timeout (milliseconds)
    "bashTimeoutMs": 120000
  }
}
```

For per-command timeout, pass `timeout` parameter directly:

```
bash "long-command" --timeout 30000
```

## Window of Visibility

**Agent** sees:
- Job ID immediately after starting a command
- Status + output via `job_output`
- Completed job summaries via `job_wait` or `<background-jobs>` in prompt
- Stalled jobs via status change

**User** sees (TUI):
- Sidebar: live job list with status badges, elapsed time, output preview
- Chat: JobTool components render `job_output`/`job_kill`/`job_wait` inline with expandable output
- Click to expand/collapse job output (last 5 lines shown by default)

## Permission Flow

```
┌──────────────────────────────────────────────────────────────┐
│                 Permission Evaluation Order                  │
│                                                              │
│  1. User config (opencode.json)                              │
│     permission.external_directory.{path}: "allow"|"deny"|"ask"│
│                                                              │
│  2. Navigation rules (opencode.json)                         │
│     navigation.allow / navigation.deny                       │
│                                                              │
│  3. external_directory_mode (opencode.json)                  │
│     "allow" | "ask" (default) | "deny"                       │
│                                                              │
│  4. System defaults (built-in, overridable)                  │
│     C:\Windows\* → allow    /usr/* → allow                   │
│     C:\Program Files\* → allow    /bin/* → allow             │
│     /sbin/* → allow    /etc/* → allow                        │
│                                                              │
│  Higher number = lower priority.                             │
│  User config always wins over system defaults.               │
└──────────────────────────────────────────────────────────────┘

                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              Permission Popup (TUI)                           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ △ External directory access                         │     │
│  │                                                     │     │
│  │ C:\Users\...\WindowsApps\*                          │     │
│  │                                                     │     │
│  │ [Allow once] [Always allow] [Reject]                │     │
│  │                                                     │     │
│  │ "Always allow" → saved to config.json               │     │
│  │ "Allow once" → session-only, until restart          │     │
│  │                                                     │     │
│  │ Permanent policy: /permissions → edit rules          │     │
│  │ Edit config:     /edit-config → open in editor      │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### Editing Permissions

**TUI command `/permissions`** — interactive dialog for tool policies and external_directory mode.

**TUI command `/edit-config`** — opens `config.json` in system default editor (VSCode, Notepad, etc.). Syntax validated on reload.

**Manual edit** — add to `opencode.json`:
```jsonc
{
  "permission": {
    "external_directory": {
      "C:\\Users\\*\\AppData\\Local\\Microsoft\\WindowsApps\\*": "allow",
      "C:\\MyTool\\*": "allow",
      "/opt/custom/*": "allow"
    }
  }
}
```

## Internal Packages

| Package | Role |
|---------|------|
| `packages/opencode/src/jobs/` | Job state machine, SQLite persistence, Bus events |
| `packages/opencode/src/tool/job_kill.ts` | LLM-callable kill tool |
| `packages/opencode/src/tool/job_output.ts` | LLM-callable output + wait tools |
| `packages/opencode/src/tool/bash.ts` | Background execution via `Jobs.startEffect` |
| `packages/opencode/src/tool/cmd.ts` | Same for cmd.exe |
| `packages/opencode/src/tool/external-directory.ts` | Shared external_directory permission check |
| `packages/opencode/src/config/config.ts` | Config loading with system defaults |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/jobs.tsx` | TUI sidebar panel |
| `packages/opencode/src/cli/cmd/tui/context/sync.tsx` | Sync bridge: `session_jobs` store |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | `/edit-config` and `/permissions` commands |
| `packages/plugin/src/tui.ts` | Plugin API types: `TuiJobItem` |
| `packages/sdk/js/src/*/gen/types.gen.ts` | SDK types: `EventJobsUpdated` |
