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
│       │  ├─ output chunks → job writer (memory + ≥500ms      │
│       │  │                   persist/publish throttle)       │
│       │  ├─ 15s no output → "stalled" + ⚠ stall notice       │
│       │  ├─ jobreset → re-arm; else auto-kill at deadline    │
│       │  └─ complete → status: "done" / "failed"            │
│       │                                                     │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐    │
│  │ job_output│ │ job_wait  │ │ job_kill  │ │ job_reset │    │
│  │ output +  │ │ poll until│ │ kill the  │ │ re-arm    │    │
│  │ status    │ │ terminal  │ │ job tree  │ │ deadline  │    │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘    │
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
                   ┌────▼─┴────┐  ⚠ stall notice (once per episode): cpu,
                   │  stalled   │  remaining seconds, `jobreset` hint.
                   └────┬──────┘  jobreset → running (fresh window);
                        │         no reset → auto-kill at stall deadline.
              Agent calls job_kill
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────▼───┐     ┌─────▼────┐    ┌─────▼────┐
   │ killed │     │   done   │    │  failed  │
   └────────┘     └──────────┘    └──────────┘
```

## Stall Policy — warning, reset, auto-kill (2026-09-18)

A silent background job may be legitimately long (test suite, build, download) or
genuinely hung — the heartbeat cannot tell. Policy:

1. **15s of no output** → status `stalled` (unchanged).
2. **One ⚠ notice per stall episode** reaches the agent with the next prompt:
   `⚠ bash-9 (build) silent 30s, cpu 12.3 — potentially stalled; will be killed
   in 90s unless reset (jobreset bash-9)`. The CPU reading comes from the job's
   attached root pid.
3. **`jobreset <id>`** re-arms the deadline (one fresh window) and returns the job
   to `running`. Only the agent can tell slow from hung — so only the agent extends.
4. **No reset** → auto-kill 120s (`STALL_KILL_MS`) after
   `max(lastOutputAt, stallResetAt)`; the job's process **tree** is killed by pid
   (`taskkill /pid <pid> /T /F` on Windows, `kill(-pid)` elsewhere).

Two supporting fixes this depends on:

- **Streaming:** `cmd`/`bash` background jobs pass their `writeOutput` into
  `run()` (`onChunk` → job writer), so `lastOutputAt` tracks real output instead
  of sitting at the `[started]` banner. Before this, every job silent for 2 min
  was auto-killed *because its output never reached the jobs layer at all*
  (measured 2026-09-18: bash-6/8/9 killed at +2m01–2m04s with `[started]`-only
  output). Durable writes + TUI publishes are throttled to ≥500ms. The first
  chunk strips the `[started]` banner and resets the read offset, so incremental
  `job_output` reads see the stream even if the agent already read the banner.
- **Tree kill:** the job's root pid is attached at spawn (`self.setPid`) and the
  kill path runs `taskkill /T /F` **before** `proc.kill()` — a dead root has no
  tree left to walk, which is how a "killed" build kept running as an orphan
  (2026-09-18).

Regression guards (hard tests, fail if the wiring is removed):
`test/jobs/jobs.test.ts` (stall notice text, reset semantics, auto-kill,
real-process tree kill, banner-replacement read recovery, source invariants for
`cmd.ts`/`bash.ts` and the spawner kill order) and
`test/tool/job-workflow.test.ts` (streaming while running, `jobreset` tool).

## Boot Recovery & Zombie Sweep (2026-09-18)

`jobs.db` is **per-worktree**, so every runtime in a worktree shares it. Recovery on
open is therefore instance-aware, and every re-kill is gated on a pid-reuse probe.

**Persisted columns:** `pid` (root child, attached by `self.setPid`) and `owner_pid`
(the runtime that created the job). DBs created before these columns are migrated by
an `ALTER TABLE` guarded with `PRAGMA table_info`.

**Recovery on DB open** (`recoverOrphans`):

| Row state | Action |
|-----------|--------|
| `owner_pid` is a **live** process other than us | **left alone** — it belongs to that runtime's in-memory map. (The old recovery flipped *every* `running` row, silently corrupting a live neighbour's records.) |
| `owner_pid` provably dead, `pid` recorded | status → `killed`, then a **guarded** tree kill |
| `owner_pid` NULL (legacy row) | status → `killed`, **never killed** — ownership unverifiable |

**The pid-reuse guard.** Windows reuses pids, so `taskkill /pid <reused> /T /F` would
take down an innocent process. A job's root child is attached within seconds of
`startedAt`, so a recorded pid is still ours only if the live process with that pid
started within 60 s of `startedAt`. One batched probe per sweep:

```powershell
Get-Process -Id <pid>,… | ForEach-Object { "$($_.Id) $($_.StartTime.ToUniversalTime().Ticks)" }
```

`ToUniversalTime()` is **required, not cosmetic**: `Process.StartTime` is a *local*
DateTime, so its raw `.Ticks` differ from the UTC epoch by the machine's offset and the
window would never match (measured 2026-09-18: raw ticks → delta −28 799 352 ms,
exactly −8 h; converted → 520 ms). A guard that silently never fires is the failure
mode this pins. The probe is **fail-safe**: unreadable ⇒ do not kill.

**Zombie sweep (`job_kill` on a `killed` job).** A kill that failed to reap its tree
leaves status `killed` with the process alive (the `bash-9` incident). Calling `job_kill`
again on a `killed` job re-attempts the tree kill — but only when the recorded pid still
passes the guard; otherwise `killed: false` + a warn, and the terminal status is
preserved. `done`/`failed` stay a plain no-op.

Regression guards: `test/jobs/jobs.test.ts` — pid+owner reach `jobs.db` (read back from
the artifact), a live owner's row is untouched, a dead owner's orphan tree is really
killed, the zombie re-kill fires, and a later call once the process is gone returns
`false`. **Negative control (2026-09-18):** with the match window zeroed, both kill tests
FAIL and the live-owner test still passes — the tests are sensitive to the guard itself,
not merely to "some kill happened".

## Tool Reference

| Tool | Purpose | Parameters |
|------|---------|------------|
| `bash` / `cmd` | Execute command (background by default) | `command`, `description`, `timeout`, `workdir`, `run_in_background` |
| `job_output` | Read incremental output + status of a job. Optional `pattern` (regex) filters the **full** accumulated output and does **not** advance the read offset (multi-grep). | `job_id`, optional `pattern` |
| `job_wait` | Poll until job(s) reach terminal state | `job_ids?`, `timeout?` (default 30s) |
| `job_kill` | Kill a running or stalled job; on a `killed` job re-attempts a **guarded** tree kill (zombie sweep) | `job_id` |
| `job_reset` | Re-arm the stall deadline of a running/stalled job (keeps it running; does not touch output/result) | `job_id` |

## Status Values

| Status | Meaning | Agent action |
|--------|---------|-------------|
| `running` | Job is executing, producing output | Poll `job_output`, check output |
| `stalled` | No output for 15s — may be hung, may be a silent long job | ⚠ notice names cpu + deadline; `job_reset` to extend, `job_kill` to abort. Auto-killed if neither |
| `done` | Completed successfully | Read final output with `job_output` |
| `failed` | Threw an error | Check error in output, decide next step |
| `killed` | Aborted by agent or crash recovery. Calling `job_kill` again re-attempts a **guarded** tree kill (zombie sweep) | Output up to kill point is preserved |

## Timeout & Safety Nets

| Mechanism | Timeout | What happens |
|-----------|---------|-------------|
| Inner timeout | `params.timeout` (default 60s via `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`) | Process killed via `taskkill /T /F` (tree kill) |
| Drain timeout | 10s per pipe (stdout, stderr) | Pipe drain times out instead of hanging forever |
| Safety net | `timeout + 5s` | Last-resort scope timeout prevents Effect fiber leak |
| Stalled detection | 15s no output, checked every 5s | Status → `stalled` + one ⚠ notice (cpu, remaining seconds, `jobreset` hint) |
| Stall auto-kill | 120s of stall; deadline = `max(lastOutputAt, stallResetAt)` + 120s | Job killed by pid tree (`taskkill /T /F` / `kill(-pid)`); `job_reset` re-arms before the deadline |
| Boot recovery | on DB open | A **dead** runtime's rows → `killed` + guarded tree kill; a live runtime's rows are left alone; a reused pid is never killed |
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
- ⚠ stall notices (cpu, deadline, reset hint) in the next turn's `<background-jobs>` block

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

## cmd_runner Jobs — Auto-Tail & Auto-Wrap (2026-09-07)

Two integrations close the gap between a background job's tiny bootstrap output and
the real result living in the cmd_runner session log:

1. **Auto-tail on jobdone.** When a background job runs a `cmd_runner start -- …`
   command, its captured output is usually just a banner + run_id (the session runs
   in its own window). On job completion the runner appends a bounded
   `cmd_runner tail <run_id> -n 60` snapshot (20s timeout) to the job output, marked
   `--- cmd_runner session tail (<run_id>) ---`. Skipped when the session already
   streamed to completion in-band (`[session …: finished]`). Tail failures are
   debug-logged, never fatal. Implementation: `src/tool/cmd-runner-tail.ts`,
   wired into the background paths of `bash.ts` / `cmd.ts` / `run.ts`.

2. **Constitution auto-wrap.** Commands hitting crash-prone binaries (bun, cargo,
   go, cmake, …) are no longer rejected with "must run through cmd_runner" —
   `autoWrapCmdRunner()` / `autoWrapBinary()` (`src/tool/shell-constitution.ts`)
   transparently route them as `cmd_runner start -- <command>` and the output gets a
   one-line `constitution: auto-wrapped via cmd_runner start --` notice. Permission
   patterns stay granular (`bun *`), send-payloads are untouched, and
   `enforceBinaryViaCmdRunner` remains as a defense-in-depth net for bare calls.

## Internal Packages

| Package | Role |
|---------|------|
| `packages/opencode/src/jobs/` | Job state machine, SQLite persistence, Bus events |
| `packages/opencode/src/tool/jobkill.ts` | LLM-callable kill tool (`job_kill`) |
| `packages/opencode/src/tool/jobreset.ts` | LLM-callable stall-deadline reset tool (`job_reset`) |
| `packages/opencode/src/tool/joboutput.ts` | LLM-callable output tool (`job_output`); optional `pattern` regex filters full buffer without advancing read offset |
| `packages/opencode/src/tool/bash.ts` | Background execution via `Jobs.startEffect` |
| `packages/opencode/src/tool/cmd.ts` | Same for cmd.exe |
| `packages/opencode/src/tool/external-directory.ts` | Shared external_directory permission check |
| `packages/opencode/src/config/config.ts` | Config loading with system defaults |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/jobs.tsx` | TUI sidebar panel |
| `packages/opencode/src/cli/cmd/tui/context/sync.tsx` | Sync bridge: `session_jobs` store |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | `/edit-config` and `/permissions` commands |
| `packages/plugin/src/tui.ts` | Plugin API types: `TuiJobItem` |
| `packages/sdk/js/src/*/gen/types.gen.ts` | SDK types: `EventJobsUpdated` |
