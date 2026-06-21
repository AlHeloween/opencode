# Model Priority Order + cmd_runner tail Fix

**Date**: 2026-06-20
**Status**: planning

---

## Goal 1: Add deepseek-v4-pro to model priority list

**SV**: model-priority, sort, defaultModel, deepseek-v4-pro, big-pickle, opencode.jsonc, provider
**Done**: 0%

### Abstract definition

The `Provider.sort()` function uses a hard-coded priority array to rank models. Currently `deepseek-v4-pro` is absent from this array. On fresh installs (no `model.json` state), the default model falls through to whatever provider is loaded first + its sorted models. By adding `deepseek-v4-pro` to the priority array, we ensure it ranks above `big-pickle` when sorting the deepseek provider's models.

The full selection chain for `defaultModel()` is:
1. `cfg.model` (from `opencode.jsonc` / user config) — unchanged, already highest priority
2. `model.json` recent history — unchanged, already handles prior usage
3. `sort()` with priority array — **change here**: add `deepseek-v4-pro` at index 2

### Math formalization

Current: `priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]`
- `sort()` uses `priority.findIndex((filter) => model.id.includes(filter))` with `"desc"` direction
- Higher index = higher sort position
- `gemini-3-pro`: index 3 → first
- `big-pickle`: index 2 → second
- `claude-sonnet-4`: index 1 → third
- `gpt-5`: index 0 → fourth
- non-matching: -1 → last

Change: `priority = ["gpt-5", "claude-sonnet-4", "deepseek-v4-pro", "big-pickle", "gemini-3-pro"]`
- `gemini-3-pro`: index 4 → first (unchanged, only affects opencode provider)
- `big-pickle`: index 3 → second (moved down one)
- `deepseek-v4-pro`: index 2 → third (NEW)
- `claude-sonnet-4`: index 1 → fourth
- `gpt-5`: index 0 → fifth
- non-matching: -1 → last

### Structural diagram

```
defaultModel()
  │
  ├─ cfg.model? → return parseModel(cfg.model)    // opencode.jsonc config
  │
  ├─ model.json recent? → return first match        // e.g. deepseek/deepseek-v4-pro
  │
  └─ first provider + sort(models)
       │
       ├─ deepseek provider → sort → deepseek-v4-pro (index 2, wins over non-priority)
       ├─ opencode provider → sort → gemini-3-pro (index 4, wins)
       └─ other provider → sort → no priority matches, reverse-alpha
```

### Input/output parameters

**Input**: provider models list `{ id: string }[]`
**Output**: sorted models list, same length, ordered by priority

### Brief implementation

**File**: `packages/opencode/src/provider/provider.ts:1715`

```typescript
// BEFORE
const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]

// AFTER
const priority = ["gpt-5", "claude-sonnet-4", "deepseek-v4-pro", "big-pickle", "gemini-3-pro"]
```

