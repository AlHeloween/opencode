# t135 — 53 unfinished plans: why each is unfinished, what was closed, what is next

Measured 2026-10-22 on `Local_Development`, two robots working the same tree. Every number below is READ from an artefact this task wrote (`experiments_history/2026-10-22_open-plans-triage/`), not typed from memory.

## 0. The measurement (and where the brief's 215 differs from the tree's 211)

**The tree moved under the triage** and the report says so rather than hiding it: the numbers below are the PRE-triage snapshot (53 plans / 211 open boxes), and the tree after t135's own changes and moves reads 51 plans / 218 open boxes — the difference is t135's 9 added boxes and 8 closed ones, PLUS another robot's work in the same tree (a t134 revert that restored five plans' worth of boxes, and a new plan committed by the legislator lane). Both numbers are stated where they are used; neither is a claim about the other.

| census | plans | open `- [ ]` | closed | partial | no checklist at all | no lifecycle | no `## Smoke Tests` | no prior art |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **PRE-triage** (the first `measure.py` run, before any edit) | 53 | 211 | 285 | 14 | 3 | 27 | 9 | 49 |
| **POST-triage** (after t135's edits + the moves) | 51 | 218 | 284 | 14 | 0 | 25 | 9 | 47 |

Both censuses are file-backed: the PRE one in `pre_triage_census.json` (the stdout of the first run, kept because `plan_inventory.json` was regenerated after the moves), the POST one in `plan_inventory.json`. The delegator's brief said **215** open boxes; the tree said **211** — re-grounded, not corrected.

- The three plans that carried NO checklist (their work invisible to the status surface, 0 boxes) were: plans/2026-09-12_anthropic-cache-breakpoints.md — 5 tasks written as HEADINGS (### T1 …), 0 boxes; plans/2026-09-19_database-truth.md — 4 tasks written as BULLETS (- **T1 …**), 0 boxes; plans/2026-10-16_unmanaged-options.md — 0 tasks, scope «INVENTORY + PLAN ONLY» (moved to plans/futures/). Two of them got their boxes back; the third moved to `plans/futures/` with a CONDITION.
- The SVM manifest store holds **82 manifests** over **38 plans** (states: 49 verified / 28 doing / 4 waiting-on-user / 1 legacy `blocked`).

## 1. The table — every plan, its open boxes, its class counts, the action taken

| plan | open | a | b | c | d | e | action |
|---|---:|---:|---:|---:|---:|---:|---|
| `2026-09-30_robot-installer.md` | 18 | 0 | 15 | 3 | 0 | 0 | marked 3 boxes (c) with the owner's quotes |
| `2026-09-29_cua-windows-debug-input.md` | 15 | 0 | 11 | 2 | 0 | 2 | parked 2 boxes (e) with a resumption signal; marked 2 boxes (c) with the owner's quote |
| `2026-10-20_hr-delegator-driver.md` | 15 | 0 | 15 | 0 | 0 | 0 | left open |
| `2026-09-22_reasoning-stream-render-stability.md` | 10 | 0 | 6 | 0 | 2 | 2 | closed 2 boxes (d); split 2 boxes (e) into 4 leaves |
| `2026-10-20_kernel-line-audit.md` | 10 | 1 | 9 | 0 | 0 | 0 | closed 1 box (a) with a fresh measurement |
| `2026-10-21_delegator-memory-repair.md` | 10 | 0 | 10 | 0 | 0 | 0 | left open |
| `2026-10-16_model-chain-failover.md` | 8 | 0 | 8 | 0 | 0 | 0 | left open |
| `2026-10-21_corporation-observability-bridge.md` | 7 | 0 | 5 | 2 | 0 | 0 | marked 2 boxes (c) with the owner's own questions |
| `2026-10-21_portable-delegation-kit.md` | 7 | 0 | 7 | 0 | 0 | 0 | left open |
| `2026-09-21_mstar-order-and-summary-restore.md` | 6 | 0 | 4 | 1 | 1 | 0 | closed 1 box (d); marked 1 box (c) with the owner's quote |
| `2026-10-17_portable-binary-hermetic.md` | 6 | 0 | 6 | 0 | 0 | 0 | left open |
| `2026-10-21_tui-standards-fixes.md` | 6 | 0 | 6 | 0 | 0 | 0 | left open |
| `2026-10-01_tool-description-contracts.md` | 5 | 1 | 0 | 1 | 3 | 0 | closed 4 boxes (1 a + 3 d); marked 1 box (c) with the owner's quote |
| `2026-10-14_kernel-stop-claim-release.md` | 5 | 1 | 4 | 0 | 0 | 0 | closed 1 box (a: first half in the code, second half superseded) |
| `2026-10-14_return-channel-binding.md` | 5 | 0 | 5 | 0 | 0 | 0 | NOT APPLIED — the file is untracked (another robot's lane); classified only |
| `2026-10-15_project-fossil-cell.md` | 5 | 5 | 0 | 0 | 0 | 0 | NOT APPLIED — the file is dirty under another robot's edit; classified only |
| `2026-10-08_mcps-connector-manager.md` | 4 | 0 | 3 | 1 | 0 | 0 | marked 1 box (c) with the owner's quote |
| `2026-10-11_memory-orphan-parts.md` | 4 | 0 | 4 | 0 | 0 | 0 | left open |
| `2026-10-15_dais-peer-trust-reward.md` | 4 | 0 | 3 | 1 | 0 | 0 | left open (D3 is the owner's) |
| `2026-10-18_codex-oauth-empty-error.md` | 4 | 0 | 4 | 0 | 0 | 0 | left open |
| `2026-10-19_codex-robot-event-handoff.md` | 4 | 0 | 4 | 0 | 0 | 0 | NOT APPLIED — the file is untracked (another robot's lane); classified only |
| `2026-09-24_to-be-confirmed-shelf-triage.md` | 3 | 0 | 3 | 0 | 0 | 0 | next actions named for all 3 boxes |
| `2026-09-28_kernel-candidate-incorporation.md` | 3 | 0 | 2 | 1 | 0 | 0 | marked 1 box (c) with the owner's quote |
| `2026-10-07_supersede-between-steps-loses-reply.md` | 3 | 0 | 3 | 0 | 0 | 0 | left open |
| `2026-10-13_recall-read-address-space.md` | 3 | 0 | 2 | 1 | 0 | 0 | marked 1 box (c) with the owner's quote |
| `2026-10-16_message-cleaner.md` | 3 | 0 | 3 | 0 | 0 | 0 | left open |
| `2026-10-16_reasoning-lossless-replay.md` | 3 | 0 | 3 | 0 | 0 | 0 | left open |
| `2026-10-16_zoekt-scip-fossil-sv.md` | 3 | 0 | 3 | 0 | 0 | 0 | NOT APPLIED — the file is dirty under another robot's edit; classified only |
| `2026-10-19_tool-description-contracts.md` | 3 | 0 | 3 | 0 | 0 | 0 | left open |
| `2026-10-20_robot-personnel-delegator.md` | 3 | 0 | 3 | 0 | 0 | 0 | NOT APPLIED — the file is untracked (another robot's lane); classified only |
| `2026-09-30_cua-supply-chain-audit.md` | 2 | 0 | 2 | 0 | 0 | 0 | left open |
| `2026-10-04_files-api-and-tariff.md` | 2 | 0 | 2 | 0 | 0 | 0 | left open |
| `2026-10-10_plan-hygiene-in-build-mode.md` | 2 | 0 | 2 | 0 | 0 | 0 | recorded that SW is half done (the triage ran; the oracle runs did not) |
| `2026-10-16_haiku-omp-controlled-latency.md` | 2 | 0 | 2 | 0 | 0 | 0 | left open |
| `2026-10-20_triz-kernel-correspondence.md` | 2 | 2 | 0 | 0 | 0 | 0 | closed 2 boxes (a) — the plan then moves to plans_completed/ |
| `2026-10-21_fold-hooks-desktop-fork.md` | 2 | 0 | 2 | 0 | 0 | 0 | left open |
| `2026-09-29_codegraph-impact-decoupling.md` | 1 | 0 | 1 | 0 | 0 | 0 | next action named |
| `2026-09-29_h2-session-pool-and-connection-badge.md` | 1 | 0 | 1 | 0 | 0 | 0 | left open (render claim: the glyphs must be SEEN on a rebuilt candidate) |
| `2026-10-08_org-portable-home.md` | 1 | 0 | 0 | 1 | 0 | 0 | marked 1 box (c) with the owner's quote |
| `2026-10-12_specs-inventory-truth.md` | 1 | 0 | 1 | 0 | 0 | 0 | left open |
| `2026-10-15_kernel-undefined-contract-audit.md` | 1 | 0 | 1 | 0 | 0 | 0 | NOT APPLIED — the file is untracked (another robot's lane); classified only |
| `2026-10-15_tui-active-sessions-panel.md` | 1 | 0 | 1 | 0 | 0 | 0 | left open |
| `2026-10-15_web-tui-parity.md` | 1 | 0 | 0 | 1 | 0 | 0 | marked 1 box (c) with the quote |
| `2026-10-16_self-edit-directive.md` | 1 | 0 | 0 | 1 | 0 | 0 | split 1 box into P2a (b, the robot runs) + P2b (c, the owner's default) |
| `2026-10-18_global-recents-constraint.md` | 1 | 0 | 0 | 1 | 0 | 0 | marked 1 box (c) with the owner's quote |
| `2026-10-18_kernel-method-preamble.md` | 1 | 0 | 1 | 0 | 0 | 0 | left open |
| `2026-10-19_edit-description-contract.md` | 1 | 0 | 1 | 0 | 0 | 0 | left open |
| `2026-10-19_undo-broken.md` | 1 | 0 | 0 | 0 | 1 | 0 | closed 1 box (d) and MOVED the plan to plans_completed/ |
| `2026-10-21_delegation-tool-tdz.md` | 1 | 0 | 1 | 0 | 0 | 0 | left open |
| `2026-10-21_robot-pending-stop-hook.md` | 1 | 0 | 1 | 0 | 0 | 0 | left open |
| `2026-09-12_anthropic-cache-breakpoints.md` | 0 | 0 | 0 | 0 | 0 | 0 | 5 boxes ADDED (the tasks were headings — the plan was invisible to planstatus) |
| `2026-09-19_database-truth.md` | 0 | 0 | 0 | 0 | 0 | 0 | 4 boxes ADDED (the tasks were bullets — the plan was invisible to planstatus) |
| `2026-10-16_unmanaged-options.md` | 0 | 0 | 0 | 0 | 0 | 0 | MOVED to plans/futures/ (0 boxes — the deliverable is delivered; the remainder is an owner DECISION, not a task) |
| **TOTAL** | **211** | **10** | **173** | **17** | **7** | **4** | |

Class meanings: **a** = already earned (closed with a receipt) · **b** = robot-finishable (binding + an oracle that could fail) · **c** = owner decision needed (the quote is in the plan) · **d** = superseded / obsolete · **e** = unobservable (split into leaves). `plans/2026-10-16_unmanaged-options.md` had no box at all, so it does not appear in the table; it is the plan-level (d) move below.

## 2. The boxes closed, with their receipts

A box is ticked only with a receipt. Two kinds of receipt appear below: a RUN (a commit, a measurement, a run id) and a SUPERSESSION RECORD (the plan/commit that replaced the work). The second is named as such — it is not a claim that the work happened.

| plan | box | class | receipt |
|---|---|---|---|
| `2026-10-19_undo-broken.md` | T2 | d | commit `b38d45e5ce` + the plan's own S-T1 result (clean pass, H5 falsified) |
| `2026-09-21_mstar-order-and-summary-restore.md` | the memory map | d | `memory/spine.ts:166` + `util/plan-status.ts:501` (parsePlanMap removed 2026-10-01; grep → 2 comment hits, 0 live readers) |
| `2026-09-22_reasoning-stream-render-stability.md` | T4 | d | the plan's own STATUS line (2026-09-24) + the replacing boxes T11a/T13a |
| `2026-09-22_reasoning-stream-render-stability.md` | T7 | d | the box's own supersession line (2026-09-24) + the replacing box T13b |
| `2026-10-01_tool-description-contracts.md` | C2 | a | commit `adedb84375` — the mutation check (one RED at each pin's own address) |
| `2026-10-01_tool-description-contracts.md` | C3 | d | `plans/2026-10-19_tool-description-contracts.md` T10/T11 (the same tools, one commit per tool; `T10-write 805732ed`, `T10-task 8334d3f9`) |
| `2026-10-01_tool-description-contracts.md` | C4 | d | the same plan's landed commits: logsearch `0edc8fc3fa`, universalsearch `ffe50230`, list `671edc13`, recall `aa706817`, glob `fa5c195e`, read `f064047e`, grep `67dc9000` |
| `2026-10-01_tool-description-contracts.md` | C5 | d | the same plan's T10 list + T11's four orphan mappings (with the loading grep) |
| `2026-10-14_kernel-stop-claim-release.md` | M1 | a + d | the first half is in the code (`util/plan-status.ts:790-836`); the second half is superseded by `session/stop-check.ts:152` («A stop claim no longer ends a turn») |
| `2026-10-20_kernel-line-audit.md` | P1 | a | re-measured by t135: 75 630 B, sha256 `8407d4aeb42dc5f2aac8bfb897a25dfcafb58809e0e3adacd01527be043b6114` (the manifest's oracle names the same pin) |
| `2026-10-20_triz-kernel-correspondence.md` | S8 | a | commit `7cb11a686e` (the plan, the 21 glossary entries, the report) |
| `2026-10-20_triz-kernel-correspondence.md` | S9 | a | the `_build.ps1` run of this task (run id in the plan) |

**10 boxes closed as already earned, 7 as superseded/obsolete.** Every one of them was ticked in the plan file itself, in this change — not in a report.

## 3. The plans moved

| from | to | ground |
|---|---|---|
| `plans/2026-10-19_undo-broken.md` | `plans_completed/2026-10-19_undo-broken.md` | its only open box (T2) was vacuous: the condition (T1 reproduces) never held and the crash was falsified (`b38d45e5ce`). A plan with no open box left is a completed plan (AGENTS § Plan Maintenance, JOB FAILED #2). |
| `plans/2026-10-20_triz-kernel-correspondence.md` | `plans_completed/2026-10-20_triz-kernel-correspondence.md` | both open boxes closed with receipts (the commit + the build run). |
| `plans/2026-10-16_unmanaged-options.md` | `plans/futures/2026-10-16_unmanaged-options.md` | class (d): the plan's own leaf scope is «INVENTORY + PLAN ONLY. No product code» and its deliverable IS delivered (the 88-row inventory + the /settings proposal, commit `a36f434dfe`). It has no executable box, and the one open thing it names («A3 owner decision outstanding: which USER rows get surfaced first») is a DECISION, not a task. The owner's rule: «План делается чтобы его сделать, для глобальной разработки есть мастерплан» — direction lives in the master plan and in futures, work lives in a plan. A CONDITION is written into the file: it resumes as a NEW executable plan when the owner names the first rows. |

**Not moved, and why:** `plans/2026-10-15_project-fossil-cell.md` and `plans/2026-10-16_zoekt-scip-fossil-sv.md` are dirty under another robot's edit in this shared tree; t135 classified them and left them alone. The four untracked plans (`2026-10-14_return-channel-binding.md`, `2026-10-15_kernel-undefined-contract-audit.md`, `2026-10-19_codex-robot-event-handoff.md`, `2026-10-20_robot-personnel-delegator.md`) belong to other lanes; they are classified in the table and NOT committed by t135.

## 4. The finish order (class b) — smallest remaining work first

One line per plan: the next box and the oracle that would close it. The delegator dispatches ≤3 robots from this list.

| # | plan | next box | oracle | why here |
|---:|---|---|---|---|
| 1 | `2026-10-12_specs-inventory-truth.md` | S2 | add the `<!-- generated below -->` marker + a renderer that prints counts it computes and MISSING where it cannot | 1 leaf; the renderer is a copy of the pair that already exists (util/plan-status.ts + svm render) |
| 2 | `2026-10-15_tui-active-sessions-panel.md` | S5 | `bun typecheck` from packages/opencode | 1 command; the 10 errors were a peer's in-flight src/session/llm.ts — re-run and the plan closes |
| 3 | `2026-09-29_codegraph-impact-decoupling.md` | C2 | edit a file, read the index stamp at 2 s and at 10 s | 1 measurement; the mechanism half already landed (session/graph-prebuild.ts:55-105) |
| 4 | `2026-10-04_files-api-and-tariff.md` | T3 | a DeepSeek chat with a reused image carries {type:file,file_id} on the wire (raw-wire capture) | 1 capture; the manifest already names the oracle |
| 5 | `2026-09-12_anthropic-cache-breakpoints.md` | T2 | `01_wire_shape.mts` reports `left OUTSIDE any static breakpoint: 0` + `04_sdk_contract.mts` 5/5 + unit cases 1-2 | one line + a guard; the plan's own order puts T2 and T3 first |
| 6 | `2026-09-12_anthropic-cache-breakpoints.md` | T3 | a live session log reports 4 marked messages, not `hasCacheControl: false` | one log line; llm.ts:964-974 |
| 7 | `2026-10-11_memory-orphan-parts.md` | S1 | a part of a deleted session is NOT returned (RED first, then GREEN) | 4 leaves in one file, all in memory.ts; the RED test is the first step |
| 8 | `2026-09-24_to-be-confirmed-shelf-triage.md` | T2 | one `cua get_window_state` capture of the sidebar row on the current stand | the instrument the box names as missing EXISTS now |
| 9 | `2026-10-07_supersede-between-steps-loses-reply.md` | T1 | the new reproducer goes RED (B unanswered or llm.calls < 2) | 3 leaves; the reproducer is the first and it is deterministic |
| 10 | `2026-09-22_reasoning-stream-render-stability.md` | T14 | the control object's identity is pinned across two calls | one pure-function extraction + one identity pin |
| 11 | `2026-10-08_mcps-connector-manager.md` | S8 | the echo-server fixture + the focused greens + `_build.ps1` exit 0 | the local half; the OAuth half waits on the owner's credentials |
| 12 | `2026-10-21_delegation-tool-tdz.md` | T6 | the plan moves with its evidence; `svm render` re-maps the tree; the log row lands | the closure step; every other box of that plan is closed |
| 13 | `2026-10-16_self-edit-directive.md` | P2a | the four robot-run cells (along/across/adversarial/effect), each logging model + prompt hash + output hash | free models only; the A/B cell already has a receipt to extend |
| 14 | `2026-10-20_kernel-line-audit.md` | R1 | 654 lines read by eye; duplicate pairs collected with both quotes | a reading task with a written report (R4) as its deliverable |
| 15 | `2026-10-21_robot-pending-stop-hook.md` | T7 | a `hook_calls.log` row with `state: pending-ask` + a transcript row showing the ask answered | 1 live leg; the mechanism is proven by replay only today |
| 16 | `2026-10-21_fold-hooks-desktop-fork.md` | T7 | the fork row in hook_calls.log + the injected map in the new window | 1 live leg; the replay P1 is the only evidence today |
| 17 | `2026-10-13_recall-read-address-space.md` | R4 | qualify `test/tool/read.test.ts` (today: bytes_written 0, killed by hand) | an unqualified instrument covers nothing — fixing it unblocks R3's claim |
| 18 | `2026-10-16_model-chain-failover.md` | C2 | the classifier test: terminal members called exactly once, transient bounded | the slice the chain needs; each of C1-C8 has its own oracle A1-A8 |
| 19 | `2026-10-16_reasoning-lossless-replay.md` | T9 | a qualified HTTP/3 client + a recorded Alt-Svc / negotiated protocol | research-only; it does not close T3-T7 |
| 20 | `2026-10-21_tui-standards-fixes.md` | B | the footer names the newline keys; the palette finds `agents` | one capture per FAIL kind; A-F are independent |
| 21 | `2026-10-19_tool-description-contracts.md` | T10 | one tool per commit: census, diff, RED, fix, GREEN | the mechanical sweep; 24 tools remain on the list |
| 22 | `2026-10-20_hr-delegator-driver.md` | D2 | the handshake record + the outcome join (coverage >= 80% over 20 handshakes) | the plan says D2 is FIRST to build; the other 14 leaves depend on it |
| 23 | `2026-10-21_delegator-memory-repair.md` | T1 | the replay harness: 5 payloads, baseline 1/5 -> 5/5 | the oracle first; the other 9 leaves ride it |
| 24 | `2026-09-30_robot-installer.md` | B1c | the pinned component list (component, source, include/exclude, license) | the builder is decided; the components list is the next leaf |
| 25 | `2026-10-21_corporation-observability-bridge.md` | B1 | the bridge census: server/port, writers, readers, what is visible today | plan-only research; B3/B4 wait on the owner's two answers |
| 26 | `2026-10-16_message-cleaner.md` | E6 | the log row + `svm render` + the commit + the build receipt | the close; E3/E8 wait on the upstream 429 resume |
| 27 | `2026-09-29_cua-windows-debug-input.md` | T1b | the model-callable route for the proven tier (CDP binding vs an isolated-Chromium tool) | the cheapest tier work; the VMware tier is parked by the owner |
| 28 | `2026-10-17_portable-binary-hermetic.md` | S1 | the fixture test first (RED today, GREEN after S1) | 6 leaves in one file, all in the config/discovery surface |
| 29 | `2026-10-18_codex-oauth-empty-error.md` | S1 | the smoke: authorize with 1455 busy answers with EADDRINUSE/1455, not `{}` | 4 leaves; the smoke lines are already written |
| 30 | `2026-10-08_org-portable-home.md` | S9 **(c) — NOT for the robots** | GATED on the owner's Claude-review verdict — NOT in the finish order | class (c): the lift is the verdict, not a robot's run |

The rule the list obeys, quoted from the plan that asked for it (`plans/2026-10-10_plan-hygiene-in-build-mode.md`, SW): «for each box whose work appears done, find the oracle **named in that plan** → run it TODAY, one file per invocation → tick with the run id → when no open box remains, `git mv` to `plans_completed/` in a commit naming the plan». A robot that runs the named oracle and ticks with the run id finishes a plan in one sitting; a robot that re-derives the oracle writes a new plan, which is how the debt grew.

## 5. The class shares (measured over the 211 open boxes)

| class | boxes | share |
|---|---:|---:|
| a — already earned (closed with a receipt) | 10 | 4.7% |
| b — robot-finishable (binding + an oracle that could fail) | 173 | 82.0% |
| c — owner decision needed (the quote is in the plan) | 17 | 8.1% |
| d — superseded / obsolete | 7 | 3.3% |
| e — unobservable (split into leaves) | 4 | 1.9% |
| **classified** | **211** | 100% |

Plus one plan-level (d): `plans/2026-10-16_unmanaged-options.md` (0 boxes, a direction with a delivered deliverable).

## 6. The planning defect, measured

### 6.1 The four patterns the brief asked for

**Boxes with no oracle** — **99 of 211** (46.9%) name no instrument that could fail, neither inline (no `Oracle:`, no command, no run id) nor in the SVM manifest store. **202 of 211** boxes have no manifest at all (the store holds 9 of the 211 open boxes). **51 of 211** name no concrete path to touch (24.2%), and **34** name neither.

**Plans with no owner** — **21 of 53** plans mention no owner anywhere in their open boxes (no `owner` / `владелец` / an owner decision). Their work belongs to nobody in particular, so nobody picks it up: `2026-09-12_anthropic-cache-breakpoints.md`, `2026-09-19_database-truth.md`, `2026-10-04_files-api-and-tariff.md`, `2026-10-07_supersede-between-steps-loses-reply.md`, `2026-10-08_org-portable-home.md`, `2026-10-12_specs-inventory-truth.md`, `2026-10-15_kernel-undefined-contract-audit.md`, `2026-10-15_project-fossil-cell.md`, `2026-10-15_tui-active-sessions-panel.md`, `2026-10-16_reasoning-lossless-replay.md`, `2026-10-16_unmanaged-options.md`, `2026-10-17_portable-binary-hermetic.md` ….

**Plans opened and abandoned with no continuation receipt** — **30 of 53** plans have open boxes, no manifest for any of them, and no box that names a next step, a resume condition or a residual. @REWARD_FUNCTION calls this class ABANDONED: work that is neither finished nor continued. `2026-09-12_anthropic-cache-breakpoints.md`, `2026-09-19_database-truth.md`, `2026-09-21_mstar-order-and-summary-restore.md`, `2026-09-28_kernel-candidate-incorporation.md`, `2026-09-29_codegraph-impact-decoupling.md`, `2026-09-29_cua-windows-debug-input.md`, `2026-09-30_cua-supply-chain-audit.md`, `2026-09-30_robot-installer.md`, `2026-10-07_supersede-between-steps-loses-reply.md`, `2026-10-08_org-portable-home.md`, `2026-10-10_plan-hygiene-in-build-mode.md`, `2026-10-11_memory-orphan-parts.md` ….

**Plans that duplicate each other** — 1 title pairs share their subject mechanically: `2026-10-01_tool-description-contracts.md` / `2026-10-19_tool-description-contracts.md` (contracts, description, tool).

And the overlaps the title tokens miss — the same subject split across two plans, which is how one piece of work loses its receipt and becomes two half-plans:

| subject | the plans | why it matters |
|---|---|---|
| tool descriptions | `2026-10-01_tool-description-contracts.md`, `2026-10-19_tool-description-contracts.md`, `2026-10-19_edit-description-contract.md` | the 2026-10-01 plan and the 2026-10-19 plan are the SAME contract work in two files; t135 closed the older one's boxes as superseded BY the newer one — the duplicate is why the debt existed twice |
| the delegator lane | `2026-10-20_hr-delegator-driver.md`, `2026-10-20_robot-personnel-delegator.md`, `2026-10-21_delegator-memory-repair.md`, `2026-10-21_delegation-tool-tdz.md` | four plans, one lane; the overlap is in the delegation cycle (dispatch, receipt, verification) |
| the org layer | `2026-10-08_org-portable-home.md`, `2026-10-14_return-channel-binding.md`, `2026-10-15_dais-peer-trust-reward.md`, `2026-10-21_corporation-observability-bridge.md` | one organisation, four plans; the observability bridge's B5 depends on the personnel delegator's H2 |
| the fold / memory restore | `2026-10-21_fold-hooks-desktop-fork.md`, `2026-10-21_delegator-memory-repair.md` | T7/T8 (the live legs) and T2-T5 (the restore code) are two halves of one work — the fold hooks plan names the other plan as its precedent |
| plan hygiene | `2026-10-10_plan-hygiene-in-build-mode.md`, `2026-09-24_to-be-confirmed-shelf-triage.md`, `2026-10-11_memory-orphan-parts.md` | the mechanism, the shelf sweep and the sweep's own plan — the SW box and the T3 box are the same sweep |
| the index / corpus | `2026-09-29_codegraph-impact-decoupling.md`, `2026-10-16_zoekt-scip-fossil-sv.md`, `2026-10-12_specs-inventory-truth.md` | one corpus, three surfaces (the sync, the corpus reader, the generated inventory) |
| cua | `2026-09-29_cua-windows-debug-input.md`, `2026-09-30_cua-supply-chain-audit.md` | the driver and its supply chain; the audit plan's SE box collects classes FROM the driver plan's W3 run |

### 6.2 The mechanism that would have stopped the biggest class

The biggest class is (b) — 172 boxes that are EXECUTABLE but were never started — and its cause is visible in the numbers above: **a box can be written with no binding and no oracle, and nothing at write time says so.** The mechanism is therefore not «write better plans», it is a gate that REFUSES the commit which would add one.

**THE PLAN ADMISSION GATE.** One predicate, evaluated per OPEN box of every plan entering `plans/`:

1. **BINDING** — the box (or the lines that follow it, up to the next box) names a concrete path or path:line. A box that says «make the plan hygiene better» names nothing to touch.
2. **ORACLE** — either the SVM manifest store holds a record for that task with a non-empty `oracle` (the store's own field, `session/svm.ts:55`), or the box states an instrument inline (`Oracle:`, a predicted result, a command, a run id).
3. **THE PLAN** carries a `## Smoke Tests` section or says `smoke: N/A`.

**Where it lives (this is what makes it a mechanism and not a rule):** `scripts/commit_own.py` is already the ONLY way a plan enters this tree (t66: the private-index commit route). The gate is a pre-commit predicate there, beside the existing shared-file guard: a commit that adds a plan whose boxes are not executable is REFUSED, and the offending boxes are NAMED in the refusal. A rule would be prose nobody can fail; this is a check that can.

**The reuse it rests on:** the oracle carrier already exists — the SVM manifest store, with its per-task `oracle` field and `svm render`'s own `MISSING` counters (`missingTaskSv`, `missingManifests`). The gate does not invent an oracle registry; it REQUIRES one of the two carriers the repo already has.

**The fail-proof** (`fail_proof.py`, fixtures under `fixtures/`):

| fixture | expected | got | why it matters |
|---|---|---|---|
| `admissible/2026-01-01_admissible.md` | PASS | PASS | binding + inline oracle + a smoke section |
| `admissible/2026-01-02_inline_oracle_no_manifest.md` | PASS | PASS | the gate measures the PLAN, not the store: no manifest exists for it |
| `admissible/2026-01-06_manifest_oracle.md` | PASS | PASS | the oracle lives ONLY in the manifest store |
| `refused/2026-01-03_unbound.md` | REFUSE | REFUSE | the shape that produced the 211-box debt: no binding, no oracle |
| `refused/2026-01-05_no_smoke.md` | REFUSE | REFUSE | executable boxes, but the plan names no smoke |

All five cases met their expectation (the run's own last line: «every case met its expectation»). A gate that cannot fail is not a gate; the two REFUSE cases are what make the three PASS cases mean something.

**What it would have caught here, measured on the tree t135 left** (`plan_admission.py plans`, re-run after the moves): **114 of 218 open boxes (52.3%) in 34 of 51 plans would be refused** — the gate's share of the CURRENT debt, measured by the same code that runs the fixture.

**Why that number is bigger than the 99 of §6.1** (and both are true): §6.1 counts ONE defect (no oracle) over the 211 boxes as they stood BEFORE t135; the gate counts THREE (no oracle, no binding, no smoke section) over the 218 boxes AFTER t135's edits and the moves, and t135's own notes added oracles to some boxes while the two previously invisible plans added 9 more. The two numbers measure different things — one defect, one gate — and the gate's share is the one that matters for the mechanism: it is the share of boxes that could not have been executed by a robot as written.

**What it would NOT catch, named honestly:** the gate cannot tell a (b) box from a (c) box — a box that waits for the owner looks exactly like a box that waits for a robot. The owner-decision class is caught by the QUOTE, not by a predicate, and it is caught by a reader (t135) rather than by a check. That is the boundary of this mechanism.

## 7. What was NOT done, and why

- **No product code was touched** — the brief's rule. The mechanism is a CANDIDATE in `experiments/`, with its fixture and its fail-proof; wiring it into `scripts/commit_own.py` is a separate, authorized change.
- **The three plans that were invisible to the status surface were given boxes, not closed** — `2026-09-12_anthropic-cache-breakpoints.md` (5 tasks written as HEADINGS), `2026-09-19_database-truth.md` (4 tasks written as BULLETS), and `2026-10-16_unmanaged-options.md` (0 tasks; moved to futures with a CONDITION). Their work was never missing — it was unmeasurable.
- **`plans/2026-10-15_project-fossil-cell.md` and `plans/2026-10-16_zoekt-scip-fossil-sv.md` were NOT edited** — another robot owns them in this tree. Their 5 + 3 boxes are classified (5 x (a), 3 x (b)) but not applied.
- **The 4 untracked plans were NOT committed** — they are other lanes' uncommitted work.

## 8. The artefacts this task wrote

| file | what it is |
|---|---|
| `measure.py` | the census: per plan, its boxes, its smoke/prior-art/lifecycle, its git history (mirrors `util/plan-status.ts`) |
| `box_context.py` | the text of every open box + the lines that follow it + the manifest state — the evidence the class rests on |
| `manifests.py` | the SVM manifest store, read through the store's own mapping |
| `decisions.json` | the per-box class, one entry per plan (the decision, not the measurement) |
| `plan_admission.py` | the candidate mechanism |
| `fail_proof.py` + `fixtures/` | the fail-proof and its five cases |
| `make_report.py` | this report, generated from the artefacts above |
| `plan_inventory.json`, `open_boxes.md`, `box_context.json`, `manifests.json` | the raw measurements |
| `pre_triage_census.json` | the PRE-triage census (53/211/285/14/3/27/9/49), kept because `plan_inventory.json` was regenerated post-move |
| `plan_link.py` + `fail_proof_link.py` + `fixtures/link/` | the master-goal LINK check + its 3-case fail-proof |
| `box_stale.py` + `fail_proof_stale.py` + `fixtures/stale/` | the STALE-box check + its 2-case fail-proof |

## Addendum 2 (2026-10-22) — no foreign lane; six plans applied; link + stale mechanisms

**Correction first:** the t135 closing message said «5 untracked + 2 dirty» — wrong on both counts. It is **4 untracked + 2 dirty = 6 plans** (the report's own table §1 and §7 already say four untracked; the message miscounted). Fixed here, not hidden.

### A2.1 The six plans (one writer per file, proven)

- **Dirty files, no live writer:** `plans/2026-10-15_project-fossil-cell.md` (mtime 2026-10-15 09:06Z) and `plans/2026-10-16_zoekt-scip-fossil-sv.md` (mtime 2026-10-20 12:41Z) carried uncommitted edits with no staged work and no recent writer. Receipt: `git diff --stat` (3 lines / +124 lines), mtimes above, `git status` showing only these two among the tree's dirty files as this task's. Committed first EXACTLY as authored (commit `b1ed6e73`, message names the provenance: fossil-cell ticket line DECIDED + zoekt M0b dispatch/knowledge continuation); triage landed in separate commits on top (one-writer rule held).
- **Fossil-cell: closed 5/5 (a), moved to `plans_completed/`.** B1's verdict IS the plan (## B1 verdict, measured + read from code); the four Gate boxes are satisfied by the plan's own smoke section + the three phase commits (`cb89516ada` 6/6, `312b650d30` 4/4+20/20, `44f06b192c` 5/5+15/15). Receipts in the plan lines. Commit `881f77c1`.
- **Zoekt: 3/3 (b), stays in `plans/`.** M0b/Z4/Z5 each carry binding + oracle; the t135 note names the next step (the reproducible reader on the named corpus; the partial `20261016T104235Z_3fe9d41d` baseline is the start, not the close). Classified in t135, applied now — no box was closable without inventing a receipt.
- **Four untracked, tracked in the same change as their triage** (commit `881f77c1`): `2026-10-14_return-channel-binding.md` (5x b, T1 first), `2026-10-15_kernel-undefined-contract-audit.md` (A2 b — the independent read-back IS done, `parent-review.md` 9/9 + 8 rows, the archive/commit half is next), `2026-10-19_codex-robot-event-handoff.md` (4x b, E1/E2 first), `2026-10-20_robot-personnel-delegator.md` (H2–H4 b, H1 stays [~]). No box closed without a receipt; every box's binding + oracle is quoted in its t135 note.

### A2.2 The five plans→completed moves

- **Landed as renames (4):** `2026-10-17_host-fastfail-grep` (`fc` identical, 5/5 closed), `2026-10-17_sv-lineage-mechanism` (identical, 5/5), `2026-10-18_write-returns-addresses` (identical, 5/5), `2026-10-19_graph-first-reminder` (identical, 4/4). Each verified by `git show HEAD:plans/<f>` + `fc` against `plans_completed/<f>` → «no differences encountered», every box `[x]` with its artefact. Commit `881f77c1`.
- **NOT landed, owner decision (1):** `2026-10-18_delegation-port-2727`. HEAD carries t92 (base 29200 in 29170–29998, T1–T5 closed); `plans_completed/` holds the older t91 (2727, T1–T4 closed) plus an untracked `*_2727_1.md` (also 29200, 55 lines). The move is earned in BOTH versions (all boxes closed), but they are DIFFERENT contents — landing either as «the rename» would silently drop the other. **Decision for the owner:** which completed content is canonical — the HEAD t92 (29200 + NEVER_BIND_PORTS + T5) or the archived t91 (2727)? Until named, `plans/2026-10-18_delegation-port-2727.md` stays DELETED in the tree and both completed copies stay untracked; nothing of this lane was committed by t135.

### A2.3 A plan outside the master plan is reported, not executed

- **Mechanism:** `plan_link.py` — one predicate per plan file (the plan's own SV must carry a non-zero `parent-goal-md5`). Refuses with the unlinked plans NAMED. Lives beside `plan_admission.py` in the same commit route. **Fail-proof 3/3** (`fail_proof_link.py`): linked PASS, zeros REFUSE, no-SV REFUSE — «every case met its expectation».
- **Measured on the live tree:** `plan_link.py plans` → **34 of 50 plans UNLINKED** (the 16 linked carry real parent md5s; the rest carry zeros or no SV block). The gate is loud by design — this is the current debt, not a verdict on any one plan.
- **History search (nothing settles it):** `messagesearch` for goal/md5/master (no settling discussion — only the 2026-09-30 note itself asking «почему у goal нету семантического вектора», which gave the goal keywords + dominant but no md5); `grep` over `plans/` + `docs/` (only `docs/ADID_Framework_15_4.md:100,353` defining parent-goal-md5 as «the md5 of the goal vector», no master-goal md5 value).
- **Scope honestly stated:** no open box carries a pin today (the format is new) — so the check reports NO-PIN everywhere on the live tree and refuses nothing. Pinning the 200+ open boxes is the next pass, not this one; the mechanism + its proof are what this task delivers.
### A2.4 A stale box is reported, never executed blind

- **Mechanism:** `box_stale.py` — one predicate per open box carrying `<!-- pin: <repo-relative path> <sha256> -->` (the file as it was when the box was written): NO-PIN / FRESH / STALE (missing or hash differs, both hashes named). A dispatcher that reads it refuses to execute a STALE box as written — STALE dispatches only as re-grounding. **Fail-proof 2/2** (`fail_proof_stale.py`): the same box FRESH when the code is unchanged, STALE when it has drifted — «every case met its expectation».
- **Scope honestly stated:** no open box carries a pin today (the format is new) — so the check reports NO-PIN everywhere on the live tree and refuses nothing. Pinning the 200+ open boxes is the next pass, not this one; the mechanism + its proof are what this task delivers.

## Review 1 (2026-10-22, delegator check of `4d550c58`) — four findings, all closed

- **Fossil-cell was two copies in HEAD with only a staged D.** Landed the deletion in a commit that names it (`be0d5c45`): `git ls-tree HEAD` now shows `plans_completed/2026-10-15_project-fossil-cell.md` exactly once, `git diff --cached` is empty for both paths. ✓ (receipt: the two commands' outputs, empty diff + single ls-tree row)
- **Delegation-port was an owner decision, not a question.** Owner 2026-10-18 verbatim «29200 очень хорошо» (`60a3d22e:6584`); 2727 is IANA `mgcp-callagent` (dropped). Canonical = HEAD t92 (blob `763f5d67`; `*_2727_1.md` was byte-identical, removed as duplicate after the `fc` diff). Landed in `09c6f177` (plans/ deleted, completed/ = t92 + 1 merged t91-only line with provenance: the owner's live host on 4096). The t91-only hunks are otherwise all 2727-behavior superseded by the owner's choice — each named in the commit message, none silently dropped. ✓ (receipts: `git hash-object` + `git rev-parse` equal hashes, `fc` full hunk list, single ls-tree row)
- **Three stray `plans_completed/` files, no exception for untracked.** `2026-10-14_claude-desktop-compact-handoff.md` (S1–S4 all `[x]` with fixture/oracle receipts) and `2026-10-14_cross-handoff-delivery.md` (T1–T5 all `[x]`, state COMPLETE, run ids in the boxes) are earned completions never tracked — tracked in the review commit below. Neither duplicates a tracked plan (`git ls-files` shows no same-named tracked file); neither was moved without being earned (both fully ticked with artefacts). `*_2727_1.md` handled above. ✓ (receipt: per-box `[x]` + oracle lines in each file, `git ls-files` absence)
- **SV form + lineage.** The t135-addendum-2 closing block broke form (patterned md5, 33-char prev-md5) and carried the addendum md5 as parent. Correct rule (reviewer, also the SV-format invariant): on every turn of THIS task parent-goal-md5 stays the t135 brief md5 `ba748a084f9443aa9d39189641c4f9c4`; each vector carries a fresh 32-hex md5 and the previous own 32-hex md5. The closing block below obeys it. An addendum/nudge never changes the parent — it has its own md5/prev-md5 chain. ✓ (receipt: character counts 32/32/32 in the block)
