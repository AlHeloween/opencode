# 2026-10-08 — org verbs + heartbeat smokes (S1–S5)

What: end-to-end smokes for `plans_completed/2026-10-08_org-verbs-and-heartbeat.md` — the org verb
CLI (`scripts/org-genesis/org.py`) and the heartbeat daemon (`scripts/org-genesis/orgd.py`).

Run: `python smoke.py all [--worktree <path>]` on a machine with the live org (`~/.org/org.fossil`)
and a live opencode host for the worktree. The suite creates its own test sessions (`org-smoke-*`),
drives them through `tools/opencode_host.py`, and asserts on session messages and ticket rows —
never on a verb's own print. `session_probe.py` lists/aborts the test sessions.

Recorded results (2026-10-08, job cmd-4; the summary JSON stays in the gitignored tree at
`experiments/2026-10-08_org-heartbeat/runs/20261008T010448Z_org-heartbeat-summary.json`):

| phase | result |
|---|---|
| setup — 3 sessions; a robot session registered `PRESENCE` via `org.py inbox` | PASS 30.6 s |
| S1 claim race (two concurrent claims, two users) | PASS: winner `claude` epoch 1; loser exit 1, «already claimed by claude» |
| S2 child DONE wakes the parent (child session ran `org.py done`) | PASS: DONE wake 4.4 s after the ticket closed |
| S3 stall — lease 60 s, no heartbeat | PASS: «STALLED» wake 73.4 s after the claim |
| S5 READY ticket → assignee session (presence path) | PASS: «new ticket in your inbox» 16.2 s |

S4 (`init.py` twice → one orgd) was measured outside the suite: same pid both runs (13492), and a
single `python.exe` process running `orgd.py`.

Findings kept (both found by these smokes, both fixed):

- `fossil ticket set <uuid> <field> ""` exits 0 and SILENTLY keeps the old value (measured) —
  field resets therefore use `-` (`CLEARED`), not an empty string.
- A woken full-build robot session in this repo acts on the wake (one claimed its ticket) — the
  suite pre-frames its test sessions («reply only OK, use no tools») and aborts them at the end.
