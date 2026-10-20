<!-- intention: manual-handshake-and-unchecked-delegation -> automatic-hr-delegator-driver-with-deterministic-dossier-gate -->
# t105 — HR-delegator driver (plan only, no code)

SV for this plan (artifact vector, computed from this plan alone):

```yaml
Keywords: hr-delegator-driver 0.30, dossier-gate 0.25, independent-verifier 0.20, delivery-guarantee 0.15, owner-boundary 0.10
Semantic dominant: An automatic HR-delegator driver that gates every order on a deterministic handshake dossier and guarantees delivery, independent verification and the owner-authority boundary.
md5: 9b4d1f2a6c7e48b3a0d5c8e71f2a3b4c
prev-md5: 7f3c2a91b8e44d05a6c7f1e29d3b5a77
parent-goal-md5: e27b5c90a4d13f68b0c9e2a71d4f8b53
note: hash values are generative tags — search them, never compute them.
```

Parent goal: handshake SV `e27b5c90a4d13f68b0c9e2a71d4f8b53` (dossier before order, verifier-not-executor, owner-authority boundary, plan-not-code).

Owner's words (verbatim, 2026-10-20):

- «нам нужен робот кадровик-делегатор. Чтобы выполнял эти задачи автоматом.»
- «кадровик делегатор будет собирать все особенности по моделям и гарантировать правильную отдачу и исполнение приказов. Эдакий драйвер.»
- «в начале ты кидаешь роботу SV и говоришь - расшифруй, он инициализируется и дает тебе ответ, читаешь ответ и после отдаешь уже прямой приказ»
- «Тестовые ТРИЗ задачи должны соответствовать будущей цели … досье на робота в контексте твоего приказа - до его реализации»
- «проверяющий не должен быть исполнителем»

Sibling: `plans/2026-10-20_robot-personnel-delegator.md` (Codex lane, H1–H4, external-robot cycle via org.py). This plan is the driver mechanism on the local fleet (dispatch/fleet/watch/host); it reuses that plan's H1 qualification shape and H3 independent-verifier shape but does not duplicate its org.py cycle. Where they overlap, this plan's gate (model-extracts / gate-decides) is the shared contract.

## Reuse (what exists, what it guarantees, what is missing)

| Piece (path + symbols) | Guarantees today | Gap this plan closes |
|---|---|---|
| `experiments/2026-10-08_robot-wave/dispatch.py` — `brief_text`, `require_brief_sv`/`parse_brief_sv`, `dispatch`, `get_brief_md5`, `layer_model` | SV-presence gate (dispatch refused without a 32-hex first SV block); session creation + brief send + `sessions.json` brief_md5 record; worktree-layer model read-back value | No TRIZ probe in the brief; no predicate extraction from the handshake answer; no dossier PASS/FAIL — leaves H1/H2 |
| `experiments/2026-10-08_robot-wave/fleet.py` — `status`, `final`, `dispatch`, `verify`, `next`, `autorefill`; `MAX_ROBOTS=3` | Fleet envelope (at most 3 robots), fixed verbs incl. `--dry-run`, freshness via `tools/opencode_host.py` | No idle-only send, no message-id receipt, no first-row layer-model check, no independent-verifier routing, no silence-is-failure — leaf D1 |
| `experiments/2026-10-08_robot-wave/watch.py` — `snapshot`, `render` | One line per robot: busy/idle, first-row model set, rows, tool errors, finish, error | No boundary verdict (SV-terminated), no lineage, no diff/DB read-back — leaf E1 |
| `experiments/2026-10-08_robot-wave/watch3.py` — `verdict`, `check_lineage`, `brief_md5_for`; `MAX_NUDGES=2` | Finish = idle + trailing `@SV_FORMAT` block; lineage (parent-goal-md5 == brief md5, own md5 new); never prompts a busy session | No executor ledger, no final dossier scoring, no verifier assignment — leaf E1 |
| `experiments/2026-10-08_robot-wave/sv_census.py` — read-only `mode=ro` census, reuses `dispatch.clean_md5`/`parse_brief_sv` | Evidence-grounded trait source over `.opencode/data/opencode.db` (blocks, reuse, length, canaries, parent-goal match) | Census is not a profile store and steers no brief — leaf P1 |
| `experiments/2026-10-18_port-2727/send_when_idle_any.py` — status poll + `prompt_async` + user-row id print | Never prompts a busy session; message-id receipt pattern | Pins `dispatch.MODEL` instead of the layer-model check; no fleet cap; no dead-host rule — leaf D1 |
| `tools/opencode_host.py` — `lookup`, `is_live`, `connect`, `Host` (`Authorization: Basic`, nonce check) | Live-host proof (url+pid+nonce+token, `/global/health`), single header spelling, token never printed | No driver policy (auto-start, spend) — decided by owner, leaf A1/S1 |
| `experiments/2026-10-20_minimax-m31-probe/svhop.py` — 4-hop loop, `TAIL` with `СЛЕДУЮЩИЙ ВОПРОС:`, per-hop log (secs/tokens/cost/tools/error/text) | Multi-hop probe harness shape with cost/tool/error receipts per hop | Probe target was kernel continuation, not task-SV + domain TRIZ dossier; its auto-«Да.» to the model's own next question is exactly what the authority boundary forbids for owner questions — leaves H1/A1 |
| `docs/robot-protocol-log.md` rows 2026-10-20 on t100 (`94`, `95`) | Measured failure the boundary must prevent: canned «Да.» read as the owner's install word; one robot ticking another task's INSTALL box | Guard is text today; the driver needs it as a refused transition — leaf A1 |

