<!-- intention: installed orgd/org.py run delivery code that is in NO git commit (DeepSeek pin, 402 since 10-14) while the repo holds the maintenance gate and other lanes' uncommitted hunks -> delivery lands in git pinned to the fleet's one model source (dispatch.py Go contributor xhigh, never hard-coded DeepSeek), the maintenance gate and the other lanes' hunks survive, M1 mints trust only on receipts, and a worker can contest a reject with evidence -->
<!-- goal_sv: org-reconcile 0.30, fleet-model-source 0.25, mint-receipt 0.20, contest-route 0.15, install-restart 0.10 -->
# t67 — org runtime: one source in git, the fleet's model order, then M1 and a contest verb

- **plan_id:** 2026-10-16_org-reconcile-m1-contest
- **revision:** 1
- **state:** DRAFT
- **reported:** t67 brief (Claude, 2026-10-16, re-measure before acting)

```yaml
Keywords: org-reconcile 0.30, fleet-model-source 0.25, mint-receipt 0.20, contest-route 0.15, install-restart 0.10
Semantic dominant: Delivery reaches git pinned to the fleet's one model source with the maintenance gate kept, then verify mints trust only on receipts and a reject becomes contestable with evidence.
md5: 7f3a9c1e4b5d6a708192c3d4e5f6a7b8
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Evidence (each line carries its instrument)

- ✓ CONFIRMED (`git log --all -S deliver_into_new_session -- scripts/org-genesis`, empty): the delivery code is in NO git commit.
- ✓ CONFIRMED (read installed `C:/Users/Alexander/.org/genesis/org.py:105,364-382,482-494`): installed-only `FLEET_MODEL = {deepseek/deepseek-flash}` + `deliver_into_new_session` (prompt_async WITHOUT agent/variant) + delegate delivery branch; installed orgd (`orgd.py:51,314-321`) delivers on no-PRESENCE, and has NO maintenance gate.
- ✓ CONFIRMED (read repo `scripts/org-genesis/orgd.py:280-294`): repo-only t55 maintenance drain gate (`maintenance_marker`/`in_maintenance`) — the installed orgd wakes robots mid bin-promotion.
- ✓ CONFIRMED (`git diff -- scripts/org-genesis/org.py`): repo uncommitted hunks are ONLY `STALL_NOWAKE_S` + `wake_session` in `watching` (plan `2026-10-14_return-channel-binding.md`, another lane's DRAFT — keep, never overwrite); repo `watching` carries slug columns the installed copy predates (slugs landed `675dfbf214`, `c353c5d16a` today — keep).
- ✓ CONFIRMED (`git diff -- scripts/org-genesis/test_cross_handoff.py`): repo tests carry S11 (no-wake) only; S9/S10 delivery tests were never committed and are not on disk anywhere — slice S1 writes them anew (fake host), not recovers them.
- ✓ CONFIRMED (read `experiments/2026-10-08_robot-wave/dispatch.py:15-28`): fleet order today is Go contributor (`MODEL = FALLBACK_MODEL = {opencode-go/muse-spark-1.3-contributor}`, `VARIANT = xhigh`); zen free exhausted (`FreeUsageLimitError`, retry-after 64404 s, t68). The t68 `GET/PUT /chain` route is the FUTURE single source — until it is in the bin host, dispatch.py is the one place.
- ✓ CONFIRMED (read repo `org.py:624-647` + CLI `1196-1205`): `verify` takes no receipt and records none; no self-delegation refusal; no `contest` verb anywhere. Schema (`ticket-schema.sql`) has no receipt/dispute column.
- ✓ CONFIRMED (read both `Protocol.md` rule 1): both copies are hint-only — delivery is undocumented; the reconcile documents it.

## Tasks

- [x] **S1 — Reconcile: delivery into git on the fleet's model, gate kept, lanes kept.** `org.py`: `FLEET_MODEL = {opencode-go/muse-spark-1.3-contributor}` + `FLEET_VARIANT = xhigh` (comment cites dispatch.py as the source, chain route as the future) + `deliver_into_new_session` (prompt_async carries `agent: build` + model + variant — installed code sent neither) + delegate cross-branch delivery (failure path keeps the hint). `orgd.py`: `import org` + no-PRESENCE delivery else-branch; maintenance gate stays first. `Protocol.md` rule 1 documents the delivery + pin. Tests: S9 (live-host delegate delivers, pins model+variant, records wake_session/NEW), S10 (orgd `--once` delivers when the host appears later, exactly once), S11 unchanged, plus a mirror test pinning FLEET_MODEL/VARIANT to dispatch.py effective values. Install: copy changed runtime files to `$ORG_HOME/genesis`, byte diff 0 (sha256), `init.py` rc 0, then STOP — owner restarts orgd (never stop/restart it here). Ticket `355f6a3d4d` (READY, Codex channel) then delivers on Go/xhigh, not DeepSeek. Binding: `scripts/org-genesis/{org.py,orgd.py,Protocol.md,test_cross_handoff.py}`, `$ORG_HOME/genesis`. Oracle: B1 RED → R1 PASS + S5/S6 + D. ✓ 2026-10-16 DONE — B1 RED (3 failed as predicted) → R1 12/12 (11.02 s) + regressions 8+8+15+11 isolated; installed == repo sha256 (org.py 17f959ae); init.py rc 0, orgd pid 36072 untouched; restart requested; S2/S3 next.
- [ ] **S2 — M1 mint rule** (`plans/2026-10-15_dais-peer-trust-reward.md` M1): `verify` requires `--receipt` (run id / digest) and records it in a new `verify_receipt` ticket field (schema + `ensure_ticket_fields` upgrade path); verifying a self-delegated ticket (`delegated_by == assigned_to`, canon) is refused for trust — the ticket stays closable via `cancel`. Until M1 lands, backlog receipts live in the trust plan. Binding: `scripts/org-genesis/{org.py,ticket-schema.sql,init.py,test_queue_contract.py,Protocol.md}`. Oracle: V-cases RED-first, then PASS; self-verify control drops out.
- [ ] **S3 — contest verb** (`plans/futures/2026-10-16_dais-autonomous-organization-and-legal-path.md` charter art. 1): `contest <ticket> (--file|--text)` by the assignee on a rejected (READY + `knowledge_ref`) ticket records the dispute (`contest_ref` technote + wake to the delegator); the delegator answers with a verdict carrying a receipt (M1). Binding: `scripts/org-genesis/{org.py,ticket-schema.sql,test_queue_contract.py,Protocol.md}`. Oracle: contest→dispute recorded→delegator re-verdict with receipt; contest by a stranger refused; contest on a never-rejected ticket refused.

## Smoke Tests

All python through the repo's own interpreter; every prediction precedes its run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass. No `_build.ps1` for the scripts (owner rule: one build at a time — the fleet lead runs it; org scripts are not in the binary). The final `_build.ps1` runs once at close per the task rules.

| # | command | prediction |
|---|---|---|
| B1 | `python -m pytest scripts/org-genesis -q` on the PRE-change tree + new S9/S10/mirror cases | RED — no session is opened, no wake_session recorded, the pin never travels, mirror fails on DeepSeek |
| R1 | same after S1 | PASS — fake host got `POST /session` + one `prompt_async` carrying model Go contributor + variant xhigh; ticket records the session; S1-S8 + S11 green; mirror PASS |
| R2 | `python -m pytest scripts/org-genesis -q` after S2 | PASS — `verify` refused without `--receipt` (names it), accepted with one (`verify_receipt` pinned); self-delegated verify refused for trust, `cancel` still closes |
| R3 | same after S3 | PASS — contest records `contest_ref` + wakes delegator; stranger/never-rejected contest refused; re-verdict carries a receipt |
| R4 | regressions `test_queue_contract.py`, `test_wiki_put.py`, `test_forum_post.py`, `test_ticket_slugs.py` | PASS, unchanged |
| S5 | copy changed files to `$ORG_HOME/genesis` (sha256 first), then `python $ORG_HOME/genesis/init.py` | install sha == repo sha; init exits 0 (idempotent) |
| S6 | read back installed `org.py`/`orgd.py` | byte diff 0 vs repo; `FLEET_MODEL` is Go contributor; maintenance gate present; slugs present |
| D | live: `python $ORG_HOME/genesis/org.py inbox --user claude --json --no-presence` | `355f6a3d4d` listed (delivery itself happens after the owner's orgd restart, never here) |

## Residuals

- The orgd restart is the owner's: after S5/S6 this slice STOPS with the restart request; until the restart the live orgd runs DeepSeek delivery without the gate.
- `experiments/.../dispatch.py` is gitignored working-tree state: the mirror test reads it as the source; if the fleet order moves, the mirror fails LOUD (that is its job) and FLEET_MODEL follows by hand until the chain route lands.
- `plans/2026-10-14_return-channel-binding.md` stays a DRAFT of another lane; its T1 retraction is superseded by this reconcile (owner direction t67) — noted here, history not rewritten.
- `plans_completed/2026-10-14_cross-handoff-delivery.md` stays as history (untracked); this plan does not move it.

## Out of scope

- Restarting/stopping orgd; delivering `355f6a3d4d` by hand.
- `packages/opencode` sources; `bin/`; kernel; the t68 chain route itself.
- Re-delegating or re-writing existing tickets; touching the other lanes' hunks (slugs, STALL_NOWAKE) beyond keeping them.

## Rollback

`git revert` of the slice commit restores the hint-only hand-off; delivered sessions stay (ordinary sessions); the installed copies are re-synced by re-running S5/S6 from the reverted tree.

## Claims (assistant proposes; only @ORACLE binds Exact)

| ID | Statement | Falsifier |
|---|---|---|
| CL1 | Installed delivery is in no git commit; repo has the gate but no delivery | `git log -S` non-empty OR repo tree contains `deliver_into_new_session` |
| CL2 | Go contributor xhigh is today's fleet order; zen free exhausted | dispatch.py shows another effective MODEL OR a live free probe answering within budget |
| CL3 | A mirror test can hold org.py's pin to dispatch.py without copying | mirror passes while dispatch.py and org.py disagree |

## Risks

| ID | Trigger | Severity | Containment / rollback | Owner |
|---|---|---|---|---|
| R1 | Overwriting the other lanes' uncommitted hunks (slugs, STALL_NOWAKE) | critical | Own-hunks-only edits; `git diff` read-back before every commit; commit_own private index | Smit |
| R2 | Shared `.git/index` sweeps another robot's staged work | critical | `commit_own.py --session` only; `--shared/--apply-patch` for `_progress_log.md`; lock → wait 5 s, retry | Smit |
| R3 | Installed orgd keeps delivering on DeepSeek until restarted | high | STOP after S6 with the restart request; ticket `355f6a3d4d` named explicitly | Owner via Claude |
| R4 | Fake-host tests prove shape, not a live host | medium | Shapes taken from `opencode_host.py` + completed-plan receipts; no live delivery claimed | Smit |
| R5 | Two robots share this tree on disjoint paths | medium | Own paths only; never `git add -A`; no worktree of another project touched | Smit |

## Execution envelope (proposed; binds at G4)

action_classes: READ, PLAN_WRITE, MODIFY_PROJECT (bindings above only). No PROMOTE_STABLE, no SELF_MODIFY, no EXTERNAL_EFFECT (no live delivery, no ticket writes on the production org — inbox reads are `--json --no-presence`). Tools: read/grep/glob, edit/write, run (python/pytest/git), task (researcher_agent for any live probe — none planned), cmd_runner only for the closing `_build.ps1`. Bounds: steps 70, tools 180, loops 3, depth 2, time 5 400 000 ms. Prohibitions: `bin/`, `--no-verify`, bare `git commit`, `bun test` without a path, kernel, orgd stop/restart.
