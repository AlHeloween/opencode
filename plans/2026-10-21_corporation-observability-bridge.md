<!-- intention: fossil bridges in every tree stay silent about live robots -> one observable process with a panel for owner and agents, where each robot server finds its tree bridge and reports state, giving a whole-corporation summary -->
<!-- workflow: lifecycle ACTIVE -->
<!-- goal_sv: Keywords: fossil-bridge-per-tree 0.25, corporation-summary-panel 0.25, robot-server-autoconnect 0.20, observable-processes 0.15, scheduler-on-fossil 0.15
Semantic dominant: Ground what exists of the fossil bridges, then design one observable process with a panel that both the owner and agents use, where every robot server reports its state into it.
md5: 7c2e9a4b5d6f48e0a1b2c3d4e5f6a7b8
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
-->
<!-- subgoal: s1-delegation-org-protocol — proposed subgoal awaiting the owner's decision; see experiments_history/2026-10-22_subgoal-proposals/PROPOSALS.md §S1 -->

# t125 — corporation observability bridge (plan only, no code)

Owner, 2026-10-21, verbatim: «По планировщику у нас есть фоссил мост и фоссил мосты в каждом дереве вообще надо бы с вики это тоже есть в предыдущей памяти, надо сделать процесс который с этим работает и у которого есть панель доступная и пользователю и агентам чтобы эти процессы были observable, в коде сервера самого робота должен быть код который засекает этот мост и к нему коннектится чтобы передать состояние тогда мы получим полную сводку по корпорации в целом.»

Research: `experiments/2026-10-21_corporation-bridge-research/REPORT.md` (read before planning; do not re-derive). This task is the observability and state half of t122 (`plans/futures/2026-10-21_autonomous-session-scheduler.md` + `experiments/2026-10-21_session-scheduler-research/REPORT.md` option C `run_spec`).

## Design (chosen, from REPORT §3-5)

- Bridge: well-known path `<worktree>/.opencode/data/fossil/<id>/snapshot.fsl` (primary) + env overrides (`ORG_HOME/ORG_PORT/FOSSIL` pattern); registry only for federation reads. Push at TURN granularity (cellPost fork + `heartbeat --what`), never per command. Bridge-absent fails visibly (NAMED zero + STALLED), never silent.
- State: no new tables/files — org ticket lease fields for liveness (`heartbeat_at/lease_until/agent_state`), cell chat technotes for turn reports, org technotes for verdicts, wiki card pointers only. Host facts from `server_host` + `/global/health` nonce echo + `/session/status`; task/brief md5 from the delegator (host never invents it). KV-cache impact: none — no file under `src/session/system.ts/prompt.ts` is touched.
- Panel: B (org `Corporation` wiki/reportfmt summary, same verbs for owner and robots) as the summary + A (fossil web UI) as drill-down; C (TUI) deferred. Scheduler: t122-A chain scheduled→READY→WORKING→DONE→VERIFIED with receipts + MISSED rows; t122-C `run_spec` as follow-up.

## Boxes

- [ ] B1 — bridge census: for org.fossil AND each real tree's cell record server/port, writers, readers, what is visible today, what is missing. `std: none found — no OTel convention for agent session state (OTel system/process-metrics covers process.cpu/memory/uptime only, Development status; fetched content_hash fa816e7b…/121df34a…); ISO 25010 snippets only (Guess, no fetched primary) — receipts in REPORT §7.` <!-- sv: bridge-census, writers-readers, visible-today -->
- [ ] B2 — state schema + route map: session/task-md5/model/busy/last-SV/error/host-heartbeat each mapped to its host source (path:line) and its cheapest fossil route (chat line / ticket field / technote / wiki card); storage-paradigm note (no new JSON). `std: none found — OTel has no heartbeat/state convention for sessions (same receipts); lease/heartbeat reuse instead of a new metric.` <!-- sv: state-schema, cheapest-route, no-new-table -->
- [ ] B3 — auto-connect design: well-known path primary + env overrides + registry-for-reads-only; push seams (turn-end cellPost fork, claim/inbox, escalate, HOST-DOWN record); visible-failure contract (NAMED zero + log_once + STALLED); code surfaces with path:line; KV-cache: none. `std: none found — discovery by well-known path + env follows orgcfg.py ORG_HOME/ORG_PORT/FOSSIL (project convention, not an external standard).` <!-- sv: autoconnect, well-known-path, visible-failure -->
- [ ] B4 — panel design: A/B/C compared with cost, oracle (capture predicting known-state rows), and robot-read route (same verbs or not); B chosen as summary, A as drill-down, C deferred. `std: none found — ISO 25010 observability qualities by snippet only (no primary fetched); panel contract is project verbs (org.py inbox --json, fossilcell), not a standard widget.` <!-- sv: panel-compare, same-verbs, oracle-per-option -->
  **t135 (2026-10-22): B3 and B4 are class (c) — owner decisions, quoted from this plan's own «Owner decisions (asked, never assumed)»:** «1. Panel surface: B (org summary page + drill-down fossil UI) as proposed, or A-only, or C (TUI) instead?» and «2. Push granularity: turn-end + heartbeat as proposed (lease 600 s), or finer (per message/tool) despite the Granularity rule?». A panel design without the surface it designs is a design of the wrong thing, so these two boxes wait for the two answers. The decided part is (b) and runs FIRST — B1 census, B2 route map, B5 scheduler plug, B6 failure-visibility rows, B7 panel oracle — and its receipts are what the answers are read against. Questions 3–5 (org write rights, per-tree `fossil server/ui`, the t122 tie-in) gate B5's write path and are quoted in the plan below.
