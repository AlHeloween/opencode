<!-- intention: a job's OS pid lives only in memory, so boot recovery cannot kill a dead runtime's orphan trees and its blind UPDATE corrupts a live neighbour runtime's records in the shared worktree jobs.db; job_kill cannot re-attempt a survived kill -> pid+owner are persisted, boot recovery kills only a provably-dead runtime's orphans under a pid-reuse guard, and job_kill re-attempts a guarded tree kill -->

# Jobs: pid persistence, instance-aware boot recovery, guarded zombie re-kill

```yaml
status: COMPLETED (2026-09-18) — all oracles green, negative control run, docs updated; binary rebuilt + deployed 10.0.1013 with a live boot-recovery smoke
raised: 2026-09-18 from this session's code reading
scope: packages/opencode/src/jobs/index.ts, test/jobs/jobs.test.ts, docs/background-jobs.md
```

## Context / goal

The prior task closed with two unknowns, both traced at G6 grounding to **one** root cause:

| # | Fact (Exact, read from source) | Consequence |
|---|-------------------------------|-------------|
| 1 | `Job.pid` existed in memory (`index.ts:118`) and `setPid` wrote it (`:769`), but the schema (`:216-226`) had no `pid` column and `dbInsert`/`dbUpdate` (`:244-257`) never wrote it | a restart loses the pid → boot recovery has **nothing to kill** |
| 2 | boot recovery was a blind `UPDATE job SET status='killed' WHERE status='running'` (`:231-234`) | in a shared worktree `jobs.db`, a second runtime's boot **overwrites a live runtime's** rows |
| 3 | `kill()` on a `killed` job only warned (`:592`) | a process that survived its kill (zombie) was never re-attempted |

Additionally: on Windows the spawner uses `detached: false` (`cross-spawn-spawner.ts:405`), so a
runtime crash leaves job trees alive as orphans (Windows does not kill children on parent death
without a Job Object) — the earlier `bash-9` incident.

## Implementation steps

- [x] T1 — persist `pid` + `owner_pid`: added both to `Job` (`ownerPid = process.pid` at both
      construction sites), to `CREATE TABLE`, and to `dbInsert`/`dbUpdate`; `ALTER TABLE` for
      existing DBs guarded by `PRAGMA table_info`.
- [x] T2 — instance-aware boot recovery: a row whose `owner_pid` is a live process other than
      us is left alone; a dead owner's row is flipped and its recorded pid tree killed under the
      guard; a legacy row (`owner_pid IS NULL`) is flipped but never killed.
- [x] T3 — guarded zombie re-kill: `kill()` on a `killed` job re-attempts `killTreePid` only when
      the pid still resolves to **our** process; otherwise `false` + warn.
- [x] T4 — tests + full oracle batch + negative control.

## Design

### pid-reuse guard (the safety core)

`taskkill /pid <pid> /T /F` on a reused pid would kill an innocent process. Guard: a job's root
child is spawned within seconds of `startedAt`, so the recorded pid is *ours* iff the live process
with that pid started at ≈ `startedAt`. One batched, non-blocking probe per sweep:

```powershell
Get-Process -Id <pid>,… | ForEach-Object { "$($_.Id) $($_.StartTime.ToUniversalTime().Ticks)" }
```

compared in .NET ticks against `(startedAt + 62135596800000) * 10000` within a 60 s window.
A reused pid necessarily started after our process ended → outside the window → refused.
**Fail-safe = do not kill** on probe error (safety > task).

### T2 owner gate

- `owner_pid` alive (`process.kill(pid, 0)`, EPERM ⇒ alive) and `≠ process.pid` → row untouched.
- `owner_pid` dead → flip status; kill the tree if a `pid` is recorded and the guard passes.
- `owner_pid IS NULL` → flip status, **never kill** (ownership unverifiable).

## Found during implementation (fixed, pinned)

1. **The guard would have silently never fired (timezone).** `Process.StartTime.Ticks` is a
   **local** wall-clock DateTime; comparing it to `Date.now()` (UTC epoch) put every pid exactly
   −8 h outside the 60 s window — measured in isolation before trusting the test:
   `delta = −28 799 352 ms`. Fixed with `.ToUniversalTime().Ticks` (re-measured: `delta = 520 ms`).
   A guard that never fires is a silent no-op — the class of bug this project forbids — so the
   probe is validated standalone, not only through the test.
