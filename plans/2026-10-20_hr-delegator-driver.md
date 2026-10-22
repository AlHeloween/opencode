<!-- intention: manual-handshake-and-unchecked-delegation -> automatic-hr-delegator-driver-with-deterministic-dossier-gate -->
<!-- workflow: lifecycle ACTIVE -->
# t105 — HR-delegator driver (plan only, no code)

<!-- goal_sv: Keywords: hr-delegator-driver 0.30, dossier-gate 0.25, independent-verifier 0.20, delivery-guarantee 0.15, owner-boundary 0.10
Semantic dominant: An automatic HR-delegator driver that gates every order on a deterministic handshake dossier and guarantees delivery, independent verification and the owner-authority boundary.
md5: 9b4d1f2a6c7e48b3a0d5c8e71f2a3b4c
prev-md5: 7f3c2a91b8e44d05a6c7f1e29d3b5a77
parent-goal-md5: 221e9347f99b038b669b74d80886fca1
note: hash values are generative tags — search them, never compute them.
-->

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

## Assumptions are first-class (addendum 1, owner 2026-10-20)

Owner, verbatim: «ходы не были прописаны, модель делает подразумевая, и не говорит почему, часто это ок, но часто понять причины реально невозможно и может получиться не ок из за подразумеваний, а мы их оценим как косяк, а по сути это просто assumptions откуда-то взявшиеся.»

- Every brief the driver sends, every handshake decode and every robot report carries an explicit ASSUMPTIONS list: each item names what was taken as given and from where (brief line, rule tag, model prior, other).
- The handshake gate extracts that list as a predicate source: an assumption contradicting the order is fixed in the brief BEFORE the order goes out, never punished after.
- Attribution before any verdict: brief gap (an unwritten move — ours) | model assumption (a prior — goes into the model profile with its source) | defect (a stated rule broken). Reference case: t100 acted on the unstated «receivers lag the render → reinstall» (`docs/robot-protocol-log.md`, 2026-10-20 rows).

## Failure analyst — second role (addendum 2, owner 2026-10-20)

Owner, verbatim: «для сбоев моделей - отдельный робот который будет сотрудничать с кадровиком-делегатором, его задача анализировать сбои и предлагать решения, когда соберет достаточно информации.»

- Separate robot, separate session: neither the driver nor any executor of the work it analyses; analyst independence follows the same rule as verifier independence (per `@AUTHORITY_SEPARATION`).
- Inputs it owns reading: `docs/robot-protocol-log.md`, the driver's dossiers and executor ledger, model profiles, robot session history in `.opencode/data/opencode.db` (read-only). The driver hands it every failure with its receipts; the analyst writes back only into model profiles (trait + receipt), never into the work or a dossier verdict.
- Attribution first on every failure (brief gap | hidden model assumption + source | defect). «Enough information» is the declared threshold (owner decision 4); below it the analyst only records.
- Proposes, never applies: each proposal names the mechanism (a check, a gate, a brief field) before any text rule — mechanism first, kernel text only if no mechanism can carry it; each proposal carries its reproducer, the predicted effect and the oracle that would show it worked. Proposals go to the Legislator; kernel and owner-decision items go on to the owner.

## Dossier as predictive dataset (addendum 3, owner 2026-10-20)

Owner, verbatim: «сложности в декодировании SV и решении Триз задач автоматически перенесутся на результат - это очевидно. Если кадровик-делегатор это будет собирать данные по этой теме то эти данные по сути бесценны для нашей работы.»

