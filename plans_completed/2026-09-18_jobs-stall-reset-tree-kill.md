<!-- intention: background jobs die at ~2 min of silence and their process trees survive the kill -> silence is measurable, the deadline is visible and agent-resettable, kill leaves no orphans, and hard tests pin all three -->

# Jobs pipeline: output streaming, stall warning + agent reset, real tree kill

```yaml
status: COMPLETED (2026-09-18) — all oracles green, hard tests landed, binary rebuilt
raised: 2026-09-18 from this session's evidence
scope: packages/opencode/src/jobs, src/tool/{cmd,bash,jobreset,registry}, packages/core/cross-spawn-spawner
```

## Context / goal

Evidence from 2026-09-18 (this worktree):

1. **Every background `cmd`/`bash` job longer than ~2 min is auto-killed.** The heartbeat
   kills a job after `STALL_KILL_MS=120s` without output (`jobs/index.ts:269`), but the
   `cmd`/`bash` tools **never call the job's incremental writer** (`run: (_writeOutput) =>`
   at `cmd.ts:564` / `bash.ts:772`; only `run.ts:334` wires it). So `lastOutputAt` never
   advances, `output` stays `[started] …`, and the heartbeat is blind. Measured: bash-6/8/9
   killed at +2m01–2m04s with `[started]`-only output (jobs.db).
2. **"killed" ≠ process dead.** bash-9 (build) was marked killed but its tree survived,
   wiped `dist`, and kept running. Mechanism: `cross-spawn-spawner.ts:298-315` kills the
   ROOT first (`proc.kill("SIGTERM")`) and only then runs `taskkill /pid <root> /T /F` — by
   then the root is dead, `/T` has no tree to walk, grandchildren are orphaned.
3. Boot recovery is cosmetic (`UPDATE … SET status='killed'`), no pid is persisted.

User requirement: the agent must be able to RESET the deadline — after receiving a message
from the job (cpu … potentially stalled, will be killed after …) — because a job may be
legitimately long OR genuinely hung.

## Implementation steps

- [x] T1 — stream output: `cmd`/`bash` pass the job `writeOutput` into their `run()` helper
      (`onChunk` → job writer); throttle persist/publish in the jobs layer (≥500ms).
- [x] T2 — stall warning + reset: heartbeat emits a notice
      `⚠ <id> (<label>) silent <s>s, cpu <…> — potentially stalled; will be killed in <r>s unless reset (jobreset <id>)`;
      `Jobs.reset()` + `jobreset` tool; kill deadline measured from `max(lastOutputAt, stallResetAt)`.
- [x] T3 — real tree kill: persist child pid (`self.setPid`), kill by pid tree
      (taskkill /T /F | kill(-pid)); fix `killGroup` order in the spawner (tree FIRST, root after).
- [x] T4 — hard tests + typecheck + rebuild.

## Found during implementation (all fixed, all pinned by tests)

- **Read-offset vs banner rewrite:** the first chunk REWRITES the job buffer (the `[started]`
  banner is stripped), so an agent that had already read the banner got `slice(offset)` past
  the shorter buffer — the stream stayed invisible. Fixed at `output()` (restart from 0 when
  the stored offset exceeds the buffer) + offset delete at the three rewrite sites
  (`writeOutput`, `tap`, `onSuccess`).
- **`kill()` contract drift (pre-existing red at HEAD):** killing a terminal job flipped its
  status to "killed" and returned `true`, contradicting the tool contract and
  `job-workflow.test.ts` (verified red at HEAD via `git show HEAD`). Now: terminal → no-op
  `false`, terminal status preserved; `warn` kept for status="killed" (zombie suspicion).
- **`agent.test.ts` load flake:** heavy `Instance.provide`+tmpdir suite (50 tests, ~125s);
  two different tests timed out at 5.4–5.5s vs the 5s bun default in two consecutive
  full-file runs, pass isolated. Fixed with file-level `setDefaultTimeout(20_000)`.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (recorded 2026-09-18, before implementation)

| # | Evidence | Actual [Exact] |
|---|----------|----------------|
| 1 | `bun test --timeout 30000 test/jobs/` (packages/opencode) | 16 pass / 0 fail (4.48s) |
| 2 | jobs.db: bash-6/8/9 | `killed` at +2m01/2m04/2m01s, output = `[started]` only |
| 3 | orphan check after bash-9 kill | pwsh 1904 + bun 23196 alive, `dist` wiped |
| 4 | `cmd.ts:564`, `bash.ts:772` | `run: (_writeOutput) =>` — writer ignored |
| 5 | `cross-spawn-spawner.ts:298-315` | root killed before `taskkill /T` |

### Post-implementation oracles — results [Exact]

| # | Test | Pins | Result |
|---|------|------|--------|
| 1 | silent job → `stalled` + notice contains `potentially stalled`, `cpu`, `will be killed`, `jobreset <id>` | T2 warning | PASS |
| 2 | `reset` returns job to `running`; job survives past the ORIGINAL deadline; is killed after the NEW one | T2 reset semantics | PASS |
| 3 | job killed by pid → real process tree gone (`tasklist` shows neither root nor child; precondition asserted) | T3 no orphans | PASS |
| 4 | streaming: job output visible via `joboutput` WHILE running (not only at completion) | T1 wiring | PASS |
| 5 | source invariant: `cmd.ts`/`bash.ts` background `run:` consumes `writeOutput` (no `_writeOutput`); spawner `taskkill` before `proc.kill` | T1/T3 upstream-proof | PASS |
| 6 | banner-replacement read recovery (incremental read after `[started]` consumed) | offset fix | PASS |
| 7 | `job_reset` tool: re-arms running job, no-op on killed; `job_kill` no-op on done preserves `done` | tool contracts | PASS |

Runs: `bun test test/jobs/` → 23 pass / 0 fail · `bun test test/tool/job-workflow.test.ts` →
4 pass / 0 fail · `bun test test/agent/agent.test.ts` → 50 pass / 0 fail ·
`bun test test/effect/cross-spawn-spawner.test.ts` (packages/core) → 24 pass / 0 fail ·
`bun typecheck` both packages → exit 0.

Rebuild: `pwsh _build.ps1` via cmd_runner `20260918T083132Z_bc9b9ea5` → exit 0; build smoke
`opencode.exe --version` → 10.0.1012; `dist\bin\opencode.exe` = 306,472,960 B, 2026-09-18
16:32:17 local. First attempt (`20260918T082805Z_58661675`) failed on the `dist\bin\opencode.exe`
lock held by a leftover nested opencode (PID 8760, child of this session) — killed with user
approval; see progress log.

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

## Residual [Unknown]

- A pid-based **re-kill sweep** for a zombie that survived its kill (status "killed",
  process alive) does not exist: `job_kill` on a killed job now returns `false` + warns but
  does not attempt `taskkill` again (pid-reuse risk). The kill-time tree sweep covers the
  primary path.
- Boot recovery still does not persist pids (cosmetic `UPDATE` only).
