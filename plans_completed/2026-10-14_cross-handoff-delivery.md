# Cross hand-off delivery — the ticket reaches a session, not a hint

<!-- intention: a cross hand-off that finds a live host prints «run `org.py inbox` there» and the ticket waits for a resident nothing prompts; a host that appears LATER changes nothing -> the hand-off DELIVERS the ticket into a NEW session on that host (pinned to the fleet's funded model, never the worktree's recent free default) and records wake_session; orgd delivers a READY ticket when its host appears later; the watcher's inbox shows STALLED for a READY ticket past N minutes with no wake target -->

<!-- goal_sv: ticket-delivery, session-open, funded-model-pin, orgd-retry, no-wake-stall -->

- **plan_id:** 2026-10-14_cross-handoff-delivery
- **revision:** 1
- **state:** COMPLETE (closed 2026-10-14, commit names this plan)
- **reported:** owner, 2026-10-14: «Smit, a second item in your t32 lane … (a) when the target worktree has a live host, the cross hand-off DELIVERS the ticket into a new session there (its TUI shows it, model pinned to the fleet's funded pair deepseek/deepseek-flash, never the worktree's recent free default) and records wake_session; (b) a READY cross-worktree ticket whose host appears LATER is delivered by orgd on its next tick (no re-delegation needed); (c) the watcher's inbox shows STALLED for a READY ticket older than N minutes with no wake target.»
- **measured (Claude, 2026-10-14):** ticket fdc399c09c stayed READY with no wake target while `D:\zPython\ADID_Python` had no host; after the host was started (run 20261014T122516Z_974f26c2, http://127.0.0.1:50123/) the re-delegated e01effe5ac found it live but only printed «run `org.py inbox` there to register the resident; no launch needed» — no session was opened, so nothing prompts the resident.
- **class:** a hand-off that announces an address instead of using it — the queue's wake contract (orgd → PRESENCE → prompt_async) has no path for «nobody declared PRESENCE yet», so a fresh host owns a silent inbox.

```yaml
Keywords: ticket-delivery 0.30, session-open 0.22, funded-model-pin 0.18, orgd-retry 0.18, no-wake-stall 0.12
Semantic dominant: A cross hand-off delivers its ticket into a NEW session on the target worktree's live host, pinned to the fleet's funded model, orgd delivers a READY ticket whose host appears later, and the watcher's inbox flags a READY ticket with no wake target.
md5: 0b7e4d29c6a13f85de90b2c4718fa6d3
prev-md5: 3f8a2c7e91d4b6a08c5e2f7d3140ab92
parent-goal-md5: 00000000000000000000000000000000
```

## Evidence (each line carries its instrument)

- ✓ read `scripts/org-genesis/org.py` (`cmd_delegate`, cross branch): a live host prints «run `org.py inbox` there to register the resident; no launch needed» — the delegation ENDS there; nothing is delivered and no session is opened.
- ✓ read `scripts/org-genesis/orgd.py:303-314` (`tick`, READY branch): `assignee_session(assigned_to, workspace_repo)` is the ONLY door — no PRESENCE → `log_once`, nothing sent; a host appearing later changes nothing (the ticket is never delivered).
- ✓ read `scripts/org-genesis/opencode_host.py`: `connect(worktree)` → Host with Basic auth; `post("/session", {...})` and `post(f"/session/{id}/prompt_async", {...})` are the API; `is_live` = `/global/health` nonce echo. orgd's `wake()` already uses the same client for one-shot prompts.
- ✓ read `packages/opencode/src/session/prompt.ts:3171-3198`: `PromptInput.model = {providerID, modelID}` — the pin travels with the prompt; `Session.CreateInput` (session.ts:391) carries only title/parent/permission, so the model is pinned on delivery, not on create.
- ✓ live check 2026-10-14: `bin/auth.json` holds the `deepseek` provider and `models/deepseek.json` holds `deepseek-flash` — the fleet's funded pair is `deepseek/deepseek-flash`; the ADID_Python host answered `GET /provider` (url http://127.0.0.1:50123/, pid 23312, live).
- ✓ read `test_cross_handoff.py` (harness): scratch `ORG_HOME`, real Fossil repo, verbs as subprocesses; a fake HTTP host is the honest stand for this contract (real `/session` + `/prompt_async` shapes, no provider spend).

## Tasks

- [x] **T1 — the hand-off delivers.** `org.py` gains `FLEET_MODEL = {"providerID": "deepseek", "modelID": "deepseek-flash"}` and `deliver_into_new_session(worktree, title, text) -> (session_id, why)`: `POST /session` (title), then `POST /session/<id>/prompt_async` with the pin; on a live host, `delegate` (cross) calls it, records `wake_session`/`wake_worktree` and `woken_state=NEW`, and says which session got the ticket — the «run `org.py inbox` there» line survives only for the failure path. Binding: `scripts/org-genesis/org.py`. Oracle: S9. ✓ 2026-10-14 — GREEN `20261014T124353Z_4cc4f183` (S9: the fake host got `POST /session` + one `prompt_async` carrying `model {providerID: deepseek, modelID: deepseek-flash}`, the ticket records the session); RED on item1 code `20261014T124453Z_d8d21f43` (`'' != 'ses_fakehost1'`).
- [x] **T2 — orgd delivers when the host appears later.** READY branch: no PRESENCE → if the host is live, open a session and deliver the same text (via the shared function), record it, `woken_state=NEW`; failure stays a `log_once` (never a silent loop). Binding: `scripts/org-genesis/orgd.py`. Oracle: S10. ✓ 2026-10-14 — S10 green (`orgd.py --once` delivered the LATE ticket once its host appeared); live: orgd restarted on the new code (pid 19500→36072) and its log shows the delivery pass across READY tickets (20:25–20:43).
- [x] **T3 — the watcher sees a ticket with no address.** `watching()` gains `wake_session` and flags a READY ticket older than `STALL_NOWAKE_S` (600 s) with NO wake target as `stalled, reason "ready/no-wake"`; the ready>1h rule stays for tickets that HAVE a target. Binding: `scripts/org-genesis/org.py`. Oracle: S11. ✓ 2026-10-14 — S11 green (11-minute-old READY with no wake target → STALLED(ready/no-wake)); S5 re-pinned to the wake-target path (it sets `wake_session`, so >1h fires) — both in `20261014T124353Z_4cc4f183`.
- [x] **T4 — the tests move with the behaviour.** `test_cross_handoff.py` gains a fake host (http.server on 127.0.0.1, `server_host` row in the scratch worktree DB, health nonce) and S9 (live-host delegate delivers + records + pins the model), S10 (host appears later → orgd `--once` delivers), S11 (no wake target → STALLED(ready/no-wake) after N minutes). Binding: `scripts/org-genesis/test_cross_handoff.py`. Oracle: RED on HEAD, GREEN after T1-T3. ✓ 2026-10-14 — RED `20261014T124453Z_d8d21f43` Ran 11 tests FAILED (failures=3: S9, S10, S11) → GREEN `20261014T124353Z_4cc4f183` Ran 11 tests OK.
- [x] **T5 — install, restart orgd, deliver the open ticket.** Copy the changed runtime files, run `init.py`, restart the orgd daemon so it runs the new code, then deliver ticket `e01effe5ac` through the fixed path; report its `lease_owner`/`heartbeat_at`. Binding: `$ORG_HOME/genesis`, live org. Oracle: S12/S13. ✓ 2026-10-14 — `org.py`/`orgd.py` installed (installed==repo sha256), `init.py` rc 0, orgd restarted (pid 19500 → 36072); e01effe5ac delivered via the fixed path: `wake_session=ses_ec58afb18ffeIcD2V366ntlIgI`, `wake_worktree=D:\zPython\ADID_Python`, `woken_state=NEW`; `lease_owner`/`heartbeat_at` empty (READY, unclaimed at delivery time). Protocol.md updated (rule 1) and installed.

## Smoke Tests

All commands run through `cmd_runner` (one file per call); every prediction precedes its run (@SMOKE_BEFORE).

| # | command | prediction |
|---|---|---|
| B1 | `python -X utf8 test_cross_handoff.py` on the PRE-change scripts + S9-S11 | RED — no session is opened, no `wake_session` recorded, the pin never travels, `watching` has no no-wake verdict |
| S1 | same file after T1-T3 | PASS — the fake host received `POST /session` + one `prompt_async` carrying `model {providerID: deepseek, modelID: deepseek-flash}`; the ticket records the session |
| S2 | regressions: `test_queue_contract.py`, `test_wiki_put.py`, `test_forum_post.py` | PASS, unchanged |
| S3 | live: deliver `e01effe5ac` through the fixed path on the ADID_Python host | a NEW session on http://127.0.0.1:50123/ receives the ticket text; the ticket records it; lease/heartbeat read back |
| S4 | `cmd_runner start --cwd <repo root> -- pwsh -NoProfile -File _build.ps1` | exit 0 per `state.json` |
| R | S1's file re-run after every further edit | unchanged PASS |

## Residuals

- The pin is a constant pair; a funded-model change is a code change (a config surface for the fleet pair is not built here).
- orgd opens a session only when the host is LIVE; a worktree with no `bin/opencode.exe` and no host still gets a READY ticket with no address (the watcher's no-wake STALLED is what surfaces it).
- The delivered session is the resident's own; the model pin means the worktree's recent free default is never used for it.

## Out of scope

- Auto-launching the resident's TUI (the 2026-10-13 hand-off prints that ONE command; this plan delivers into an already-live host).
- Re-delegating or re-writing existing tickets (only e01effe5ac is delivered, by its delegator's decision).

## Rollback

`git revert` of the plan's commit restores the announcement-only hand-off; delivered sessions stay (they are ordinary sessions) and the orgd daemon restarts on the reverted code at the next `init.py`.
