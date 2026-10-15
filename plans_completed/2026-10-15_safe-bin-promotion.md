# t55 — safe bin promotion: drain the fleet, swap the binary, bring every server back, resume the work

<!-- intention: from_state = every bin promotion kills every running robot mid-turn (MessageAbortedError),
     host record gone, port refused, robots re-prompted by hand from disk
     -> to_state = a project script that drains every server to idle, records the relaunch commands and
     the working session ids, swaps bin\opencode.exe with sha + version verification and rollback,
     relaunches every host from bin as recorded, and posts a continuation to every recorded session -->

<!-- goal_sv: keywords: { safe-bin-promotion 0.30, fleet-drain 0.22, session-resume 0.18, rollback-verified 0.16, fixture-oracle 0.14 }
     dominant: A promotion of bin\opencode.exe never again aborts a robot without a recorded, automated recovery — drain to idle, record, swap with proof, relaunch from bin, resume from disk. -->

Owner, 2026-10-15, verbatim: «надо решить проблему — смотри у нас роботы запускаются из bin — надо написать тулзу
чтобы дожидалась последнего хода всех поднятых серверов, потом запоминала id, замещала бинарь и поднимала. Чтобы
наша организация эволюционировала в штатном режиме».

Owner, 2026-10-15 (second ruling): «dist/bin только для обкатки, хосты поднимаем из bin» — dist\bin is ONLY the
source of the candidate and the place for trial runs; every host the tool relaunches runs from bin\opencode.exe
(cwd as recorded). A recorded command line pointing at dist\bin is a trial process, not a host — list it, do not
relaunch it as a host. Boxed as T7 below.

## The motivating case (measured 2026-10-15)

Three promotions of bin aborted every running robot mid-turn: `MessageAbortedError` on t49, t52, t53; the host
record vanished, the port refused; the robots had to be re-prompted by hand from what was on disk. The same day
at 18:01 THIS session was aborted by the 10.0.1352 promotion — the fourth occurrence, watched from inside.
History (AGENTS.md forbidden_actions): «bin surgery» on 2026-09-24 (move-aside + copy to dodge a locked exe)
mixed 10.0.1106/10.0.1107 and broke the owner's session. The tool exists so the fifth promotion is routine.

## Grounded facts (measured today, probes in experiments/2026-10-15_safe-bin-promotion/)

- `server_host` table: one row `id='host'` per worktree DB (`{worktree}/.opencode/data/opencode.db`) with
  url, pid, nonce, token, time_started. Live = `/global/health` echoes the nonce (host.ts:17, opencode_host.py).
- `/global/health` (no auth): `{"healthy":true,"version":"10.0.1348","host":"<nonce>"}` — version + nonce.
- `/session/status?directory=<worktree>` (Basic auth `opencode:<token>`): busy/retry/summarizing/compacting
  sessions appear; IDLE sessions are ABSENT (status.ts deletes idle entries). Drain = the map is empty.
- `/session/list` (Effect route) answered 500 measured; `/session?directory=…&limit=N` (Hono bridge) works.
- `/session/<id>/todo` route returned 0 rows for a session whose DB `todo` table holds open todos — the DB
  table (`status != 'completed'`) is the reliable open-plan signal, read read-only.
- `POST /session/<id>/prompt_async` `{messageID, parts:[{type:"text",text:…}]}` → 204, starts a turn
  (automode.tsx:106 uses exactly this). This is the resume route.
- Process discovery: `Get-CimInstance Win32_Process -Filter "name='opencode.exe'"` gives pid, ExecutablePath,
  CommandLine, CreationDate. PEB cwd read FAILED (NtQueryInformationProcess 0xC0000004) — cwd is derived from
  the server_host record whose pid matches (the DB path IS the worktree); unattributed processes are reported,
  never killed.
- No graceful HTTP shutdown route exists (only `/global/dispose`, which disposes instances, not the process).
  Stop = taskkill /T (graceful WM_CLOSE/CTRL_CLOSE), wait, /F only as recorded fallback. A stale record is
  replaced by the next claim (host.ts:65), so even a hard kill leaves consistent state.
- `tools/opencode_host.py` is the canonical client (vendored copy in scripts/org-genesis/) — REUSED, not
  re-invented. `tools/cmd_runner.exe` exists — the host's launch route for visible terminals
  (`cmd_runner start --terminal wt --cwd W -- W\bin\opencode.exe`, the same form org.py delegate prints).
- NO maintenance flag exists anywhere in the fleet scripts (grep: zero hits for OPENCODE_MAINTENANCE/maintenance
  flags). The tool creates the convention: `$ORG_HOME/maintenance` (orgcfg.HOME), and orgd.py — the one thing
  that re-enters robot sessions — gets a check that withholds wakes while the marker exists.
