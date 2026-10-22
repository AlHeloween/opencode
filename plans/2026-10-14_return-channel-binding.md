# Return-channel binding — done/blocked carry the next clean state

<!-- intention: `done [--report]` makes the report optional and `escalate --code "why"` sets BLOCKED on one sentence, so the delegator receives bare fields and cannot tell a busy WORKING ticket from a dead one (heartbeat frozen at claim time) -> `done` refuses without a CLEAN_NEXT_STATE technote, `escalate` refuses without a stop-claim technote, the wake text and `inbox --json` carry the report ref with its first lines, and orgd refreshes the heartbeat from the claimed session's own activity (silence stays silence); the retracted session-delivery machinery leaves the tree -->

<!-- goal_sv: return-channel, done-report-gate, stop-claim-gate, delegator-wake, heartbeat-activity -->

- **plan_id:** 2026-10-14_return-channel-binding
- **revision:** 1
- **state:** DRAFT
- **reported:** owner, 2026-10-14 (CLEAN re-brief): «Вообще ты от них должен получать: done… blocked… next clean state…»; plus the frozen-heartbeat gap (Claude, 2026-10-14): ticket e01effe5ac claimed 13:23:51Z, `heartbeat_at` frozen at claim time while the resident visibly worked — the delegator cannot tell «working» from «dead».
- **retracted (owner stop, 2026-10-14):** delivering a ticket INTO another project's resident session (earlier items a/b) and «deliver e01effe5ac». The delivery code in the tree (uncommitted) is REMOVED here, not shipped. The owner delivers to the ADID resident himself; e01effe5ac is already claimed (WORKING).
- **class:** the org protocol has the kernel's seam — the return channel (`done`/`escalate`) carries no falsifiable content, and the liveness signal (`heartbeat_at`) is written only by the worker's own hand.

```yaml
Keywords: return-channel 0.28, done-report-gate 0.22, stop-claim-gate 0.20, heartbeat-activity 0.18, delegator-wake 0.12
Semantic dominant: done refuses without a clean-next-state technote, escalate refuses without a stop-claim technote, the delegator's wake and inbox carry the report ref with its first lines, and orgd refreshes the heartbeat from the claimed session's own activity.
md5: 7c2d9a4f1e6b8304c5d7e2a9b6140f3d
prev-md5: 0b7e4d29c6a13f85de90b2c4718fa6d3
parent-goal-md5: 221e9347f99b038b669b74d80886fca1
```

## Evidence (each line carries its instrument)

- ✓ read `org.py:563-576` (`cmd_done`/`cmd_escalate`): `--report` optional and unvalidated; `--code` a bare string; DONE/BLOCKED close on fields alone.
- ✓ read `org.py:552-560` (`cmd_report` + `create_technote`, `:290-301`): a technote is a wiki page (`wiki create --technote`), readable back via `fossil wiki export PAGE`; name may gain a ` [<short>]` suffix on collision.
- ✓ read `orgd.py:289-296` (tick DONE/BLOCKED): the wake text carries `report=<ref>` as a bare field; no content follows it. `cmd_inbox` (`org.py:617-642`) lists only non-terminal tickets — a delegator never sees DONE/BLOCKED with their reports in `inbox --json`.
- ✓ read `packages/opencode/src/util/stop-claim.ts:101-146` (`stopClaimProblems`): the `## Stop claim` predicate — routes table with columns route|receipt|failing component (non-empty rows), untried routes, reopen_when. The Python gate below ports this predicate (same section/table rules, cited here), it does not duplicate it blindly.
- ✓ measured live (fossil sql, 2026-10-14): e01effe5ac is WORKING with a frozen `heartbeat_at` while the resident works — the ticket's liveness signal is stale by construction.
- ✓ read the live session DB (`D:\zPython\opencode\.opencode\data\opencode.db`): `part(id, message_id, session_id, time_created, time_updated, ...)` — `MAX(time_updated)` per `session_id` is the claimed session's own activity, readable read-only from the target worktree's DB.
- ✓ live org read-back (fossil, 2026-10-14): the stray `smit-ADID_Python` is GONE (removed in the earlier session); `smit-adid_python` remains; 0 ticket/event/chat references to the stray spelling. Item 1's commit `da596fc24d` is in history; the case-fold behaviour stands.
- ✓ `git diff --stat` (2026-10-14): the uncommitted tree holds ONLY the retracted delivery machinery (`deliver_into_new_session`, delegate/orgd delivery calls, FakeHost + S9/S10 tests, Protocol delivery paragraph). The no-wake `ready/no-wake` verdict and the case-fold code are KEEP.
- ✓ `test_queue_contract.py` harness (read): fixture `ORG_HOME`, verbs as subprocesses, `org`+`orgd` imported with fixture-bound ORG, `run_orgd_once()`, `make_worktree` (note: its `part` table lacks time columns — the heartbeat test carries the real shape itself).

## Tasks

