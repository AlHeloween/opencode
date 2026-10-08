# 2026-10-08_robot-wave — fleet.py, the stable command set for the hourly orchestrator

Verified snapshot of task **t18-fleet-cli** (robot session `ses_ee5d78f29ffeUX6JjEymdVdpOE`;
brief: `experiments/2026-10-08_robot-wave/t18-fleet-cli.md`).

**Live copy — the one the orchestrator calls:** `experiments/2026-10-08_robot-wave/fleet.py`.
This folder is the frozen, committed record of what was verified; edit the live copy, not the snapshot.

## Why this exists

The hourly Claude orchestrator (scheduled task `robot-fleet-hourly`) composed a new ad-hoc shell
command every run (heredocs, `sed`, one-off python), so its permission checks never stabilised and
its logs never read the same twice. `fleet.py` is one CLI with fixed verbs, no free-form command
and no free-form SQL, and it writes only to the wave's own fixed paths (`queue.md`, and
`sessions.json` on a real dispatch).

## Verbs — exact usage

```
python experiments/2026-10-08_robot-wave/fleet.py status
python experiments/2026-10-08_robot-wave/fleet.py final <name>
python experiments/2026-10-08_robot-wave/fleet.py dispatch <brief-name> [--dry-run]
python experiments/2026-10-08_robot-wave/fleet.py verify <name> <test-file>...
python experiments/2026-10-08_robot-wave/fleet.py next
```

- `status` — host live/STALE/none + every robot busy/idle/unreadable, model, rows, tool errors,
  last finish.
- `final <name>` — the robot's last assistant text + error events, via the API, falling back to a
  READ-ONLY sqlite read of `.opencode/data/opencode.db` when the API refuses (the known 401).
- `dispatch <brief-name> [--dry-run]` — as dispatch.py; moves the queue.md line under
  «## dispatched» as `- <name> <session-id> (<time>)`. `--dry-run` prints title, model and brief
  length and writes nothing.
- `verify <name> <test-file>...` — each test file through cmd_runner from `packages/opencode`
  (one run per file), waits, prints run id / status / exit / pass/fail counts from the run's own
  `state.json` plus the whole output, then appends `verified …` or `failed …` to that robot's
  queue line. Never a free-form command: test files are validated as relative `*.ts` paths under
  `packages/opencode`.
- `next` — the top «## next» line whose block markers are satisfied (`AFTER tX…` and the queue's
  own `waits: tX …`; a dep counts as satisfied only when its dispatched line says `verified`),
  plus the free slot count (max 3 busy robots).

## Reuse — import, not copy

- `watch.py` — `snapshot()` / `render()`; refactored into an importable module, CLI unchanged.
- `dispatch.py` — `brief_text()` / `dispatch()`; same refactor, CLI unchanged.
- `tools/opencode_host.py` — `lookup` / `is_live` / `Host` / `db_path`.

## Smoke evidence (each verb run once, live)

| verb | evidence |
|---|---|
| `status` | `smoke/status.txt` — host live `pid=27004`, 14 robots, t2 UNREADABLE via API (401) |
| `final t2-red-tests` | `smoke/final-t2-fallback.txt` — API refused (HTTP 401), READ-ONLY sqlite fallback served the text |
| `final t1-fold-carrier` | `smoke/final-t1-api.txt` — API path |
| fallback vs API | `smoke/check-fallback-out.txt` — for t1 the two texts are byte-equal (3664 chars each) |
| `dispatch … --dry-run` | `smoke/dispatch-dry-run.txt` — `title=robot-wave:t18-fleet-cli model=deepseek/deepseek-flash brief=3148 chars — would send, wrote nothing` |
| `verify t18-fleet-cli test/session/tail-note.test.ts` | cmd_runner run `20261008T062743Z_cb170e43`, `status=finished exit=0`, **13 pass / 0 fail** (`smoke/verify-t18.txt`; run state in `runs/`) |
| `next` | `smoke/next.txt` — skipped t15/t16 (wait t14), t19 (wait t15), t20 (wait t18+t19); picked `inst-b1e-end-to-end`; slots 0/3 |

The queue note appended by `verify` landed on t18's own line:

```
- t18-fleet-cli ses_ee5d78f29ffeUX6JjEymdVdpOE (2026-10-08 14:17) — brief amended: dispatch smoke
  is --dry-run only; verified PASS 2026-10-08 14:27: test/session/tail-note.test.ts: 13 pass / 0 fail `20261008T062743Z_cb170e43`
```

**Line-move tested on a COPY only** (`smoke/queue-copy-test.md`, produced by
`smoke/queue-line-smoke.py` → `QUEUE-LINE SMOKE PASS`): the transform removes the «next» line and
re-inserts it under «## dispatched» with id+time; every other line keeps its bytes and order, and
the live `queue.md` was byte-identical after the whole run. A real `dispatch` was never run: it
would start a fourth robot beside the two already working (max 3) — the brief was amended to
`--dry-run` only (protocol log, 2026-10-08 14:17).

## Residual / not smoke-tested

- `status`'s host **STALE/none** branch and `verify`'s **FAILED** branch were not exercised live
  (killing the live host would disrupt two busy robots; the brief scopes `verify`'s smoke to one
  already-green file).
- `next` evaluates `AFTER tX…` and `waits: tX …` only; a prose hold the queue never spells (e.g.
  `inst-b1e`'s `HELD …` condition) is printed, not evaluated — that stays the orchestrator's call.
- The live host still answers 401 on t2's session until the owner promotes `dist/` into `bin/`
  (t7's residual) — exactly the case the sqlite fallback exists for.
