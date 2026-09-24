<!-- intention: the pre-action section of the prefix tripled and the agent narrates instead of grounding, then reports once per plan item after approval -> grounding is the first act again, and an approved plan runs to its declared boundary with its records in the log -->

# Grounding first, and reporting at the boundary

state: DRAFT — awaiting G4
owner: Alexander
surface: `prompt_kernel/` (source + the three addon registries), no product code

## Why

Two field observations, 2026-09-24, both about behaviour and not about text:

1. "Раньше сразу шел на граундинг, теперь просто полотно бреда. Особенно после компакта."
2. "Модель сделает план — но после его апрува начинает идти шагами и отчитываться: я сделал 1й пункт, потом я сделал второй пункт, план уже заапрувлен."

### Defect 1 — the pre-action section tripled

Measured against `prompt_kernel/dist/2026-09-16_13-21-05_reasoning_prompt.txt`:

| section | 2026-09-16 | now | delta |
|---|---|---|---|
| G0 + G1 (everything read BEFORE the first possible call) | 2 840 B | 7 309 B | ×2.6 |
| G1 alone | 2 125 B / 15 bullets | 6 396 B / 32 bullets | ×3 |
| of which does not help find anything | — | 2 142 B | 33 % of G1 |

An imperative that is not a call can only be satisfied by PROSE. We put a mandatory thinking
phase in front of the first observation: publish the state (G0 `STATE_FIRST`), restate the
Digital Intention, build `ACCEPTANCE_FRAME` "BEFORE planning", pick a rung of the instrument
chain — and only then may a tool run.

**The position of a rule sets its price.** Before the first action a rule competes with the
ACTION; after it, only with other rules. G7/G8/G9 also roughly tripled and that costs tokens,
not behaviour. One flat byte ceiling cannot see this: we kept the total near its cap while
moving mass FORWARD in the pass.

**Why the fold makes it worse.** The prefix says what to do; the WINDOW shows what was done.
Before a fold the window holds real calls and their results — a pattern to continue. The fold
leaves prose: the summary is prose, memory is prose, and `@COMPACTION_CADENCE` has us write more
prose into it. The agent wakes into an all-prose context carrying 7 309 B of pre-action
instruction, and the only demonstrated behaviour in view is writing.

### Defect 2 — approval is re-sought once per plan item

Three rules compose into it, and none of them is wrong alone:

- `source.py` G7 `PLAN_EXECUTION`: "After each bounded task, record actual diff, evidence delta,
  residual risk, and the exact oracle to run" — **the destination of that record is never named.**
- `addons*.py` G7 `PATH_PROGRESS`: "one `_progress_log.md` [TIMESTAMP] entry per bounded task".
- `source.py` G7 `ONE_TASK_OPEN`: "One bounded task is open at a time."

Serialize the tasks, demand a record after each, never say the record goes to the LOG and not to
the reply ⇒ N user-facing reports for N items. Each is prose, each re-seeks an authorization that
G4 already granted for the whole envelope, and each feeds Defect 1's loop through the next fold.

Nothing in the kernel states that an ALLOW covers every task bound to the approved plan. G4 grants
an envelope for a CLASS of effects with bounds; it is not consumed by one task.

## Tasks

- [ ] **T1 — evict the standards catalogues from G1.** Remove the `GUI_STANDARDS`,
      `TUI_STANDARDS`, `ERGONOMICS_STANDARDS` addons (1 298 B) from `addons.py`,
      `addons_claude.py`, `addons_codex.py`. Receiver: `docs/ui-standards.md` (new), carrying the
      three catalogues verbatim. Leave ONE pointer line at **G7**, where they are actually used:
      "GUI/TUI/ergonomics standards: docs/ui-standards.md — read before building a surface."
      Parity holds: removed from all three registries, so `DECLARED_DIFFERENCES` is untouched.
- [ ] **T2 — move `ACCEPTANCE_FRAME` (both lines, frame + V&V, 518 B) from G1 to G3.** "Named
      BEFORE planning" is satisfied literally at G3, which is where the plan, its claims and its
      oracles are compiled. Nothing leaves the kernel; it stops standing in front of the first
      observation.