- [ ] **T1 — the retraction leaves the tree.** `org.py`: remove `FLEET_MODEL` + `deliver_into_new_session`, restore the hint-only live-host message. `orgd.py`: remove `import org` + the delivery else-branch (pure `log_once` again). `Protocol.md` rule 1: restore the hint paragraph. `test_cross_handoff.py`: remove FakeHost/`write_host_record`/LIVE/LATE fixtures/S9/S10 (keep S11 + NOWAKE fixtures + the `backdate_mtime` minutes form + the S5 wake-target pin). Binding: the four files above. Oracle: the delivery tests are gone; S1-S8 + S11 stay green.
- [ ] **T2 — `done`/`escalate` refuse without their reports.** `done` requires `--report NAME`: the technote (exact name, else `NAME [<short>]`) must carry four non-empty `##` sections (case-insensitive): Completed (with receipts — run ids/hashes/commits), Risks, Residual, Route. `escalate` gains required `--report NAME`: the technote must carry a valid `## Stop claim` — routes table (route|receipt|failing component, non-empty rows), untried routes, reopen_when — the ported predicate, citing `stop-claim.ts`. Refusals name the missing piece. `done` records `result_ref=<actual technote name>`; `escalate` records `knowledge_ref=<actual technote name>` (failure findings) and keeps `--code`/`failure_code`. Binding: `scripts/org-genesis/org.py`. Oracle: R1 (fail-first).
- [ ] **T3 — the delegator receives the report, not the fields.** orgd DONE/BLOCKED wake text carries `report=<ref>` (DONE) / `stop-claim=<ref>` (BLOCKED) plus the technote's first lines (bounded: first 5 non-empty lines, ≤600 chars). `inbox --json` gains `verdicts`: tickets with `delegated_by = user` in DONE/BLOCKED (latest 20 by `tkt_mtime`), each with the report ref and the same excerpt. Binding: `org.py`, `orgd.py`. Oracle: R1.
- [ ] **T4 — the heartbeat follows the work.** orgd tick, WORKING branch, before the stall verdict: if the ticket has `wake_session` + `wake_worktree`, read `MAX(time_updated)` for that session in the target worktree's DB; when newer than `heartbeat_at`, set `heartbeat_at=<activity s>`, `lease_until=<tick now>+LEASE_S`, `woken_state=CLEARED` (a resumed worker may stall-again later). An unreadable DB is a `log_once`, never a failure. A quiet session changes nothing — silence means silence. Binding: `orgd.py`. Oracle: R2 (fail-first).
- [ ] **T5 — publish, install, close.** `Protocol.md` DONE/ESCALATE + HEARTBEAT bullets state the gates (note: the Protocol page is published by `init.py`, not `wiki-put` — `wiki-put` refuses it by design; the mechanism stays `init.py`). Copy the changed runtime files into `$ORG_HOME/genesis` (byte-compared first), run `init.py`; re-verify the stray login is gone (user list read-back); commit the plan's paths only. Binding: `$ORG_HOME/genesis`, git. Oracle: S5/S6 + demo.
  **t135 addendum 2 (2026-10-22): all five boxes T1–T5 are class (b) — robot-finishable, each with its binding and its fail-first oracle (B1/B2 RED, R1/R2/R3 PASS, S5/S6 + demo).** Next: T1 first (the retraction leaves the tree — the four files above), then T2–T4 against the fixture queue, then T5. No owner decision, no supersession, nothing unobservable.

## Smoke Tests

All commands run through `cmd_runner` (one file per call); every prediction precedes its run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass. No `_build.ps1` (owner rule: one build at a time, run by the fleet lead — the org scripts are not in the binary).

| # | command | prediction |
|---|---|---|
| B1 | `python -X utf8 test_queue_contract.py` on the PRE-change scripts + the new R1/R2 cases | RED — `done` without `--report` closes DONE; a report without the four sections is accepted; `escalate` without a stop-claim report closes BLOCKED; a busy session leaves the heartbeat frozen |
| B2 | `python -X utf8 test_cross_handoff.py` on the PRE-change-retraction tree | RED — S9/S10 assert delivery; after T1 they are gone and S1-S8 + S11 pass |
| R1 | same queue file after T2-T3 | PASS — `done` refused without the report (names it), refused with a thin report (names the missing section), accepted with the four sections (`result_ref` pinned); `escalate` refused without the stop claim (names it), accepted with routes+untried+reopen (`knowledge_ref` pinned); wake text and `inbox --json verdicts` carry ref + first lines |
| R2 | same queue file after T4 | PASS — a WORKING ticket whose session gained a newer part gets `heartbeat_at`/`lease_until` refreshed by `orgd --once`; a quiet session is untouched; an unreadable DB changes nothing |
| R3 | `python -X utf8 test_cross_handoff.py` after T1 | PASS — S1-S8 + S11 green, no delivery paths remain |
| R4 | `python -X utf8 test_wiki_put.py`, `test_forum_post.py` | PASS, unchanged |
| S5 | copy changed files to `$ORG_HOME/genesis` (byte compare first), then `python $ORG_HOME/genesis/init.py` | install sha == HEAD sha; init exits 0 (idempotent) |
| S6 | live: `fossil user list -R ~/.org/org.fossil` + stray-reference counts | `smit-ADID_Python` absent, `smit-adid_python` present, 0 references |
| D | live demo: `done` refused without a report, accepted with one (scratch ticket, `--no-wake`, claimed, reported, done) | refusal names the missing report; acceptance prints DONE with `report=<name>` |

## Residuals

- The four `##` headings are the contract; a report that phrases them differently is refused (the refusal names the heading — the worker renames, nothing is lost).
- The stop-claim port lives in `org.py`; if `stop-claim.ts` changes, the port follows by hand (both directions are cited in code comments).
- `grant_forum_caps` walks the actual user list and needs no folding (recorded 2026-10-14).
- The completed delivery plan (`plans_completed/2026-10-14_cross-handoff-delivery.md`) stays as history; this plan's T1 records its retraction — history is not rewritten.

## Out of scope

- Any delivery into another project's session (retracted — this plan removes it).
- Re-delegating or re-writing existing tickets (no live ticket is touched; the demo uses a scratch ticket).
- `packages/opencode` sources; `_build.ps1`.

## Rollback

`git revert` of the plan's commit restores the optional-report verbs and the manual-only heartbeat; the retracted delivery stays retracted (its removal is a separate, earlier-in-time change inside the same commit — reverting re-arms nothing, since the delivery code is deleted, not flagged).
