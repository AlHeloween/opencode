# Cross-worktree hand-off — resident login, watcher, launch when no host

<!-- intention: a delegation that crosses into another worktree either starts that worktree's robot or leaves a recorded, watched trail -> `delegate --worktree W` ensures W's resident login `smit-<project>`, records `watcher` (default claude) so the orchestrator's `inbox --user <watcher>` shows it with STALLED, and prints the ONE launch command for W's own opencode when W has no live host -->

<!-- goal_sv: cross-worktree-handoff, resident-login, watcher-inbox, stalled-detection, launch-command -->

- **plan_id:** 2026-10-13_cross-worktree-handoff
- **revision:** 1
- **state:** COMPLETE (closed 2026-10-13, commit names this plan)
- **reported:** owner, 2026-10-13: «если работа переносится в другой worktree то робот должен запустить робота там или сделать отчет оркестратору о том что есть задача в другом worktree из-за локальной специфики. А лучше и то и другое.»
- **why it matters:** measured today by reading `~/.org/genesis/org.py` + `orgd.py`: `delegate --worktree W` files READY and records a wake target, but orgd wakes the assignee ONLY through W's live host PRESENCE (`assignee_session` + `opencode_host.connect`); with no live host nothing starts and nobody above is told — and the hourly orchestrator reads only `inbox --user claude`, which today shows nothing about such tickets. The repair is both halves at once: the resident is startable (the printed command) AND the ticket is watched (the `watcher` field + the inbox section).

