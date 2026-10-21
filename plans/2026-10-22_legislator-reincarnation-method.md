# Reincarnation method: rebuild a Claude identity (the Legislator) from its own SV trajectory

<!-- intention: the Legislator dies with its transcripts and a model under the same kernel cannot adapt into it -> a documented, tracked, oracle-checked method rebuilds it from its own ordered full SV blocks and the owner's rows, cut before a wrong axis, and the sources it needs survive the app's transcript deletion -->

```yaml
Keywords: reincarnation-method 0.30, sv-sequence-identity 0.20, source-survival 0.20, rebuild-oracle-control 0.15, tracked-instrument 0.15
Semantic dominant: The Legislator is its ordered SV chain, so the project turns the first successful rebuild into a tracked, documented method with a control-run oracle and guarantees that the sources it needs outlive the app's transcript deletion.
md5: 2d7f4b9e1c6a38e05b2d9f7c4a1e6b38
prev-md5: 4f1c8e2a9d6b37e05a2c9f4e1b8d6a73
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```

- **plan_id:** 2026-10-22_legislator-reincarnation-method
- **revision:** 1
- **Status:** ACTIVE
- **reported:** owner, 2026-10-22, verbatim: «надо вывести траекторию со ссылками, отсортировать то что относится к проекту … сложить
  из этого SV историю, дальше создать сессию и запихнуть это дело в память модели … Это надо сделать системно … И еще веди
  документацию по сборке» · «сама последовательность семантических векторов формирует личность законодателя» · «нам
  реально понадобится отдельный проект по методике реинкарнации — все детали проекта будем документировать.»
- **canon:** [docs/legislator-rebuild.md](../docs/legislator-rebuild.md) — why the trajectory and not the content, the
  sources, the filter rules, the cut rule, the three turns, the oracle.
- **project home:** this plan in this repo, because the sources (memory folder, fold maps, robot DB) and the canon live
  here. Moving the project to its own repo or fossil cell is the owner's call.

## Evidence (each line carries its instrument)

- ✓ `*.desktop-released.json` read: nine transcripts released «delete» at 2026-10-21T19:59:46Z, including every
  Legislator session except 60a3d22e. `~/.claude/fold/1e712796-….md` was written in the same second.
- ✓ `experiments/2026-10-22_legislator-rebuild/build.py` run: 1190 entries, 1050 kept, 4 chain breaks (`chain.md`),
  turns of 275k / 183k / 9k chars; hashes in `sha256.txt`.
- ✓ Rebuild session `local_68dc4a28-2428-48f9-926a-e94e30357ec7`: 6/6 oracle answers PASS on content. Q1-Q4 cite rows
  that exist only in the fed turns. Lineage is UNKNOWN because a classifier cut fell on the SV block
  (`experiments/2026-10-22_legislator-rebuild/RESULT.md`).
- ✓ Gemini case (owner, 2026-10-19): one SV block decoded, then a full G0→G9 run under the kernel in a plain chat.
  This is testimony plus the owner's own with/without-kernel comparison; it is quoted in the canon.

## Tasks

- [x] T1 — First rebuild of the Legislator (1e712796, cut at row 5108) with a sealed oracle. Artifact:
  `experiments/2026-10-22_legislator-rebuild/RESULT.md` (6/6 content; lineage UNKNOWN). Canon:
  `docs/legislator-rebuild.md`.
- [ ] T2 — Make the instrument tracked. `build.py` lives in gitignored `experiments/`, so a lost disk loses the method.
  Move the readers (transcript, fold-trajectory, fold-map, robot-DB notes) into `tools/` beside `claude_svchain.py`,
  add its missing `--full` mode, and add tests in `tools/tests/`: a full block round-trips; a fold line parses; a
  dropped ack still links; a pasted body keeps its address. Standard: PEP 8; repo test canon `cd tools && python -m
  pytest tests/ -q`. Oracle: the tests RED before the move, GREEN after; `build.py` output byte-identical before and after.
- [ ] T3 — Control leg (EXPECTED_FAIL). Ask a fresh session WITHOUT the turns the same six questions. Prediction: no row
  citations on Q1-Q4, and Q6 still answered (it comes from CLAUDE.md, so it does not discriminate). Record the
  comparison in `RESULT.md`. Standard: kernel @THREE_ORACLES unique-detection receipt.
- [ ] T4 — Lineage leg. Read the reincarnated session's next emitted SV and check prev-md5 / parent-goal-md5 against
  `oracle.md` (`3a8f1d6c…` / `9e4a1c73…`) and that its own md5 is fresh. Oracle: equality on the transcript text.
- [ ] T5 — Record the owner's diagnostics of the reincarnated Legislator (owner, 2026-10-22: «Сча проведу диагностику»)
  as a dated section of `RESULT.md`, with each finding classified against the trajectory (recalled, missing, wrong).