- The tool CANNOT run from inside a robot session on a host it promotes: stopping that host kills the robot's
  turn, and the turn's cancellation taskkills the tool's own process tree mid-swap (bash.ts finalizer). The
  tool walks its own parent chain and REFUSES when an ancestor is a server of the target bin — the promotion
  is run by the owner from a terminal, or from a host outside the promoted set. This refusal is tested (T8).
- Today's fleet measured: two opencode.exe processes (pids 34856, 21656), both `d:\zPython\opencode\bin\opencode.exe`,
  cmdline `opencode` (TUIs); pid 21656 is the host of D:\zPython\opencode per server_host.

## Tasks

- [x] T1 `scripts/promote_bin.py` — discover: enumerate processes executing the target bin (path, pid, cmdline,
      start time), attribute each to its worktree via server_host records (repo root + --worktree + org
      checkouts), read host record + health + status read-only, print the inventory. Unattributed holders of
      the target bin are named and BLOCK the swap (exit 9); a cmdline pointing at dist\bin is listed as TRIAL.
      <!-- sv: keywords: { discovery 0.45, process-attribution 0.30, read-only-inventory 0.25 } dominant: The tool sees the fleet before it touches anything: every process, its worktree, its record, its health. -->
- [x] T2 drain: write the maintenance marker (`$ORG_HOME/maintenance`; fixture: `<fixture>/maintenance`), poll
      `/session/status` on every attributed host until no non-idle session remains (progress line each poll),
      finite deadline; a session still busy at the deadline → remove marker, STOP, change nothing (exit 4).
      `--exclude-session <id>` excludes the calling session from the wait (it cannot go idle while the tool
      runs inside it) and records it for resume. orgd.py withholds wakes while the marker exists.
      <!-- sv: keywords: { drain 0.40, maintenance-marker 0.25, deadline-stop 0.20, orgd-withhold 0.15 } dominant: Nothing new is dispatched and every turn that can finish has finished before anything is stopped. -->
- [x] T3 record: before anything is stopped, persist `<state-dir>/promotion-<ts>.json` — per host the relaunch
      command (exe + args parsed from the recorded cmdline, cwd = worktree), and the resume set: sessions busy
      at drain start, plus idle sessions with open todos (DB `todo` status != 'completed') or updated within
      the last 30 min. Old binary sha256 + health version recorded.
      <!-- sv: keywords: { record-before-stop 0.40, relaunch-command 0.30, resume-set 0.30 } dominant: The exact state needed to bring every server and every working session back is on disk before the first process dies. -->
- [x] T4 swap: taskkill /T each attributed host (graceful first, wait, /F fallback recorded), verify no process
      holds the target bin, copy old → `bin\opencode.exe.prev` (rollback), copy candidate in, verify sha256(new)
      == sha256(candidate), run the version smoke on the NEW file (`<bin>\opencode.exe --version` real;
      selfcheck script in fixture). Any failure → rollback: restore .prev, verify sha, report, exit 6 — never a
      half-swapped bin.
      <!-- sv: keywords: { swap 0.35, sha-verify 0.25, rollback 0.25, graceful-stop 0.15 } dominant: The binary is replaced only when nothing holds it, and the old one is one copy away until the new one has proven itself. -->
- [x] T5 bring back: relaunch every recorded host exactly as recorded (visible window — cmd_runner
      `start --terminal wt` when tools/cmd_runner.exe exists, else CREATE_NEW_CONSOLE), wait for its host
      record / health (new nonce, fresh token), finite timeout. Failure → rollback (restore .prev, relaunch
      old the same way), exit 7.
      <!-- sv: keywords: { relaunch 0.40, visible-window 0.25, health-wait 0.20, rollback 0.15 } dominant: Every server comes back from bin exactly as it ran, and the tool does not report success before health answers. -->
- [x] T6 resume: for every recorded session, `POST /session/<id>/prompt_async` with the continuation («host
      upgraded to <version>; your turn was aborted by the restart; re-read your plan and the working tree and
      continue from what is on disk»), fresh per-start token from the relaunched host's record; receipts (204
      per session) in the report.
      <!-- sv: keywords: { resume 0.45, prompt-async 0.30, receipts 0.25 } dominant: No robot is left dead: every session that was working gets its continuation posted by the tool, not by hand. -->
- [x] T7 dist\bin rule (owner, 2026-10-15): a process whose executable path is under dist\bin (or whose recorded
      cmdline points there) is a TRIAL process — listed in the inventory, never drained as a host, never
      relaunched as a host. Tested in the fixture (trial process survives the whole run untouched).
      <!-- sv: keywords: { dist-bin-trial 0.50, host-from-bin 0.30, inventory-label 0.20 } dominant: dist\bin is обкатка only — hosts come back from bin, and the tool says so in its inventory. -->
- [x] T8 inside-session refusal: the tool walks its own parent chain; an ancestor that is a server of the
      target bin → refuse (exit 8) before anything is changed. Tested: a fixture server spawns the tool; the
      tool refuses and the fixture bin is untouched.
      <!-- sv: keywords: { parent-chain 0.40, mid-swap-death 0.35, refusal 0.25 } dominant: A promotion can never be launched from inside the thing it stops — the tool proves it before touching anything. -->