```yaml
Keywords: cross-worktree-handoff 0.30, watcher-inbox 0.22, resident-login 0.18, stalled-detection 0.16, launch-command 0.14
Semantic dominant: A delegation that crosses into another worktree ensures that worktree's resident login, records a watcher whose inbox shows the ticket with STALLED, and prints the one launch command when that worktree has no live host.
md5: b7f3c1e9a204d68513f0c9ab77e2d4f8
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Evidence (each line carries its instrument)

- ✓ read `scripts/org-genesis/org.py` (`cmd_delegate`, `cmd_inbox`, argparse): `worktree = a.worktree or cwd` (275); `ticket add` carries `workspace_repo` + optional `wake_session/wake_worktree` (283-294); no cross detection, no watcher, no host check anywhere.
- ✓ read `scripts/org-genesis/orgd.py` (`tick` 280-315, `wake` 246-277): a READY wake exists ONLY `assignee_session(assigned_to, workspace_repo)` (newest PRESENCE for that login in that worktree, session must exist) AND `opencode_host.connect(worktree)` (live = `/global/health` nonce echo). No host or no PRESENCE → nothing sent, `log_once` only — the ticket sits unwatched.
- ✓ read `scripts/org-genesis/opencode_host.py` — `lookup(worktree)` + `is_live(record)` is the live-host predicate delegate can reuse in-process (vendored beside org.py; orgd already imports it the same way).
- ✓ read `scripts/org-genesis/init.py` (`ensure_ticket_fields` 85-93) — the idempotent schema path (config `ticket-table` + `fossil rebuild`); the field tuple to extend.
- ✓ read `scripts/org-genesis/ticket-schema.sql` — the ticket table has no `watcher` column.
- ✓ read `scripts/org-genesis/Protocol.md` — `smit-<project>` is already the declared resident convention (line 22) and rule 1 already says «DELEGATE to its resident (`workspace_repo` = that path)».
- ✓ `where cmd_runner` → `D:\zPython\opencode\cmd_runner.exe`; `--port` is a real CLI arg (`packages/opencode/src/cli/network.ts:51`); `cmd_runner start --terminal wt` is an established shape (`plans/2026-09-22_reasoning-stream-render-stability.md:181`).
- ✓ read `scripts/org-genesis/test_queue_contract.py` (388 lines) — the scratch-org harness (tempfile `ORG_HOME`, `ORG_PORT=1`, real `fossil init` + schema, subprocess verbs). Its `effect_ticket` already delegates cross-worktree, so it is also this change's regression surface.

## Tasks

- [x] **T1 — schema: the `watcher` field.** `ticket-schema.sql` gains `watcher TEXT`; `init.py`'s `ensure_ticket_fields` checks it in the same `all(...)` list, so an org holding the wake fields but no `watcher` takes the rebuild that adds it. Binding: `scripts/org-genesis/ticket-schema.sql`, `scripts/org-genesis/init.py`. Oracle: S1/S4 (scratch org schema read-back) + S6 (live read-back at install). ✓ 2026-10-13 — `watcher TEXT` at `ticket-schema.sql:31`; the field tuple extended (`init.py:87`); scratch schema read-back green (run `20261013T121418Z_9fa684a6`); live org rebuilt/upgraded (run `20261013T121759Z_f4a04d33`, `fields upgraded`), live read-back `watcher TEXT: True`.
- [x] **T2 — delegate: the cross branch.** `delegate --worktree W` with W ≠ caller's worktree: (a) ensure W's resident login `smit-<project>` (`fossil user new` + init.py's robot caps; random password never printed); (b) record `watcher` = orchestrator login (`claude` default, `--watcher` override); (c) after the ticket exists, print to stderr — stdout stays exactly the uuid — the host verdict: live host → its URL; no host + `W/bin/opencode.exe` → the ONE `cmd_runner start --terminal wt --cwd W -- W\bin\opencode.exe --port <free>` line; no exe → that fact, the ticket stays READY. `--watcher` on a same-worktree delegate is refused (no silent ignore). Binding: `scripts/org-genesis/org.py` (`cmd_delegate`, `ensure_resident`, `worktree_host_live`, `launch_command`, argparse). Oracle: S1-S3. ✓ 2026-10-13 — run `20261013T121418Z_9fa684a6` S1-S3 green; probe `20261013T121713Z_f5c11c00` verbatim: stdout = uuid only; stderr `resident smit-stand (created); watcher claude` + `cmd_runner start --terminal wt --cwd … -- …\bin\opencode.exe --port 57193`.
- [x] **T3 — inbox: the watching section.** `inbox --user X [--json]` gains `watching` over `watcher = X` and non-terminal states (READY/WORKING/BLOCKED): state, workspace_repo, assignee, heartbeat age, and `stalled` when a lease expired (`lease_until < now`), a heartbeat expired, or a READY ticket sat unclaimed > 1 h (`tkt_mtime`, `STALL_READY_S = 3600`). An empty section renders as a value (`none` / `[]`), never as absence (AGENTS.md invariant). Binding: `scripts/org-genesis/org.py` (`cmd_inbox`, `watching()`). Oracle: S4-S5. ✓ 2026-10-13 — run `20261013T121418Z_9fa684a6` S4-S5 green (fields + STALLED `ready>1h` and `lease`); live `inbox --user claude --json` returns `"watching": []` with rc 0 after the install.
- [x] **T4 — Protocol.** Rule 1 extended with the cross hand-off; DELEGATE/INBOX bullets and the heartbeat section mention `--watcher` / `watching`; the page's own sv updated. `init.py` republishes Protocol from the installed copy, so the wiki page moves in the same change. Binding: `scripts/org-genesis/Protocol.md`. Oracle: S6 (`org.py protocol` read-back carries the rule). ✓ 2026-10-13 — live read-back after install: the `protocol` page carries the CROSS hand-off rule and the `watching:` rule (rc 0).
- [x] **T5 — the smoke moves with the behaviour.** New `scripts/org-genesis/test_cross_handoff.py` (scratch `ORG_HOME` + scratch worktree, no live host) implementing S1-S5 below; the change is closed by one commit naming this plan, and the installed copy is re-read at S6. Binding: the new test file. Oracle: S1-S5 there + the regression pair. ✓ 2026-10-13 — new suite 5/5 (run `20261013T121418Z_9fa684a6`); pre-change RED pinned (run `20261013T121213Z_d0caa5a3`); regressions unchanged: queue 8/8 (`20261013T121430Z_2a4b4960`), wiki 15/15 (`20261013T121430Z_c0431491`); `_build.ps1` exit 0, smoke 10.0.1305 (`20261013T121510Z_664ab18b`).

## Smoke Tests

All commands run through `cmd_runner` (one file per call); every prediction is made BEFORE the run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass.

| # | command | prediction |
|---|---|---|
| B1 | `cmd_runner start --cwd scripts/org-genesis -- python -X utf8 test_cross_handoff.py` on the PRE-change scripts | RED — no resident line, no `watcher` column, no `watching` key; the cases pin that the test observes this change |
| B2 | `cmd_runner start --cwd scripts/org-genesis -- python -X utf8 test_queue_contract.py` on the PRE-change scripts | PASS (baseline; `effect_ticket` delegates cross-worktree, so this is the regression surface) |
| B3 | `cmd_runner start --cwd scripts/org-genesis -- python -X utf8 test_wiki_put.py` | PASS (baseline; surface untouched) |
| S1 | same as B1, post-change | cross delegate: `smit-stand (created)` once (second delegate: `(present)`, still ONE user row), `watcher=claude` on the ticket, `cmd_runner start --terminal wt --cwd … -- …\bin\opencode.exe --port N` on stderr, stdout = exactly the uuid, no password anywhere |
| S2 | same | same-worktree delegate (no `--worktree`, and explicit `--worktree <own>`): `watcher` empty; `--watcher x` there → exit≠0 naming the cross-worktree scope |
| S3 | same | cross delegate to a worktree with no `bin/opencode.exe`: stderr names the missing exe, NO launch line, ticket stays READY |
| S4 | same | `inbox --user claude --json --no-presence`: the ticket under `watching` with state READY, workspace_repo = W, assignee, heartbeat fields, `stalled: false`; text mode prints `watching for claude:`; a same-worktree ticket is absent from `watching` |
| S5 | same | READY backdated 2 h → `stalled: true, stalled_reason: "ready>1h"`; WORKING with an expired `lease_until` → `stalled: true, stalled_reason: "lease"` |
| S6 | `python $ORG_HOME/genesis/init.py` after installing the copy; then `python $ORG_HOME/genesis/org.py protocol` + a `fossil sql` schema read-back | the live ticket table carries `watcher`; the Protocol page carries the cross hand-off rule |
| S7 | `cmd_runner start --cwd <repo root> -- pwsh -NoProfile -File _build.ps1` | exit 0 per `state.json` |
| R | S1's command + B2's command, re-run after every further edit | unchanged PASS (the regressions re-run in the same change) |

## Residuals

- The launch is deliberately MANUAL: delegate prints the ONE command and starts nothing; the delegator's robot (or the owner) runs it. Auto-starting a host from delegate is out of scope here.
- The watcher sees STALLED at ITS OWN poll cadence (the orchestrator reads hourly); the field is computed live per call, no daemon state added.
- `smit-<project>` is derived from the worktree's own name; a worktree whose name is not a valid login shape stays a naming problem of that project, unchanged by this plan.

## Out of scope

- orgd changes (its wake contract is untouched).
- Keeping a wake pending over a dead host (orgd already retries per tick; nothing new).
- Any change to `packages/opencode` sources.

## Rollback

`git revert` of the plan's commit. The schema upgrade is additive (`watcher TEXT`, null for every existing ticket) and older code ignores the column; the live wiki page reverts by re-running the previous `init.py`.