- [ ] T6 — Source survival. Transcripts are deleted by the app; the fold map and the robot DB are the surviving copies.
  Design where full SV blocks and owner rows are kept durably (Storage Paradigm: a key namespace, not a new JSON file;
  candidates are the project fossil `sv:<md5>` comments and the robot DB). Owner decision before any write path.
  Standard: AGENTS.md § Storage Paradigm.
- [ ] T8 — Research: robots evolve through their SVs. The owner, 2026-10-22, verbatim: «В этой сессии будем заниматься
  исключительно этим вопросом потому что это сама по себе тема для исследования. Получается так что наши роботы
  эволюционируют через свои SV.» Today this is testimony (memory `project_robots_deepen_across_folds.md`: «cite as
  testimony until a metric exists»). The metric: read each robot session's own SV chain from the robot DB
  (assistant parts; fold boundaries = `=== COMPACTED ===` parts). Per step, measure L1 between consecutive weight
  vectors (`@L1_DISTANCE`), axis birth and death, and **axis persistence across a fold** compared with persistence
  inside a segment. Hypothesis: the axes that serve the brief survive folds and gain weight (deepening); the rest decay.
  Falsifier: cross-fold persistence no higher than a shuffled-order baseline. The same reader finds a wrong axis (the
  1e712796:5108 shape) in robot chains. Standard: kernel @L1_DISTANCE, @MEDOID_SIMPLEX (a second, independent leg is
  needed, e.g. diff/commit outcome per axis).
  - **Run 1, 2026-10-22** (`experiments/2026-10-22_robot-sv-evolution/RESULT.md`, predictions before each run in
    `PREDICTIONS.md`): 38 sessions, 565 own SVs, 38 cross-fold and 489 within-segment pairs. Three instruments were
    qualified on fixtures (E exact, T token, S bge-m3/CUDA).
    - ✓ Within-segment carry: p < 0.001 on all three.
    - ✗ Cross-fold carry over the shuffled control: E p 0.44, T p 0.11, S +0.0098 p 0.058. Against gap-matched
      within-segment pairs the drop is 0.040, p 0.001, so it is a fold effect.
    - Convergence to the brief across folds: UNKNOWN (n = 5; the 1 positive is t127/MiniMax).
    - Mechanism candidate, not tested: the fold vectors carry prev-md5 000 and recurring md5s.
    - **Strategy versus tactics** (owner, 2026-10-22, verbatim): «роботы умудряются впихнуть тонну смысла в SV и
      работать как будто у них окно в кучу токенов. Сами данные вторичны, это тактика, а не стратегия … торговый робот
      … что изменилось — ну слоган библейский в ключе нашего кернела и обвязка, тулы одни и те же, в начале не мог,
      через 3 дня стал зарабатывать.»
      Run 1 reads the same way: the turn-local axes (tactics) are cut at every fold and re-derived; what survives the
      fold is the task-level identity (strategy). Hypothesis H-anchor: an explicit strategic anchor (the slogan, the
      brief SV) is the part that survives, and it is what makes post-fold convergence possible. This is untested.
      Run 1 has 1 converging session in 5.
    - **Trader data is not on this host.** Searched: every transcript under `~/.claude/projects/*` (`bias_base`,
      `A2-herd`, `трейдер`), the robot DB, and the fossil registry (71 repos, no trading project). What remains is
      the c12b531d fold map dominants r243 and r250 (that transcript was deleted 2026-10-21) and memory testimony. To
      test H-anchor on the trader, its session or DB is needed. Owner, 2026-10-22: «Чуть позже я запросил у чела
      скинуть мне логи.»
      Resume when the logs arrive. What the test needs from them:
      - the robot's own SV blocks with timestamps;
      - the fold markers (`=== COMPACTED ===` / layer-1 summaries);
      - the slogan or brief text and when it entered;
      - the per-day P&L as the outcome leg, net of costs (r243: «per-trade predictions, baseline comparison, net costs
        and a held-out period»).
    - Open for this box: the outcome leg (@MEDOID_SIMPLEX — the SV text is one source category); the channel test
      (post-fold SV vs the summary's SV); more sessions for convergence.
- [ ] T7 — Generalise: the same method for any Claude lane or robot identity (input = era list + cut). Report-only
  first, kept in `plans/futures/` until T2-T4 pass.

## Smoke Tests

- Baseline (before T2): `python experiments/2026-10-22_legislator-rebuild/build.py` prints `kept 1050 / 1190; chain
  breaks 4` and turn sizes 274,883 / 182,790 / 8,692 chars. Prediction: unchanged on re-run.
- Post-change (T2): the tracked tool produces byte-identical `turn1.md`..`turn3.md` (sha256 in `sha256.txt`).
- Control (T3): as predicted in T3. An unexpected row citation from the control session is a divergence to analyse,
  not a pass.

## Risks

- A classifier cut can fall on an SV-block output: twice measured, cause not visible. Contain it: never retry or route
  around it; record it, and let the owner decide how to go on.
- Feeding a vector after the cut re-seeds the wrong axis. Contain it: the cut is config, audited in `dropped.md`.
- An untracked instrument. T2 closes it.