- [x] T9 report: before/after version + sha256, servers stopped/relaunched, sessions resumed (with receipts),
      per-phase timings, printed and persisted in the state file.
      <!-- sv: keywords: { report 0.40, timings 0.20, receipts 0.20, versions 0.20 } dominant: The promotion's own receipt: what was, what is, what came back, what was resumed, how long it took. -->
- [x] T10 orgd.py maintenance check: `tick()` returns no wakes while the marker exists (log once per change);
      marker path shared with the tool. Named in the report as the fleet-side half of the drain gate.
      <!-- sv: keywords: { orgd 0.40, wake-withhold 0.35, maintenance-marker 0.25 } dominant: The dispatcher that re-enters sessions reads the same maintenance flag the promotion writes. -->
- [x] T11 dry-run receipt on the REAL fleet: `python scripts/promote_bin.py --dry-run` — read-only inventory
      printed (processes, records, health, status), nothing written, nothing stopped. Run recorded in
      _progress_log.md as the owner-facing proof the tool sees the real fleet.
      <!-- sv: keywords: { dry-run 0.40, real-fleet 0.35, read-only 0.25 } dominant: The tool proves it sees the real fleet before anyone trusts it with the real bin. -->

## Smoke Tests (PRE_FLIGHT — all against the fixture, never the real bin)

Fixture: `experiments/2026-10-15_safe-bin-promotion/fixture/` — `bin/opencode.exe` (a copy of python.exe),
`dummy_server.py` (real HTTP server: /global/health nonce echo + version file, /session/status from a control
file, /session/<id>/prompt_async recorded to prompts.jsonl, writes a real server_host row into the fixture
worktree's opencode.db), `worktree-a/`, `dist/bin/opencode.exe` (trial-process copy), control files under
`state/`. Tests: `packages/opencode/test/promote-bin.test.ts` — one file per cmd_runner call, from
packages/opencode.

- S1 drain waits busy→idle: status file busy → tool started → test flips idle → tool proceeds to completion
  (exit 0). Expected: PASS after implementation.
- S2 deadline stops with no change: status stays busy → exit 4, bin sha unchanged, server pid alive, marker
  removed. Expected: PASS.
- S3 swap verifies sha: success run → sha256(fixture bin) == sha256(candidate). Expected: PASS.
- S4 rollback restores on a failing smoke: broken candidate (non-executable bytes) → exit 6, bin bytes ==
  old bytes, old server relaunched and healthy, prompts.jsonl empty. Expected: PASS.
- S5 resume posts to exactly the recorded sessions: s1, s2 busy at drain start; s3 idle, no todos →
  prompts.jsonl contains exactly s1, s2. Expected: PASS.
- S6 trial process untouched: a server running from fixture dist\bin → listed as TRIAL, still alive after the
  run, never relaunched. Expected: PASS.
- S7 inside-session refusal: fixture server spawns the tool → exit 8, bin untouched. Expected: PASS.
- S8 dry-run changes nothing: `--dry-run` on the fixture → exit 0, no marker, no kill, inventory printed.
  Expected: PASS.
- S9 real-fleet dry-run (read-only, run once by me): inventory of the real bin fleet printed; no writes.
  Expected: PASS (exit 0, inventory names the two live TUI processes and the 4096 host record).

Bounds: steps 80, tools 160, loops 4, depth 2, time 5 400 000 ms. Commit naming the plan, stage by path.
Never touch the real bin\ — the tool's full run on it is the owner's act. No keys.

## Receipts (2026-10-15, all measured — S1–S9 PASS)

- Fixture suite `bun test test/promote-bin.test.ts` via cmd_runner run `20261015T103116Z_aec6628e`:
  6 pass, 0 fail, 33 expect() calls, exit 0 (state.json `exit_code: 0` ✓; whole stdout_text.log read back ✓).
- Three earlier runs failed honestly and each fixed a real defect: fixture-mode default paths (tool ran
  against the REAL bin path), `unhashable type: dict` on unattributed entries, OSError escaping the version
  smoke on a corrupt candidate (exit 1, no rollback), swap-failure leaving stopped servers dead (plan
  violation — swap-fail now relaunches the recorded hosts on the old binary), EPERM/`-like` escaping in the
  test's own cleanup.
- orgd probe run `20261015T103536Z_f8cce54e` exit 0: marker present → `tick() == []`, wakes withheld ✓.
- Real-fleet dry-run 18:36: host pid=22128 (`:4096`, version 10.0.1352 — the promotion that aborted this
  session at 18:01, nonce-echo ok, busy=3 incl. this session) + 1 UNATTRIBUTED `-s ses_…` process that
  blocks a real swap by design (exit 9) until closed or attributed with --worktree.
- The real `bin\` was NEVER written by the tool in this session — only `--dry-run` reads. The full run on
  the real bin is the owner's act.
