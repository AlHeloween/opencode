<!-- intention: a robot delegates and then leaves its loop, so a human has to poke it to continue -> delegation goes through org.fossil tickets and a heartbeat daemon wakes the delegator (child done / stalled) and the assignee (new ticket), so a robot carries a task to its end with no human touch -->

# Org verbs + heartbeat — delegation through tickets, a robot that is woken to finish

- status: COMPLETE 2026-10-08 — every box earned (S1-S5 green in one run, job cmd-4; S4: init ×2 → one orgd); results archived to experiments_history/2026-10-08_org-heartbeat/
- next: moved to plans_completed/ in the same commit
- waits for: nothing
- sv: { keywords: { robot-heartbeat 0.30, wake-delegator 0.25, org-verbs-cli 0.20, claim-arbitration 0.15, assignee-inbox 0.10 },
        dominant: "A robot that delegates is woken by the organization when its child finishes or stalls, so it finishes the task itself." }
- roadmap: plans/futures/2026-10-07_fossil-organization-roadmap.md (this plan takes G3 and the inbox half of G4)

## The gap (owner, 2026-10-08, verbatim)

«у него нет hearthbeat — чтобы сам доводил дело до конца. А то он роботу в другом ворктри делегировал, а потом
разумеется вышел из рабочего цикла и не проверил, надо залазить и говорить что делать дальше — для автономности это
не очень.»

A session's turn ends when the model stops; nothing re-enters it. The organization knows when a child ticket closes —
so the organization must be the one that knocks.

## Design (DISAS: two files, one loop)

- `scripts/org-genesis/org.py` — the verbs over `$HOME/.org/org.fossil`: `delegate`, `claim`, `heartbeat`, `report`,
  `done`, `escalate`, `inbox`. `delegate` records who to wake: `wake_session` + `wake_worktree` (the delegator's
  opencode session id and worktree). `claim` is arbitrated by an exclusive-create lock file
  (`$HOME/.org/locks/<ticket>.<epoch>`) — `fossil ticket` has no compare-and-swap.
- `scripts/org-genesis/orgd.py` — the heartbeat daemon, one loop every 15 s:
  1. a ticket turned DONE / BLOCKED and its delegator not yet woken for this state → `prompt_async` into
     `wake_session` on the host of `wake_worktree` (client: `tools/opencode_host.py`), text = ticket id, state,
     report ref, «verify it and continue your task»; record `woken_state`;
  2. a WORKING ticket with no HEARTBEAT chat line within its lease → wake the delegator with «stalled»;
  3. a READY ticket whose assignee's worktree has a live host → wake the assignee with «new ticket in your inbox»;
  4. a host not live → nothing sent, retry next tick (never a second server).
- `init.py` (the «sect» rule) starts `orgd` the same way it starts the fossil server, idempotently: a second
  `init.py` finds it alive and starts nothing. Schema fields added by `init.py`, idempotently.
- Protocol wiki page: «after DELEGATE end your turn naming the ticket; the organization wakes you».
- Not in scope: waking a Claude session (no host API) — Claude reads its inbox; recorded as residual.

## Tasks

- [x] T1 `org.py` verbs + schema fields (`wake_session`, `wake_worktree`, `woken_state`), installed to `$HOME/.org/genesis` — DONE 2026-10-08: `scripts/org-genesis/org.py` (delegate/claim/heartbeat/report/done/escalate/inbox; claim arbitrated by the exclusive epoch lock); install = copies + `fossil uv add` ×6. Evidence: S1 in job cmd-4 — winner `claude` epoch 1, loser exit 1 «already claimed by claude 1791421387»; sandbox race cmd-1/cmd-2. Finding fixed: `fossil ticket set F ""` exits 0 and silently keeps the old value → resets use `-` (CLEARED).
- [x] T2 `orgd.py` loop (cases 1-4) + start from `init.py` — DONE 2026-10-08: job cmd-4 — S2 DONE-wake 4.4 s, S3 STALLED-wake 73.4 s (lease 60), S5 inbox-wake 16.2 s; `woken_state` recorded only after a 2xx; S4: init ×2 → one orgd (pid 13492, one python.exe running orgd.py); wake lines in `~/.org/orgd.log`.
- [x] T3 how a robot knows its own session id and worktree inside a tool call — MEASURED 2026-10-08: a tool call's environment carries no session id (`set OPENCODE` → OPENCODE_PID, OPENCODE_RUN_ID, OPENCODE_PROCESS_ROLE only); the id is visible to the model as the `[session: ses_…:<model>]` banner (session/llm.ts:569) and equals the session row; worktree = cwd. Auto-discovery from the running tool call proven live: delegate attributed its caller, and a robot session's own `org.py inbox` registered its own session. Written into Protocol §«Who you are in a tool call».
- [x] T4 Protocol wiki page + `scripts/org-genesis/Protocol.md` updated with the verbs CLI and the wake rule — DONE 2026-10-08: rewritten around the verbs, «after DELEGATE end your turn; the organization wakes you», presence and the `-` reset marker; committed to the wiki by init (`fossil wiki export Protocol` shows it).
- [x] T5 smoke tests S1-S5 green, run ids here — DONE 2026-10-08: S1-S5 all PASS in ONE run, job cmd-4, summary `experiments/2026-10-08_org-heartbeat/runs/20261008T010448Z_org-heartbeat-summary.json` (raw: S1 loser exit 1 naming the holder; S2 wake_s 4.4; S3 stall_wake_s 73.4; S5 wake_s 16.2). First run job cmd-3 = S3/S5 green and surfaced the two findings (empty-set defect; child-session fixture), both fixed before the rerun.

## Smoke Tests

- S1 claim race: two `org.py claim` on one ticket at once → exactly one wins, the other exits non-zero naming the owner.
- S2 child DONE wakes the parent: two sessions on the `bin/` host of `D:\zPython\opencode`; parent's ticket with
  `wake_session` = parent; `org.py done` on it → within 30 s the parent session has a new user message carrying the
  ticket id (read `GET /session/<id>/message`).
- S3 stalled: a WORKING ticket, lease 60 s, no heartbeat → the parent is woken with «stalled».
- S4 `init.py` twice → one `orgd` alive.
- S5 a READY ticket assigned to a worktree with a live host → that session receives it.