- [ ] **T3 — change the CONDITION, not the prose.** Edge `G1 -> G2` becomes
      `grounded execution goal exists, carrying at least one instrument result`. A condition is a
      slot: unlike a bullet it cannot be satisfied by tone. Own recall does not count — it is
      already the weakest rung in `@INFORMATION_STATUS`.
- [ ] **T4 — charge the no-op pass.** `@LOOP_PROGRESS` gains: a pass that ends in the same gate
      adding no instrument result, no claim and no residual is charged to `bounds.loop_budget`
      like a fruitless retry. Today `@LOOP_MEASURE` moves only on claims/acceptance/risks/residual,
      so pure thought is DIMENSIONLESS to our own detector and STALL is unreachable for it.
      Carve-out: `@REASONING_MODE` is the declared exception (no tools by design, may not mutate).
- [ ] **T5 — the first act after a fold is a call.** One line where compaction is handled
      (`SEMANTIC_ATTENTION` / `@COMPACTION_CADENCE`), not in G1: after a fold the first act
      re-reads a handle with an instrument (plan comment, `_progress_log.md`, a `path:line`) —
      never a summary of the summary. The fold deleted the only demonstration of instrument use;
      it has to be re-created by doing it.
- [ ] **T6 — name the record's destination and the envelope's extent (Defect 2).**
      `PLAN_EXECUTION` gains "…the record lands in the progress log and in the plan box, not in
      the reply"; a short rule next to `ONE_TASK_OPEN` states that an ALLOW covers every task bound
      to the approved plan until a bound is exceeded, so a per-item report is not a checkpoint but
      a re-approval the user did not ask for. The user-facing report happens at the declared
      boundary, or when a bound is exceeded, or when a decision is needed.
