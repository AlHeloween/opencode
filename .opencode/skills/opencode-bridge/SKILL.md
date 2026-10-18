---
name: opencode-bridge
description: Start, read and drive another opencode session or robot through its server HTTP API. Use for bounded child work in its own worktree or a session the owner watches in TUI. Never drive a robot by typing prompts through cmd_runner, never start a competing writer on its session database.
---

# OpenCode bridge

```yaml
Keywords: server-api-bridge 0.35, host-identity 0.25, completion-predicate 0.20, narrowed-authority 0.20
Semantic dominant: Drive a bounded robot through the worktree host and independently verify completion.
md5: 6d67cb8d8a9a4b9e8b0f67c242ef47ec
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 492175a4cfee486cbd9680f397f3d688
```

## Evidence and compatibility

Verified 2026-10-11 on the local OpenCode build: a plain TUI creates an HTTP host;
a second plain TUI in the same worktree uses that host. After stopping the owning
test TUI, the surviving TUI claimed a new host nonce and authenticated
`GET /session/status` returned 200. Evidence: ADID's
`experiments_history/2026-10-11_cmd_runner_robot_fixes/tui-failover-results.json`.
The 2026-10-01 observations that plain TUI had no socket and no registry describe
an older build. Discover the current build's contract before using an older one.

## Authority and ownership

1. Launch the project's `bin/opencode.exe` (locally
   `D:/zPython/opencode/bin/opencode.exe`); discover its path on another host.
2. A child robot gets its own worktree and no more authority than its parent.
   Hand it paths, bounded effects, acceptance criteria and an independently
   drivable oracle. Many sessions on the worktree's one host are allowed.
3. Prefer the existing host. Do not launch another explicit-port server or
   unattached `opencode run` against the same database.
4. The owner's route is a visible TUI through cmd_runner. `serve` remains excluded
   unless the owner requests the web surface. Stop only a process you started.

## Find or start the host

The current implementation stores `server_host` in the worktree's
`.opencode/data/opencode.db`: URL, PID, nonce, token and start time.
Read the record without writing the database. Never print its token, place it
in a tracked file, shell command, progress entry or log.

Check `GET <url>/global/health`: require `healthy=true` and `host` equal to the
record's nonce. A live PID alone does not establish HTTP reachability or progress.
For command routes, use Basic authentication with username `opencode` and the
record's token. Explicit `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`
configuration takes precedence; obtain it through the authorized secret path.

If no healthy host exists, start the worktree's plain TUI:

```text
cmd_runner start --terminal wt --cwd <worktree> --no-tail -- <opencode.exe>
```

Record worktree, run_id, URL and nonce; keep credentials out. Wait for nonce health.
The default TUI can discover/proxy a host; do not assume a remembered port remains
current after host replacement. Readiness of HTTP does not prove the prompt field
is ready for terminal paste. Use this HTTP bridge for robot prompts.

Robot delegation base 29200 (range 29170-29998, IANA-unassigned), `web`/`serve` and debug stay on 4096; either way, read the port from the host record — never assume it.

## Drive and finish

Write a small UTF-8 client script under `experiments/<date>_<name>/`; send JSON
bodies through its HTTP client. Calls include `?directory=<URL-encoded worktree>`.

- `POST /session` with `{"title":"…"}` creates a session.
- `POST /session/<id>/prompt_async` with model and text parts returns 204.
- `GET /session/status` gives the busy-session map.
- `GET /session/<id>/message?limit=N` returns message info and parts.
- `GET /event` provides server-sent events.

Completion requires the session to be idle AND its newest assistant message to
have a non-null `finish` other than `tool-calls`, with `time.completed` set.
A trailing user summary, empty busy map, healthy process or HTTP 204 alone is not
completion. Independently inspect artifacts and run the handed oracle.

On transport error, mark the observation unavailable, re-read the host record and
verify its nonce before reconnecting. Do not blindly replay a prompt after a
timeout: inspect messages/status first to avoid duplicate work. A replacement host
does not prove an interrupted provider call completed. Inferred from current
worker code: a silent half-open SSE read has no explicit idle deadline; the clean
host-stop probe does not qualify that failure mode.