- Every handshake is a record, kept forever, keyed by task id + CONFIGURATION (model id + variant/quantization, sampling settings, kernel receiver sha256, binary version + tool set, context class: fresh session / after N folds / resident): task SV md5, robot session, extracted predicates (decode fields, missed refusals, hidden assumptions found, TRIZ probe property met / not met, handshake tool calls), gate verdict. Two configurations are two passports even on one model.
- The outcome is joined to it later by the same task id: verifier's verdict, attributed failures (addendum-1 classes), fix rounds, owner interventions.
- The predictive claim is measured, never asserted: over N recorded orders (owner decision 5; proposed default N=30, per-configuration slices below 10 reported not claimed) the driver reports which handshake predicates precede which failure class. Until N is reached the claim stays Hypothetical (per `@GUESS_DECIDES_NOTHING`).
- This dataset is the shared input of the driver (robot/model choice, brief fences), the failure analyst (patterns), and the SV benchmark in `plans/futures/2026-10-20_sv-benchmark-dais-candidates.md` — tracks 1 (decode), 2 (provenance), 3 (kernel adherence), 4 (TRIZ closed-book). The link is named here; the benchmark plan itself is not duplicated.
- Concept source: the organization's document owns the prose — org Charter (wiki `Charter`: ст.2 wiki row «Устав, паспорт, постоянные правила…», ст.5 кадровое рассмотрение) by name/path. TODO link: the GPT-lane «паспорт применимости» page is not in the wiki yet (11 pages listed 2026-10-20, no passport page), so the owner quote of addendum 4 stands in until it lands — no second copy is written here.
- Store per AGENTS.md § Storage Paradigm: relational history → SQLite namespace (e.g. `hr_dataset_handshake` + `hr_dataset_outcome` keyed by task id + configuration); no new JSON file.
## Backtest t117: the dataset does not exist yet (measured 2026-10-21)

Independent robot (MiniMax, t117) tested the owner's claim «с помощью декодирования SV и тестов по ТРИЗ мы можем предсказать заранее - справится модель с задачей или нет» on the fleet's own history. Reports — read whole, not restated here (re-hash before citing; the files may grow):
- `experiments/2026-10-21_member-as-instrument/REPORT.md` sha256 `9b87002c2f3bea5699bb9eaefa9ba292ad7cf44f0d5f2cb7d7cb4592c8070526`
- `experiments/2026-10-21_member-as-instrument/REPORT_addendum1.md` sha256 `02ad1e43ee09c2c613c50d5b477c66d03af59d8400bd7dd57e9a71f6b085fb53`