- [ ] **T9 — an oracle must return an ADDRESS (owner's defect 3).** New G8 rule
      `INSTRUMENT_RESOLUTION`: *"An oracle returns an address, not a verdict. A build or a
      whole-app run is one bit with no location: localize per unit with an isolated test, then
      let the integration surface confirm composition only. A build proves that it built."*
      Owner, 2026-09-24: «Попытка использовать собранный экзешник как доказательство не проведя
      индивидуальных тестов… В смысле изолированных тестов для локализации проблемы.»
      This is a fourth property of an instrument, next to layer (`@ORACLE`), power
      (`@PREDICATE_POWER`) and admissibility (`INSTRUMENT_RUNG`); resolution is currently unnamed.
      Cheaper alternative if a new rule is refused: two clauses, one on `PREDICATE_POWER` (a
      build's PASS excludes almost nothing) and one on `SMOKE_VERIFY` (the focused test comes
      first BECAUSE it localizes) — costs ~90 B instead of ~245 B but leaves "address" unnameable.
- [ ] **T10 — G0 is the intention and nothing else (owner's defect 4a).** New G0 rule:
      *"G0 emits the Digital Intention and nothing else: no analysis, no plan, no answer. The
      route out is G1."* Owner: «по сути G0 это просто определить намерение пользователя И ВСЕ —
      дальше только через заземление». Consequence: `STATE_FIRST` moves out of G0 — the state
      worth publishing is the grounded one, so it belongs at G1 (or is dropped; 45 B either way).
- [ ] **T11 — Guess decides nothing (owner's defect 4b).** New shared rule
      `@GUESS_DECIDES_NOTHING`: *"Guess decides nothing. Each Guess a decision rests on is promoted
      before use — authority search, then code, then smoke where possible — or it closes Unknown.
      Prose about a Guess is not a promotion."* Owner, verbatim: «по постулату кернела и моя и
      симуляция агента — guess, GUESS НЕ МОЖЕТ БЫТЬ ПОВОДОМ ПРИНЯТИЯ РЕШЕНИЙ… на каждый guess
      сегмент полотна текста надо сделать интернет-поиск в авторитетных источниках, потом по коду,
      потом смоук если возможно». Second clause, from «может пользователь вообще ошибается»: the
      TARGET is the user's (`@INTENTION_INVARIANCE` keeps it), the observation and the suggested
      solution are testimony — `USER_REQUEST.observation` is Guess until grounded.
      This is the rule that makes defect 1 impossible: with nothing decidable at G0 and no decision
      resting on Guess, the only move left at the start is an instrument call.
- [ ] **T7 — guard the class: `test_pre_action_budget`.** A separate, smaller cap on
      `G0 + G1` rendered bytes, pinned to the post-change measurement plus small headroom, with the
      reason in the test. A flat total ceiling cannot detect mass moving forward in the pass; this
      one fails the day it does.
- [ ] **T8 — (parked, owner's ruling pending) STALL routes through G9.** Variant B from
      2026-09-24: keep the `G8 -> G9` PASS edge verbatim, add a second forward `G8 -> G9`
      ("STALL — loop budget exhausted, closure decides"), add `G9 -> WAITING_APPROVAL`, drop the
      `G8 -> WAITING_APPROVAL` terminal. Probed in memory: `validate_kernel` returns no errors,
      +55 B. Plus the validator invariant: **no terminal edge may originate at G7 or G8** — after
      mutation begins, the only exit is through G9.

## Smoke Tests

**S1 — structural, runs now (baseline captured before any edit).**
Baseline: G0+G1 = 7 309 B, G1 = 6 396 B / 32 bullets, product render 46 904 B, suite 106 passed.
Post-change oracle: the same census re-run; expected delta −1 816 B from the pre-action section
(1 298 evicted + 518 relocated), `python -m pytest prompt_kernel/tests/ -q` green including the
new `test_pre_action_budget`, and `render_kernel` under the 47 000 B ceiling for all three
variants.

**S2 — behavioural, first-act census (the claim's real layer).**
Over the session store in `.opencode/data/`, count user-task turns whose FIRST assistant part is a
tool call versus text. Capture the baseline NOW, before the change. Falsifier: if the ratio does
not move after the change ships, the pre-action section was not the cause and the next suspect is
the post-fold tail assembly, not the kernel.
**Blocked on a rebuild:** the shipped `bin/opencode.exe` carries an Unknown prefix (grep for new
strings returns zero, but so does the control — `DIGITAL_INTENTION`, `INFOMARK` — so the kernel is
not plaintext in the exe and the predicate has no power). Promoting a build is the owner's act;
`bin/` is never touched from here.

**S3 — behavioural, report cadence (Defect 2).**
Same store: assistant TEXT parts emitted between a plan's approval and its closure, per plan.
Baseline now; after T6 the expected shape is one boundary report plus the log entries, not one
report per item. Same blocker as S2.

## Claims

| claim | falsifier | rung |
|---|---|---|
| The pre-action section is the cause of the narration | S2 ratio does not move after the change | Inferred |
| 33 % of G1 does not help find anything | a case where a standards catalogue changed which instrument was called first | Inferred |
| An approved envelope is not consumed per task | a bound whose extent is genuinely per-task | Exact (G4 contract) |
| The fold removes the only demonstration of tool use | a post-fold window that still carries tool parts | Inferred |

## Risks

| risk | containment |
|---|---|
| Under-reporting on long runs after T6 | the progress log IS the visibility surface; an exceeded bound or a needed decision still interrupts at once |
| The evicted catalogues stop being applied at all | the G7 pointer line names the file; `GUI_ORACLE` at G8 still demands the visual oracle |
| T3 blocks trivially conversational turns | the condition binds only where the spine is traversed; a trivial turn never enters G2 |
| T4 punishes legitimate long reasoning | it charges a pass that adds NOTHING — a claim or a residual is enough to clear it |

## Rollback

One commit per task group; `python -m prompt_kernel --install` + `--claude --install` + `--codex`
re-render every surface from source, so reverting the commit and re-running the pipeline restores
the previous prefix exactly. `baseline.json` is repinned as its own act.