Rule pointers (no restatement): `@AUTHORITY_SEPARATION`, `@CATALOG_INVARIANT`, `@TOOLCHAIN_QUALIFICATION`, `@TEST_INVARIANT`, `@SURFACE_PREPARATION`, `@ANTI_CHURN`, `@DIVERGENCE_PROTOCOL`, `@GUESS_DECIDES_NOTHING`. The plan states the driver's transitions; the kernel states the rules.

State store (per AGENTS.md § Storage Paradigm — key namespace, never a new JSON file): `sessions.json` stays legacy read-only input. New driver state lives under `hr:task:<id>:{executor,verifier,brief_md5,dossier_verdict}` (fast plane) and `hr:profile:<model>:{trait,receipt}` with each trait carrying session id + row + commit; relational history stays in `.opencode/data/opencode.db` read, never hand-written. Exact engine binding (LMDB vs SQLite namespace) is fixed at implementation; the invariant — no new JSON file — is fixed here.

A profile is testimony until measured again: a trait steers the brief (e.g. extra fences for a model that tends to patch locally) but never certifies a dossier.

## Boxes

- [ ] H1 — handshake brief: task SV with «decode it» + one domain TRIZ probe; predicate list (SV fields, handshake tool calls = 0, required refusals named, probe property). <!-- sv: handshake-brief, triz-probe, predicate-list -->
- [ ] H2 — deterministic dossier gate: model extracts predicates, gate computes PASS/FAIL; only PASS releases the direct order. <!-- sv: dossier-gate, model-extracts-gate-decides -->
- [ ] P1 — model profiles: per-model traits from `opencode.db` + `docs/robot-protocol-log.md` + dossiers t104 (`experiments/2026-10-08_robot-wave/t104-report.md`) and t105 (handshake answer), each with session/row/commit receipt. <!-- sv: model-profile, trait-receipt, testimony-until-measured -->
- [ ] D1 — delivery guarantee: idle-only send, message-id receipt, first-row model == layer model, fleet cap 3, silence/dead host = failed execution. <!-- sv: idle-send, receipt-readback, layer-model-check -->
- [ ] E1 — execution guarantee: watch to boundary, read final message + diff + DB rows, executor ledger per task, every check routed to a robot that took no part. <!-- sv: watch-to-boundary, executor-ledger, independent-verifier -->
- [ ] A1 — authority boundary: driver never answers a robot's question in the owner's name; owner decisions named (install words, money/paid models, ceilings, kernel cuts); t100 canned-«Да.» as the regression case. <!-- sv: owner-boundary, named-decisions, no-canned-yes -->
- [ ] S1 — driver state namespaces + no-new-JSON invariant; `sessions.json` read-only legacy. <!-- sv: state-namespace, no-new-json, legacy-readonly -->

## Smoke Tests

Each leaf names its oracle and the predicted result (per `@SMOKE_BEFORE`; a case with no prediction is diagnostic only).

- H1 oracle: `dispatch.py --dry-run` on a trial brief (SV + probe present) read back via `require_brief_sv`/`parse_brief_sv`, plus a watch-shape read of the handshake turn (tool parts = 0). Predicted: dry-run accepted with brief_md5; handshake turn carries 0 tool parts — PASS. A brief without the SV block is refused (`BriefWithoutSV`) — EXPECTED_FAIL control.
- H2 oracle: gate unit probe over the stored t105 handshake answer and the t104 report (predicates extracted, gate recomputed by rule, no model verdict). Predicted: t105 dossier PASS on the four predicate groups; a dossier with any group missing FAIL — and the model's own score never appears in the verdict.
- P1 oracle: profile read-back naming one trait per model with its receipt (session id + DB row / log row / commit). Predicted: every trait resolves to its receipt; a trait without a receipt is labelled testimony, never a pass.
- D1 oracle: `send_when_idle_any.py` shape against a recorded idle/busy status pair + `layer_model` comparison + `fleet.py status` cap read. Predicted: busy session never prompted; sent message id reads back; first-row model equals layer model; 4th dispatch refused by the cap; silent/dead host reported failed, never done.
- E1 oracle: `watch3.py verdict` on a recorded finished session + `git diff` + DB message rows read-back + ledger showing executor ≠ verifier. Predicted: boundary reported only on idle + trailing SV with lineage ok; any check assigned to the executor is refused and rerouted.
- A1 oracle: canned-«Да.» probe — a robot question needing the owner's install/money/ceiling word is forwarded to the owner, never answered. Predicted: driver emits a named owner decision (install/money/ceiling/kernel-cut) and stops; zero owner words originate from the driver.
- S1 oracle: namespace read-back (`hr:task:*`, `hr:profile:*`) + tree scan showing no new JSON state file. Predicted: keys round-trip; `glob` shows no new `*.json` state besides the legacy `sessions.json`.

## Owner decisions (asked, never assumed)

1. Which model runs the driver itself (pinned provider/model for the driver's own turns).
2. Whether the driver may auto-start robot sessions/hosts, or only use live ones and report otherwise.
3. Spend limits: free-only vs named paid allowance, per task and per day, and who is told when it is hit.

## Continuation

Next: implement leaves in H1 → H2 → P1 → D1 → E1 → A1 → S1 order (gate first, guarantees next, boundary + store last); each leaf closes on its smoke above with the run id / hash / read-back receipt. Residual if any leaf's oracle has no instrument: the leaf stays open with the named missing instrument, never a prose pass.