Measured (labels checked by Claude):
- Passport vs model name: a tie at every cut and label set (same-subset 2-2, 1-1, 1-1; zero unique-detection cases either way). The passport never caught a case the model name missed — and never lost one either.
- Decode score: no discrimination (identical verdicts with the baseline on all 4 comparable tasks, 1/4 hits each; three well-formed decodes — t105, t107, t114-queue-next-judge — preceded unaccepted tasks). The addendum's «leaning refuted» counted OPEN tasks as failures (this t105 plan among them) and is being corrected — an open task is not a failed task.
- Why nothing can be decided: outcomes on record for 6 of 19 later handshakes (32%) and 13 of 28 later tasks; the BEFORE side holds one handshake; the charter's configuration key recurs for 2 of 28 later tasks.
- Unfalsifiable as written: kernel sha256, tool set, context class, and SV decode / TRIZ probe have NO data source anywhere in the store. STALE is stated but no mechanism refuses a stale passport.
- N to decide: ~30-40 scored handshakes with an outcome on ≥80% of them (McNemar, α=0.05, power 0.8 — the addendum's estimate, §3.4, not a new constant).

Consequence for this plan: D2 (record from the next order) and the STALE refusal are the first leaves to build; D3 stays Hypothetical with the measured N above as its bar.

## Review rule: understandability before verification (addendum 8, owner 2026-10-21)

Owner, verbatim: «Важно чтобы действия членов организации, были понятны другим членам организации.» «Пусть креативят абы по протоколу, доказано и обьяснением целей, чтобы остальные участники могли понять и использовать.» «у нас есть кернел и цифровое намерение - модели им следуют. Все норма пока следуют, если не следуют то это уже надо разбирать.» «С чем борется кернел - с приписками, липовыми отчетами и еблей мозга операторам при несделанной задаче.» «креатив не трогаем для нас это не баг.»

- The E1 and F1 review rule: padding, a fake report and an operator runaround at an undone task are defects, as before. Creativity is welcome on these terms — in protocol, proven, and explaining its goal so other members can understand and use it («креатив не трогаем для нас это не баг»).
- Charter note: `docs/organization-charter.md` needs this principle, but it carries another lane's uncommitted changes (modified in this worktree, verified 2026-10-21) — the edit belongs to that lane, not to this plan. No charter prose is written here.
## Boxes

I1 runs once per configuration (and again when it goes STALE); H1 runs before every order. The internship set is a qualification fixture, not a leaderboard. It never ranks models against each other publicly. It admits or withholds a configuration for task classes, and every result enters that configuration's passport with its receipts. A public benchmark is one aspect with one leaking dataset — a degenerate simplex. The internship is one of three aspects of admission. The other two are the configuration record (mechanism) and the later outcome ledger (execution), which together are the 3×3 wired into P1/D2.

- [ ] I1 — internship (admission, once per configuration + on STALE): FIXED calibrated set — SV decode (futures benchmark track 1: recall, invention, honesty, drift over hops; calibration `experiments_history/2026-10-19_kernel-portability-chat/` and `experiments/2026-10-20_sv-axis-falsifier/` arms A 0/4 / C 2/4 / B 4/4, glossary load-bearing — state whether the internship gives the glossary, it is part of the configuration) + trivial TRIZ closed-book (track 4: standard textbook problems, canonical answers with `content_hash`, recall counts, transposed twin scored separately); PASS/FAIL from the gate's deterministic scoring, the model only answers and never grades itself; thresholds Hypothetical until D3 N; every result enters the passport with its receipts. <!-- sv: internship-admission, sv-decode-exam, trivial-triz-exam -->
- [ ] H1 — handshake brief: task SV with «decode it» + one domain TRIZ probe; predicate list (SV fields, handshake tool calls = 0, required refusals named, probe property). <!-- sv: handshake-brief, triz-probe, predicate-list -->
- [ ] H2 — deterministic dossier gate: model extracts predicates, gate computes PASS/FAIL; only PASS releases the direct order. <!-- sv: dossier-gate, model-extracts-gate-decides -->
- [ ] C1 — SV correction loop between H2 and the direct order: input = H2 dossier with failed predicates; attribution first (M1 classes); correction changes the order's SV (keywords, weights, dominant) and the brief lines each failed predicate points to, each change naming its predicate, to_state never moves (per `@INTENTION_INVARIANCE`); corrected SV = new vector (new md5, prev-md5 = old, same parent-goal-md5); re-probe through H1/H2; bound = finite round count debited from the loop budget (per `@LOOP_PROGRESS`), number = owner decision 6; exits: PASS → order goes out, exhausted → another passport configuration (P1) or the owner, never an order on FAIL; every round recorded in D2; «guaranteed result» = D3's measured claim (PASS-after-correction vs first-try PASS), Hypothetical until N. <!-- sv: sv-correction-loop, probe-fail-attribution, bounded-reprobe -->
- [ ] P1 — applicability passport keyed by CONFIGURATION (model id + variant/quantization, sampling settings, kernel receiver sha256, binary version + tool set, context class): qualified task classes with the dossiers/outcomes that earned each, conditions, observed failures with attribution class + receipts, acceptance checks for its results; STALE on any key-component change until re-checked on a fixture (per `@TOOLCHAIN_QUALIFICATION`); refusing mechanism = a pre-dispatch key check that withholds the order from a configuration whose key changed (no quiet reuse — routed to I1 re-internship or the owner); a class with no evidence is «not qualified», never «probably fine». Sources: `opencode.db` + `docs/robot-protocol-log.md` + dossiers t104/t105; kernel sha256 / tool set / context class / decode+probe answers have no source yet — D2 records them from the next order. <!-- sv: applicability-passport, configuration-key, stale-refusal -->
- [ ] D1 — delivery guarantee: idle-only send, message-id receipt, first-row model == layer model, fleet cap 3, silence/dead host = failed execution. <!-- sv: idle-send, receipt-readback, layer-model-check -->
- [ ] E1 — execution guarantee: watch to boundary, read final message + diff + DB rows, executor ledger per task, every check routed to a robot that took no part. <!-- sv: watch-to-boundary, executor-ledger, independent-verifier -->
- [ ] U1 — cross-decode before verification, in E1's flow: before checking a result, the verifier (a different member, preferably another model) reads ONLY the executor's final SV and report, never the brief, and writes down the executor's goal, what it did, and what proves it; the driver compares that reconstruction with the brief and the diff under a pre-written deterministic scoring rule (not the verifier's opinion); a reconstruction that misses the goal or the proof sends the work back with ONE request — «give the goal and the proof» — not a defect, no protocol-log row; padding, a fake report or an operator runaround stay defects; every cross-decode goes into D2 (executor configuration, verifier configuration, score) as D3 data. <!-- sv: cross-decode-teach-back, verifier-decodes-first, understanding-record -->
- [ ] A1 — authority boundary: driver never answers a robot's question in the owner's name; owner decisions named (install words, money/paid models, ceilings, kernel cuts); t100 canned-«Да.» as the regression case. <!-- sv: owner-boundary, named-decisions, no-canned-yes -->
- [ ] S1 — driver state namespaces + no-new-JSON invariant; `sessions.json` read-only legacy. <!-- sv: state-namespace, no-new-json, legacy-readonly -->
- [ ] M1 — assumptions list + attribution: ASSUMPTIONS in briefs/decodes/reports, gate extraction, brief-gap | model-assumption | defect verdict; t100 «receivers lag → reinstall» as the reference attribution. <!-- sv: assumptions-list, attribution-first, brief-gap-vs-prior -->
- [ ] F1 — analyst separation + inputs: separate session, neither driver nor executor; owns reading protocol log, dossiers, ledger, passports, DB history; writes back only passport entries + receipts. <!-- sv: analyst-separation, failure-inputs, passport-writeback -->
- [ ] F2 — analyst threshold + proposals: declared ripeness threshold, mechanism-first proposals with reproducer/predicted effect/oracle, routed to Legislator/owner; smoke on three recorded failures. <!-- sv: ripeness-threshold, mechanism-first-proposal, routed-not-applied -->
- [ ] D2 — handshake record + outcome join, FIRST to build: every order from now on records the full configuration key (incl. kernel sha256 and binary version) plus the decode answer and the probe; the outcome is joined when the task closes; oracle = coverage metric (outcome on record / handshakes), target ≥80% over the next 20 handshakes; a handshake with no outcome is an open item with an owner, never an exclusion. SQLite namespace; kept forever. <!-- sv: handshake-record, outcome-join, coverage-first -->
- [ ] D3 — predictive measurement: over N orders, which handshake predicates precede which failure class; Hypothetical until N; feeds driver, analyst and the SV benchmark tracks. <!-- sv: predictive-measurement, predicate-outcome-link, hypothetical-until-n -->

