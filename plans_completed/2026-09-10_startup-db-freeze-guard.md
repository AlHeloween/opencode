---
reproduce:
  files:
    - packages/opencode/src/storage/db.ts
    - packages/opencode/src/project/instance.ts
    - packages/opencode/test/storage/db.test.ts
  commands:
    - tools/adm.exe --cmd-runner start --cwd packages/opencode -- bun test test/storage/db.test.ts test/project/project.test.ts
  inputs: locked, slow, or malformed portable project database during startup
  expected_outputs: bounded SQLite lock waits, a durable stage log before every native DB operation, and an explicit logged bootstrap failure
---

# Startup database freeze guard

## Context / goal

Avoid silent, unresponsive startup when a portable SQLite database is locked or a native initialization step stalls. Native synchronous calls cannot be cancelled in-process, so the guard must expose the exact pre-call stage and bound lock acquisition before the WAL transition.

## Prior art (REUSE.BEFORE)

reuse: `Database.createAndInitDb`, `Instance.track`, checkpoint hard-timeout rationale, and existing package logger conventions.

## Implementation steps

- [ ] Record storage/project baseline.
- [ ] Add ordered database startup-stage logs, set `busy_timeout` before WAL mode, and remove the unnecessary startup checkpoint.
- [ ] Log every rejected instance bootstrap with directory and error while evicting its cache entry.
- [ ] Add the SQLite configuration oracle; run focused tests, typecheck, and Windows build.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `tools/adm.exe --cmd-runner start --cwd packages/opencode -- bun test test/storage/db.test.ts test/project/project.test.ts` | pass | 45 pass / 0 fail (`20260910T140246Z_3af05b9b`) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | focused storage/project tests through cmd_runner | 46 pass / 0 fail (`20260910T140425Z_80929ee8`) |
| 2 | `bun typecheck` from `packages/opencode` through cmd_runner | pass (`20260910T140505Z_c7752250`) |
| 3 | `pwsh -File _build.ps1` through cmd_runner | Windows build complete; packaged version smoke `10.0.960` (`20260910T140531Z_cd118948`) |

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]
