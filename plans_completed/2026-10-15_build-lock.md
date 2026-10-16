<!-- intention: four robots ran _build.ps1 against an explicit «no build» brief line while others were active (t48/t53/t54/t56) and parallel builds looped on 2026-10-14 (runs 1338/1339/1340) -> _build.ps1 itself refuses a second concurrent build and honours the t55 promotion maintenance marker -->
<!-- goal_sv:
Keywords: build-lock 0.35, exclusive-lock 0.25, maintenance-marker 0.20, stale-takeover 0.12, force-override 0.08
Semantic dominant: One build at a time, enforced by the build script itself — not by a brief line.
md5: 7f3a9c1d4e5b6a8091c2d3e4f5a6b7c8
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# t58 — one build at a time, enforced by `_build.ps1` itself

Measured 2026-10-15 (`docs/robot-protocol-log.md` rows t48/t53/t54/t56): four robots ran
`_build.ps1` against an explicit «no build» line in their briefs while other robots were active;
on 2026-10-14 parallel builds of the same app looped (runs 1338/1339/1340). A brief line does not
hold this — the build script must.

## Design (G6 binding)

| box | file | what |
|---|---|---|
| S1 | `packages/opencode/test/build-lock.test.ts` | RED first: fixture oracle driving the REAL lock helper against a fixture dir — no real build |
| S2 | `scripts/build-lock.ps1` | lock helper dot-sourced by `_build.ps1`: `Acquire-BuildLock` / `Release-BuildLock` |
| S3 | `_build.ps1` | takes the exclusive lock before touching `.temp/test/` or `dist/`; honours the t55 maintenance marker; `-ForceBuild` override, printed |
| S4 | test GREEN | second holder refuses naming the first; stale takeover; release after failure |
| S5 | commit + `_progress_log.md` | one commit naming the plan, staged by path |
| S6 | real build | ONE `_build.ps1` run proves the normal path still works (fleet's build this round); state.json read |

- **Lock path:** `.opencode/data/build/build.lock` — the runtime state plane the project already
  uses (`Global.Path.data` = `{worktree}/.opencode/data`, same plane as t55's
  `.opencode/data/promotion` state). NOT under `dist/` or `.temp/test/`: the build itself cleans
  both, so a lock there would be swept mid-run. Gitignored, never committed.
- **Lock content (JSON):** `{ pid, started, caller }` — caller = `$env:OPENCODE_SESSION_ID`
  if present, else `manual`.
- **Semantics:** second invocation while the holder pid is alive refuses at once, exit != 0,
  naming the holder (pid + caller + start time). Dead pid = stale: taken over, takeover printed.
  Released on every exit path (success, failure, Ctrl+C) via `try/finally` around the MAIN switch.
- **Maintenance marker (t55, REUSED — no second flag):** real path
  `$env:ORG_HOME/maintenance`, else `~/.org/maintenance` (`scripts/promote_bin.py:484` —
  `marker = Path(os.environ.get("ORG_HOME") or Path.home() / ".org") / MARKER_NAME`). While it
  exists the build refuses (exit != 0) naming the marker, unless overridden.
- **Override:** `-ForceBuild` — explicit, printed (`OVERRIDE: …`), never silent.
- **Fixture seam (tests only):** `$env:BUILD_LOCK_DIR` and `$env:BUILD_MAINTENANCE_MARKER`
  override the two paths so the Bun oracle never touches real state.
- **No `bin/`.** Nothing there is read, written, or launched.

## Smoke Tests

- S1 RED: `build-lock.test.ts` fails before `scripts/build-lock.ps1` exists (holder + rival both
  proceed — no lock to stop the rival).
- S4 GREEN: holder acquires; rival refuses naming the holder (exit != 0); stale lock (dead pid)
  taken over with a printed takeover; lock released after a failing holder; maintenance marker
  blocks unless `-ForceBuild`.
- S6: ONE real `_build.ps1` run, exit 0, state.json read back.

<!-- sv: Keywords: build-lock 0.4, exclusive-lock 0.3, maintenance-marker 0.3; dominant: exclusive build lock plus promotion-marker honour in the build script; md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 -->

- [x] S1 RED: `test/build-lock.test.ts` fails before the helper exists (run 20261015T131823Z_fccc13c5, exit 1, 3 fail — T3 passed trivially on the missing helper, noted)
- [x] S2 helper: `scripts/build-lock.ps1` acquire/refuse/takeover/release + marker honour + override
- [x] S3 wired: `_build.ps1` locks before touching `.temp/test/` or `dist/`, releases on every exit
- [x] S4 GREEN: rival refuses naming holder; stale takeover; release after failure; marker blocks (run 20261015T141800Z_8547c169, exit 0, 4 pass)
- [x] S5 commit naming the plan; `_progress_log.md` entry appended (both entries kept on conflict)
- [x] S6 ONE real `_build.ps1` run, exit 0, state.json read (run 20261015T141909Z_386f2106, 10.0.1360, lock released)