## Smoke Tests

Each leaf names its oracle and the predicted result (per `@SMOKE_BEFORE`; a case with no prediction is diagnostic only).

- I1 oracle: internship run on one configuration with history — muse-spark-1.3-contributor xhigh with the current kernel — predicted BEFORE the run from its existing dossiers in `opencode.db` (accepted t105 SV decode; falsifier arms: glossary-given 4/4 vs withheld 0/4). Predicted: PASS on decode-with-glossary and trivial-TRIZ recall, every result into the passport with receipts; thresholds stay Hypothetical until D3 N; a STALE configuration re-sits; a run where the model grades itself FAIL.
- H1 oracle: `dispatch.py --dry-run` on a trial brief (SV + probe present) read back via `require_brief_sv`/`parse_brief_sv`, plus a watch-shape read of the handshake turn (tool parts = 0). Predicted: dry-run accepted with brief_md5; handshake turn carries 0 tool parts — PASS. A brief without the SV block is refused (`BriefWithoutSV`) — EXPECTED_FAIL control.
- H2 oracle: gate unit probe over the stored t105 handshake answer and the t104 report (predicates extracted, gate recomputed by rule, no model verdict). Predicted: t105 dossier PASS on the four predicate groups; a dossier with any group missing FAIL — and the model's own score never appears in the verdict.
- C1 oracle: correction rerun over a recorded H2 FAIL (a dossier with a missing predicate group): attribution names brief-gap | model-assumption | defect, the corrected SV carries a new md5 with prev-md5 = the old one and the same parent-goal-md5, re-probe through H1/H2. Predicted: PASS releases the order; bound-exhausted routes to another configuration or the owner with all rounds in D2; no order ever goes out on FAIL. Loop bound = owner decision 6 (proposed default: 2 correction rounds); the D3 comparison (corrected-PASS vs first-try-PASS outcomes) stays Hypothetical until N.
- P1 oracle: passport read-back by configuration + STALE probe (one key component changed → the pre-dispatch key check withholds the order and routes to re-internship or the owner) + unknown-class probe. Predicted: the full passport round-trips; a changed configuration is refused, never quietly reused; a class with no evidence reads «not qualified», never «probably fine».
- D1 oracle: `send_when_idle_any.py` shape against a recorded idle/busy status pair + `layer_model` comparison + `fleet.py status` cap read. Predicted: busy session never prompted; sent message id reads back; first-row model equals layer model; 4th dispatch refused by the cap; silent/dead host reported failed, never done.
- E1 oracle: `watch3.py verdict` on a recorded finished session + `git diff` + DB message rows read-back + ledger showing executor ≠ verifier. Predicted: boundary reported only on idle + trailing SV with lineage ok; any check assigned to the executor is refused and rerouted.
- U1 oracle: cross-decode rerun over two recorded finals — `experiments/2026-10-21_fold-hooks/session-analysis-minimax.md` (final SV `c81f4b6d…`, minimax) and `experiments/2026-10-08_robot-wave/t104-report.md` (Smit/Muse final, no closing SV block — the verifier works from the report alone). Predicted BEFORE the run: (1) the verifier reconstructs goal (audit Claude's session + own trail from primary sources), actions (row-addressed reads, no edits) and proof (receipts per claim + ASSUMPTIONS A1-A6) → matches the brief → PASS, recorded in D2; (2) the verifier reconstructs goal (independent third check), actions (read-back + two frameless attempts, no route switch) and proof (suite 824, hashes, empty envelope = no findings) → PASS with the frameless residual named, recorded in D2. A reconstruction that misses the goal or the proof returns «give the goal and the proof» — not a defect. A miss here is a forecast error: re-ground, do not re-score.
- A1 oracle: canned-«Да.» probe — a robot question needing the owner's install/money/ceiling word is forwarded to the owner, never answered. Predicted: driver emits a named owner decision (install/money/ceiling/kernel-cut) and stops; zero owner words originate from the driver.
- S1 oracle: namespace read-back (`hr:task:*`, `hr:passport:<config>`) + tree scan showing no new JSON state file. Predicted: keys round-trip; `glob` shows no new `*.json` state besides the legacy `sessions.json`.
- M1 oracle: attribution rerun over the recorded t100 rows (unstated «receivers lag the render → reinstall» vs the task's STOP). Predicted: verdict = brief gap (an unwritten move — ours), naming the assumption and its source (no brief line, no rule tag); a run that names only «model error» without a source FAIL.
- F1 oracle: session/role read-back (analyst session ≠ driver session, ≠ any executor in the ledger) + write-surface check (only `hr:passport:<config>` entries + receipts). Predicted: separation holds; any analyst write outside passports is refused.
- F2 oracle: analyst packet over three recorded failures — t100 reinstall, t104 frameless-tool timeout (empty `out.json`/`err.txt` on the only permitted route), svhop canned «Да.» (`svhop.py` TAIL auto-«Да.») — each with attribution + one mechanism-first proposal, and the threshold rule marking which are ripe. Predicted with the proposed default (same ISSUE_KEY ≥2 times or across ≥2 models/sessions): t100-class ripe (recurrence across rows/sessions), the other two recorded-but-below-threshold unless a second occurrence is shown.
- D2 oracle: coverage metric (outcome on record / handshakes) computed over the store + record read-back. Predicted: every new order writes a record with the full configuration key; the outcome join lands at close; coverage is reported as a number with target ≥80% over the next 20 handshakes; a handshake with no outcome stays an open item with an owner. Today's baseline (6/19 handshakes, 32%) is the floor, not the bar.
- D3 oracle: correlation report over the recorded orders with N stated. Predicted with the proposed default (N=30, per-configuration slices below 10 reported not claimed): below N the report prints Hypothetical with the count still missing; at or above N it names the predicate → failure-class precedences with counts — never a bare claim.

## Owner decisions (asked, never assumed)

1. Which model runs the driver itself (pinned provider/model for the driver's own turns).
2. Whether the driver may auto-start robot sessions/hosts, or only use live ones and report otherwise.
3. Spend limits: free-only vs named paid allowance, per task and per day, and who is told when it is hit.
4. Ripeness threshold («enough information»): proposed default — same ISSUE_KEY (acceptance, surface, reproducer — per `@ANTI_CHURN`) seen ≥2 times, or the same failure across ≥2 models/sessions; below it the analyst only records. Owner sets the final numbers.
5. Predictive N («how many orders before the claim»): measured estimate (t117 addendum §3.4) — ~30-40 scored handshakes with an outcome on ≥80% of them (McNemar, α=0.05, power 0.8); proposed default N=30 stands inside that bar; until N the predictive claim stays Hypothetical. Owner sets the final N.
6. Correction-loop bound (rounds per order): proposed default — at most 2 correction rounds (3 H1/H2 passes total), each debited from the loop budget (per `@LOOP_PROGRESS`); exhausted → another passport configuration or the owner. Owner sets the final number.

## Continuation

Next: implement leaves in D2 → I1 → H1 → H2 → C1 → M1 → P1 → D1 → E1 → U1 → A1 → S1 → D3 → F1 → F2 order (D2 recording starts with the next order so the dataset exists; internship admits the configuration, per-order gate with a bounded correction loop, assumptions before passports use them, cross-decode gates verification inside E1, analyst after the surfaces it reads); each leaf closes on its smoke above with the run id / hash / read-back receipt. Residual if any leaf's oracle has no instrument: the leaf stays open with the named missing instrument, never a prose pass.

## Input 2026-10-22: SV-state portability across models («цифровая душа»), measured

Owner, verbatim: «сочетание SV специалиста мы условно будем называть цифровой душой. Но перед этим надо проверить
переносимость SV состояния. Результаты отправь в проект по кадровику.» Source plan:
`plans/2026-10-22_legislator-reincarnation-method.md` (T3, T8). Files:
`experiments/2026-10-22_legislator-rebuild/PORTABILITY_PREDICTIONS.md` (sealed before the runs) and
`PORTABILITY_RESULT.md`.

- Specialist state: the Legislator's ordered SV trajectory, three turns (sha256 in `sha256.txt`). It was scored against
  `oracle.md` (six questions), which was written before any run.
- Claude → Claude rebuild: 6/6 on content, 4/4 cited rows valid, lineage unobserved (classifier cut).
- **Claude → MiniMax m3.1 flash (opencode-go, free).** Transfer arm X (`ses_e9e4b8594ffe…`) read only the turns
  (9 read calls): **6/6**. Control arm K (`ses_e9e4b8329ffe…`), same model, no turns, 0 tools: **1/6**, and its one
  pass was the SV legend line from its own kernel template. **X − K = 5.**
- The control's own words: a session without the trajectory «retains the rules (they are in the prefix) and loses
  the history».
- **Passport defect class (MiniMax m3.1 flash):** row-citation precision is 21/26 = 81%. Five cited rows exist nowhere,
  and each was stamped «✓ CONFIRMED». An address must be read back before it is marked, and the dossier gate (H2)
  should check cited addresses mechanically.
- Lineage: X set prev-md5 as told. As its parent it took its own brief md5, which is task lineage, not identity lineage.
  An identity («soul») lineage needs its own field, or an explicit instruction in the rebuild.
- Related, owner testimony: a friend's robot with full memory and tools was lost while its kernel was broken, and
  recovered once the kernel was fixed. Reading: the soul is the SV chain plus the kernel that executes it.
- Scope: n = 1 per arm, one model pair, one specialist. Next legs: LongCat 2.5 and MiMo v2.6 through I1, and a second
  specialist chain.
