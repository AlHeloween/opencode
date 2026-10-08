# 2026-10-08 — orgd wake-routing smokes (S6–S8, plan T6)

What: the wake-routing defect of `plans_completed/2026-10-08_org-verbs-and-heartbeat.md` (T6) —
`orgd.assignee_session` fell back to the worktree's NEWEST session when the assignee had no
PRESENCE there, so «new ticket in your inbox» could land in another robot's session or the
owner's live one (ticket 34c0728e5f stood armed); and `org.py delegate` required `--session`,
leaving an inbox-polled delegator (a Claude session) no way to declare itself un-wakeable.

Run: `python smoke.py` on a machine that can start `dist/bin/opencode.exe serve`.
Sandbox only — the live org and every live host are untouched:
  - a sandbox org repo in %TEMP% (ORG_HOME): `fossil new` + ticket-schema.sql + robot users +
    a chat table mirroring the live org's shape;
  - a fixture worktree in %TEMP% served by its own `opencode serve` (provider env stripped):
    a REAL wake target — qualified first by `probe_serve.py` (host live in 4.2 s; a delivered
    `prompt_async` leaves a user message row in the fixture DB with keys stripped).

Recorded results:

| phase | RED (job `20261008T012926Z_aa5df8aa`, exit 1) | GREEN (job `20261008T013050Z_6e65df50`, exit 0) |
|---|---|---|
| S6 no PRESENCE | FAIL — the ticket woke the newest session (`b4ed5384fd/new: woke ses_…`; 1 user row in the target session) | PASS — counts (0,0)→(0,0); ONE reason line «not woken — no PRESENCE …» across ~6 ticks |
| S7 `--no-wake` | FAIL — `unrecognized arguments: --no-wake` (rc=2) | PASS — delegate OK without `--session`; child DONE → zero log lines for the ticket |
| S8 presence (regression guard) | PASS (baseline) | PASS — wake landed in 1.0 s |

Summaries: `runs/20261008T012939Z_orgd-wake-routing-summary-RED.json`,
`runs/20261008T013108Z_orgd-wake-routing-summary-GREEN.json`.

Live deploy (fixed genesis installed, orgd restarted by the init.py rule — pid 9700): a
`--no-wake` READY probe ticket `3065b2c4d0` (assignee `antigravity`, no PRESENCE) produced
exactly ONE line «3065b2c4d0/new: not woken — no PRESENCE for antigravity in
D:\zPython\opencode — nothing to wake …» and nothing else, ever; after `done` the log stayed
silent (no attempt, no retry lines). Note: the originally armed ticket 34c0728e5f had been
claimed by `claude` (WORKING) before the restart, so its READY path no longer exists — the
fix covers every future such ticket.

Findings kept (both surfaced while qualifying the fixture; both guarded now):
- `fossil sql` reports a SQL error on STDERR and exits 0 (measured: «Error: in prepare, 2 values
  for 3 columns», rc=0, nothing written) — a missing `,now()` in the fixture's config INSERT
  silently produced a default-schema ticket table and the first RED looked like a fixture
  failure. The suite's `fossil()` wrapper now raises on an stderr error, not on rc alone.
- A fresh fossil repo has NO chat table (the live org's came with its creation) — the sandbox
  builder mirrors the live shape, or orgd's `SELECT xmsg FROM chat` dies for the wrong reason.

Boundary, stated deliberately: the «log once» suppression is per daemon RUN (`log_once` keeps a
per-process dict); a daemon restart re-states the current reason exactly once. That is the
observed live behavior and is not a defect.