One-line change. `deepseek-v4-pro` matches only deepseek provider models (other providers don't have `deepseek-v4-pro` in their model IDs), so this change is scoped correctly.

### Test cases

- [ ] Fresh install (no model.json): deepseek provider loaded, deepseek-v4-pro is default
- [ ] Fresh install (no model.json): opencode provider only, big-pickle remains default
- [ ] Existing install with model.json: recent model wins (no regression)
- [ ] opencode.jsonc with explicit model: config wins (no regression)
- [ ] `Provider.sort()` with deepseek models: deepseek-v4-pro sorts before other deepseek models

---

## Goal 2: Fix cmd_runner tail --wait-ms blocking in bash

**SV**: cmd_runner, tail, wait-ms, blocking, timeout, bash-tool, snapshot, follow, Delphi
**Done**: 0%

### Abstract definition

`cmd_runner tail <id> --wait-ms 3000` enters follow mode: it keeps running until the tracked process exits, polling every 3000ms for new output. When called from the bash tool (10s default timeout), it blocks for 10 seconds with zero output, then gets killed by the timeout. This is by design for `--wait-ms` (follow mode), but the lack of an initial snapshot before entering follow mode makes it unusable in bash tool contexts.

Since `cmd_runner.exe` is a closed-source Delphi binary, the fix is to create a wrapper that:
1. Always calls snapshot `tail` first (no `--wait-ms`) for immediate output
2. Only enters follow mode after snapshot output is emitted
3. Respects a maximum total wait time

### Math formalization

Let T be the total allowed wait time (default: 3000ms from `--wait-ms`)
Let S be the snapshot output time (instant)
Let F be the follow time (polling every P ms until max or run ends)

Current behavior: F runs for duration Tₘₐₓ with NO output until run ends
Expected behavior: S runs first (output), then F runs with output as it arrives
Desired: S + F with total timeout max(Tₘₐₓ, 10s)

### Structural diagram

```
OLD (broken):
  cmd_runner tail <id> --wait-ms 3000
    → enters follow mode immediately
    → NO output for 3000ms+
    → bash tool kills at 10000ms with "(no output)"

NEW (wrapper):
  cmd_runner_tail.ps1 <id> --wait-ms 3000 --max-wait 10000
    → snapshot: cmd_runner tail <id> --lines 20    [immediate output]
    → if snapshot empty AND process running:
        follow: cmd_runner tail <id> --wait-ms 3000 [poll, kill after max-wait]
```

### Input/output parameters

**Input**:
- `run_id: string` — the cmd_runner run ID
- `lines: number` — lines to show (default: 20)
- `wait_ms: number` — poll interval for follow mode (default: 0 = snapshot only)
- `max_wait_ms: number` — maximum total wait time (default: 8000)

**Output**: stdout from cmd_runner tail, or "(no output)" if empty

### Brief implementation

**File**: `tools/cmd_runner_tail.ps1` (new file)

```powershell
param(
    [Parameter(Mandatory=$true)]
    [string]$RunId,
    [int]$Lines = 20,
    [int]$WaitMs = 0,
    [int]$MaxWaitMs = 8000
)

$cmdRunner = Join-Path $PSScriptRoot ".." "cmd_runner.exe"

# Phase 1: Snapshot (always runs, returns immediately)
$snapshot = & $cmdRunner tail $RunId --lines $Lines 2>&1
if ($snapshot) {
    Write-Output $snapshot
}

# Phase 2: Follow (only if --wait-ms was requested and process still running)
if ($WaitMs -gt 0) {
    $status = & $cmdRunner status $RunId 2>&1 | Out-String
    if ($status -match "running") {
        $job = Start-Job -ScriptBlock {
            param($cr, $id, $lines, $wait)
            & $cr tail $id --lines $lines --wait-ms $wait 2>&1
        } -ArgumentList $cmdRunner, $RunId, $Lines, $WaitMs
        
        $completed = Wait-Job $job -Timeout $MaxWaitMs
        if (-not $completed) {
            Stop-Job $job
        }
        $followOutput = Receive-Job $job
        Remove-Job $job -Force
        
        if ($followOutput) {
            Write-Output $followOutput
        }
    }
}
```

### Alternative: simpler approach

If `cmd_runner tail` (no `--wait-ms`) already works correctly and returns immediately, just change the guidance in SKILL.md to prefer snapshot mode:

```
Use `cmd_runner tail <id>` for immediate output.
Use `--wait-ms N` ONLY when you need to follow and the run is expected to finish shortly.
Never use `--wait-ms` in a bash tool context with a timeout < 30s.
```

### Test cases

- [ ] `cmd_runner_tail.ps1 <id>` — returns snapshot immediately
- [ ] `cmd_runner_tail.ps1 <id> --wait-ms 3000` — returns snapshot then follows for up to 3000ms
- [ ] Process already finished: snapshot output, no follow
- [ ] No output available: returns "(no output)" within 100ms
- [ ] Process running with no new output: returns snapshot, follows, exits at max-wait

---

## Summary

| Goal | Change | File | Lines | Complexity |
|------|--------|------|-------|------------|
| G1 | Add `deepseek-v4-pro` to priority | `provider.ts` | ~1715 | 1 line |
| G2 | Create cmd_runner tail wrapper | `tools/cmd_runner_tail.ps1` | new file | ~40 lines |
| G2 (alt) | Update SKILL.md guidance | `SKILL.md` | ~88-90 | 2 lines |

Both changes are independent and low-risk.