2. **My own tests leaked processes.** They first spawned `cmd → ping` trees, but `child.kill()`
   reaps the root only, and the sibling tree-kill test counts `PING.EXE` **machine-wide** — 6
   orphaned pings (from aborted runs) broke that test. Now the tests use a single childless
   long-lived process and reap via `taskkill /T /F`. The 6 leaked pings were killed by explicit
   pid (verified: 0 remain).

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (recorded 2026-09-18, before implementation)

| # | Evidence | Actual [Exact] |
|---|----------|----------------|
| 1 | `bun test test/jobs/` (packages/opencode) | 23 pass / 0 fail (8.09s) |
| 2 | `bun test test/tool/job-workflow.test.ts` | 4 pass / 0 fail (28.51s) |
| 3 | `jobs.db` schema | `id, session_id, kind, label, status, output, result, started_at, finished_at` — **no pid** |
| 4 | `index.ts:231-234` | blind `UPDATE … WHERE status='running'` (no owner filter) |

### Post-implementation oracles — results [Exact]

| # | Test | Pins | Result |
|---|------|------|--------|
| 1 | start a job with `self.setPid(424242)`, then **read `jobs.db` back** | T1 write-path artifact | PASS (`pid=424242`, `owner_pid=process.pid`) |
| 2 | seeded row with a **live** `owner_pid` + `status='running'`, then a fresh DB open | T2 owner gate | PASS (status stays `running`; neighbour process untouched) |
| 3 | seeded row with a **dead** `owner_pid` + a real child pid, then a fresh DB open | T2 orphan kill | PASS (child terminated; status `killed`) |
| 4 | job marked `killed` whose recorded pid is a live process → `kill()` again | T3 zombie re-kill | PASS (returns `true`; process dead) |
| 5 | `kill()` again once the process is gone | T3 negative | PASS (`false`, status preserved) |
| 6 | regression | — | PASS |

Runs: `bun test test/jobs/` → **27 pass / 0 fail** (baseline 23; +4 new) ·
`bun test test/tool/job-workflow.test.ts` → **4 pass / 0 fail** ·
`bun test test/agent/agent.test.ts` → **50 pass / 0 fail** ·
`bun test test/effect/cross-spawn-spawner.test.ts` (packages/core) → **24 pass / 0 fail** ·
`bun typecheck` both packages → **exit 0**.

**Negative control (the instrument must be able to fail):** with `PID_MATCH_WINDOW_MS = 0`,
test #3 FAILs (the orphan tree survives) and test #4 FAILs (re-kill returns `false`), while
test #2 still PASSes. Reverted to `60_000` and re-confirmed green. So the kill tests are
sensitive to the guard itself, not merely to "some kill happened".

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

## Residual [Unknown]

- **Legacy rows** (`owner_pid IS NULL`) written by a previous build are flipped to `killed` by the
  first new-code open even while that old runtime is still live. Cosmetic in the DB only (the live
  runtime's in-memory map is authoritative and no process is touched), and not backfillable — the
  owner was never recorded.
- The pid-reuse probe is **Windows-only**; on POSIX the process group is signalled directly and no
  start-time check is performed.
- ~~Rebuild/deploy not part of this task~~ → **DONE (follow-up, same day).** Rebuilt with
  `pwsh _build.ps1 -Task build` (`[OK] Build complete`) → `dist/bin/opencode.exe` SHA256
  `99fd77c6…` → `d6c5db66…`, version 10.0.1012 → **10.0.1013**. Deployed to `bin/opencode.exe` by
  **renaming** the running executable (Windows permits rename, not overwrite) → the live session was
  never interrupted. Live smoke on the compiled binary: the `Jobs` boot migration added
  `pid`/`owner_pid` to the real `jobs.db` (9 → 11 columns, read back) and `recoverOrphans` fired
  (`service:"jobs"` → `"orphan jobs recovered", count:1`). So T1+T2 execute at runtime, not only in tests.
- **Post-restart live verification (user restarted into the new binary; running PID 596):** a
  binary-created job row now carries `pid` + `owner_pid = 596` — start (`running`) → `done`, and a
  second job `running` → `killed`; tree kill confirmed (`taskkill /T /F`, **0 surviving `PING.EXE`**).
  So the T1 write path is exercised live, not only by the unit test.
- **Still not exercised live**: an orphan kill against a genuinely crashed runtime (the
  seeded-dead-owner path is covered by unit test #3). Rollback copy: `bin/opencode.exe.prebuild-bak` (306 MB).