- [ ] B5 — scheduler plug: t122-A fires write START + lock-guarded dispatch + VERIFIED receipts so the panel shows scheduled→verified; MISSED rows close the R7 gap; t122-C run_spec as named follow-up with its presence-gating limit. `std: none found — catch-up/overlap semantics follow the t122 prior-art receipts (Task Scheduler IGNORE_NEW, Temporal Overlap Skip), not a new standard.` <!-- sv: scheduler-plug, scheduled-to-verified, missed-rows -->
- [ ] B6 — failure-visibility check: double dispatch, watcher-blindness, ADID-no-host, host-restart-abort classes each named with the panel row that would have shown them (13:53 instance recorded Unknown with its search receipt). `std: none found — failure rows are project verdicts (watching() STALLED, STALE host, Skip row), not standard codes.` <!-- sv: failure-visibility, stalled-not-silent, unknown-recorded -->
- [ ] B7 — fresh-panel oracle design (no build in this plan): fixture org + two fixture cells with known READY/WORKING/STALLED tickets → predicted panel rows before the run; mismatch = FAIL. `std: none found — oracle is a project capture with a prediction (@SMOKE_BEFORE), not a standard conformance test.` <!-- sv: panel-oracle, prediction-first, fixture-corporation -->

## Smoke Tests (predictions before runs; plan-only — no runs in this task)

- S1 census oracle: `fossil all list` re-run with the t120 rule + `org.py inbox --json --no-presence` read-back. Predicted: 31 real / rest scratch-test-artefact (or the delta names the moved row); org web UI on 8079 answers; per-tree cells answer only local `-R` reads (no per-tree server). Mismatch = forecast error, stop.
- S2 route oracle: dry read of `/global/health` (nonce echo), `/session/status` shape, one `fossilcell list` + `chat` on the OWN cell. Predicted: health answers `{healthy,version,host:nonce}`; status lists sessions with busy flags; cell list names this project; no writes performed. Any write = FAIL of this plan's envelope.
- S3 panel oracle (design): fixture corporation (scratch ORG_HOME + two scratch cells, never live) with one READY, one WORKING-past-lease, one cross-repo owner-gated ticket. Predicted panel rows BEFORE the run: READY row, STALLED(lease) row, owner-gated row marked NOT dispatchable. A dispatchable mark on the gated row, or a silent missing row, = FAIL.

## Owner decisions (asked, never assumed)

1. Panel surface: B (org summary page + drill-down fossil UI) as proposed, or A-only, or C (TUI) instead?
2. Push granularity: turn-end + heartbeat as proposed (lease 600 s), or finer (per message/tool) despite the Granularity rule?
3. May robots write to org.fossil directly (heartbeat/escalate via org.py verbs as designed), or only to their own cell with the delegator relaying into org?
4. Per-tree `fossil server/ui` instances: approve (N ports, registered in `docs/ports.md` first) or keep per-tree bridges local-read-only with org as the only served UI?
5. t122 tie-in: MISSED rows + owner-gated marking ride this bridge plan, or wait for the scheduler plan's own activation?

## Continuation

Next: implement leaves in B1 → B2 → B3 → B4 → B5 → B6 → B7 order (census and schema first, design on top, oracle last); each leaf closes on its smoke above with the run id / hash / read-back receipt. Residual if any leaf's oracle has no instrument: the leaf stays open with the named missing instrument, never a prose pass.
