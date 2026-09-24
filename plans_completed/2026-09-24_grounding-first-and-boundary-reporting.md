<!-- intention: the pre-action section of the prefix tripled and the agent narrates instead of grounding, then reports once per plan item after approval -> grounding is the first act again, and an approved plan runs to its declared boundary with its records in the log -->

# Grounding first, and reporting at the boundary

state: COMPLETED 2026-09-24 — as built, released in `5a06a07f40`, record in
docs/kernel-release-2026-09-24.md. Closed with a recorded residual (behavioural smokes S2/S3, the
maturity queue M1–M7): per the kernel's own G9, a stop whose residual is recorded is legitimate
closure — finished, not abandoned.
owner: Alexander
surface: `prompt_kernel/` (source + the three addon registries + `validate.py`), no product code

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

## Tasks — as built

Each box is confirmed against the installed source (`prompt_kernel/source.py`, line cited) and the
release render; where the build diverged from the proposal, the proposal is kept only as the reason.

- [x] **T1 — evict the standards catalogues from G1.** As built: FOUR catalogues left all three
      registries — GUI, TUI, ergonomics and project shape, 1 624 B (the proposal named three,
      1 298 B). Receiver `docs/ui-standards.md`; one pointer at **G7**: "surface standards (GUI, TUI,
      ergonomics, project shape): docs/ui-standards.md — read before building or reviewing one."
      Parity holds, `DECLARED_DIFFERENCES` untouched.
- [x] **T2 — `ACCEPTANCE_FRAME` G1 → G3.** As built: the frame line moved; the V&V line was
      REMOVED as a duplicate instead of moved — it is carried by `@ORACLE` + `@INTENTION_INVARIANCE`
      + G9 `ACCEPTANCE_PASS`.
- [x] **T3 — change the CONDITION, not the prose.** As built, `G1 -> G2` carries two senses apart
      (`source.py:523`): "execution goal grounded on instrument results, or on an established
      absence", and "not groundable at this scale: split until a leaf is observable", returning
      through the new back edge `G2 -> G1`. An established absence counts as a result — otherwise
      the edge would reward acting without grounding.
- [x] **T4 — charge the no-op pass.** As built in `@LOOP_PROGRESS` (`source.py:91`): a pass adding
      no instrument result (an established absence counts), no claim and no residual is charged as
      a retry; `@REASONING_MODE` exempt. `loop_budget` is DERIVED, not hardcoded: the envelope's
      value, else the count of distinct declared routes out of the gate (G8 three, G9 two, G2 and
      G5 one), counting DISTINCT attempts.
- [x] **T5 — the first act after a fold is a call.** As built in `@COMPACTION_CADENCE`
      (`source.py:311`): after a fold the first act is an instrument call that re-reads a handle —
      the plan comment, the progress log, a `path:line` — never a summary of the summary.
- [x] **T6 — the record's destination and the envelope's extent (Defect 2).** As built in two
      places, not one: G7 `PLAN_EXECUTION` (`source.py:259`) "the record lands in the log and the
      plan box, never in the reply; the report waits for the boundary, an exceeded bound, or a
      decision only the user can take"; and the extent went to **G4** as `APPROVAL_EXTENT`
      (`source.py:210`) "An ALLOW binds to the goal: every task of the approved plan runs under it
      until a bound is exceeded" — G4 owns the envelope, so the rule lives beside it, not beside
      `ONE_TASK_OPEN`.
- [x] **T9 — an oracle must return an ADDRESS (owner's defect 3).** As built: NOT a separate
      `INSTRUMENT_RESOLUTION` rule. `@ORACLE` became a definition with five required properties —
      it can fail (core clause kept verbatim), it sits on the claim's LAYER, its predicate EXCLUDES
      the alternatives, it returns an ADDRESS, and this identity can DRIVE it; "a build fails the
      last three: running an application proves that it runs". Resolution got its name inside the
      definition instead of a fourth parallel rule. Owner, 2026-09-24: «Попытка использовать
      собранный экзешник как доказательство не проведя индивидуальных тестов… В смысле
      изолированных тестов для локализации проблемы.»
- [x] **T10 — G0 is the intention and nothing else (owner's defect 4a).** As built, G0
      `G0_SCOPE` (`source.py:122`): "G0 emits the Digital Intention and nothing else: no analysis,
      no plan, no answer." `STATE_FIRST` moved to G1 (`source.py:152`). Owner: «по сути G0 это просто
      определить намерение пользователя И ВСЕ — дальше только через заземление».
- [x] **T11 — Guess decides nothing (owner's defect 4b).** As built, shared rule
      `@GUESS_DECIDES_NOTHING` (`source.py:50`), bound to G1 and G8: an ungrounded passage is error
      ADDED, not neutral; promote each Guess a decision rests on — the primary authority of its
      class in `@SOURCE_ROUTING`, then the code, then smoke — or close it Unknown; prose about a
      Guess is not a promotion. First caller `@SOURCE_ROUTING`'s authorities ever had. Owner,
      verbatim: «GUESS НЕ МОЖЕТ БЫТЬ ПОВОДОМ ПРИНЯТИЯ РЕШЕНИЙ… на каждый guess сегмент полотна текста
      надо сделать интернет-поиск в авторитетных источниках, потом по коду, потом смоук если
      возможно».
- [x] **T7 — guard the class.** As built under the name `test_pre_action_section_stays_small`
      (`prompt_kernel/tests/test_render.py:206`), not `test_pre_action_budget`: G0+G1 rendered bytes
      ≤ 5 600, pinned over the post-change measurement 5 365 B, reason in the docstring.
- [x] **T8 — STALL routes through G9.** Shipped, not parked — the owner ruled for variant B. The
      second forward `G8 -> G9` "a recorded non-PASS whose loop budget is exhausted; closure
      decides" (`source.py:534`), `G9 -> WAITING_APPROVAL` for STALL, the `G8 -> WAITING_APPROVAL`
      terminal dropped, and `validate.py` refuses any terminal edge from G7 or G8.

### Built beyond the proposal (same release, same session)

Recorded so the plan and the diff read together — each item is in the release record:

- `G8 -> G1`: an unrealistic oracle is a grounding defect, not a plan defect. `G1 -> BLOCKED`
  widened to "unobservable at every scale".
- G1 `INSTRUMENT_ORDER` — the chain is a ladder, not a fence: when no rung answers, BUILD the
  instrument from the project's own parts. G1 `INSTRUMENT_LAYER` — your own context is the nearest
  instrument and the least decisive.
- G2 `CUT_UNSUPPORTED`; G6 `HANDOVER_OR_SWITCH`.
- Termination is a FIXED POINT, not a scale limit (the Sierpiński test); G9 closure is two-sided —
  no split adds, nothing present lacks support. `RESIDUAL_GOAL` gains the slot `form_holds`.
- `@INFORMATION_STATUS`: Unknown is not a destination; `@EVIDENCE_BOUNDED_CLOSURE`: a partial REAL
  result outranks a complete simulated one.
- G9: the plan moves by the OUTCOME (SUCCESS → `plans_completed/`, OUT_OF_SCOPE →
  `plans_deferred/`, BLOCKED / WAITING_APPROVAL → `plans/postponed/`).

## Smoke Tests

**S1 — structural. PASS ✓.**
Baseline: G0+G1 = 7 309 B, G1 = 6 396 B / 32 bullets, product render 46 904 B, suite 106 passed.
Result (release record + re-run 2026-09-24 at closure): G0+G1 = **5 365 B** (−1 944 B, more than
the expected −1 816 because a fourth catalogue and two duplicate lines left too), G1 = 4 644 B;
product render 46 969 B / 47 000, sha `dc981bc4…da82e2ba`; `python -m pytest prompt_kernel/tests/
-q` → **107 passed**, including `test_pre_action_section_stays_small`.

**S2 and S3 were NOT run — they are the residual of this plan, not open tasks.** Both need a
`bin/opencode.exe` rebuilt with this kernel, and promoting a build is the owner's act. The lifting
signal: a promoted build whose prefix is the 2026-09-24 render; the first run of S2 then either
confirms the claim below or moves the suspicion to the post-fold tail assembly.

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

| claim | falsifier | rung at closure |
|---|---|---|
| The pre-action section is the cause of the narration | S2 ratio does not move after the change | Inferred — S2 not run (residual) |
| 33 % of G1 does not help find anything | a case where a standards catalogue changed which instrument was called first | Inferred |
| An approved envelope is not consumed per task | a bound whose extent is genuinely per-task | Exact (G4 contract, now `APPROVAL_EXTENT`) |
| The fold removes the only demonstration of tool use | a post-fold window that still carries tool parts | Inferred |
| The shipped text is what this plan says | a rule named here absent from `source.py` | Exact — each box cites its `source.py` line; suite 107 passed |

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

## Residual — the maturity gap, not built (blocked on the byte lever)

Recorded as residual, not as tasks of this plan: none of it was authorized, and none fits the
31 B left under the ceiling. Whoever picks it up opens a NEW plan and first funds it — the levers
are priced below.

Coverage is currently measured against the REQUEST (`ACCEPTANCE_PASS` = ∀ criterion, and a criterion
comes from `ACCEPTANCE_FRAME` = one per requested outcome). Project maturity lives in the cells
nobody requested — the difference between "did what was asked" and "the lattice is full". Five
medoids, ~500 B total, none of which fits in the 31 B of headroom left after the release:

- **M1 — two cadences, told apart.** G9 keeps "check @QUALITY_VECTOR axes only where the change could
  move one" (right for a bounded task); `EVOLUTION_LOOP` gets the sweep AS THE WORK (right at project
  closure). Unseparated, the anti-ceremony rule eats the sweep that produces «нечего прицепиться».
- **M2 — lattice coverage.** A maturity predicate beside the request predicate: every CELL has an
  oracle or a recorded void. Bounded by the same fixed point — fill while filling improves.
- **M4 — void inventory.** The unfilled cells listed, not described. "Nothing to pick at" becomes
  checkable: the list is empty.
- **M5 — the weight comes from outside.** The sweep is UNIFORM; priority arrives only from usage,
  incidents or the owner. Without this, uniform gets reported as prioritised.
- **M6 — the deliverable is the audience's oracle.** Owner, 2026-09-24: Astra's good ideas went
  unnoticed because they stayed abstractions; the interactive river-bottom profile drew «АХ». The
  judge cannot evaluate reasoning, only an artifact they can DRIVE — the same fifth property @ORACLE
  requires of an instrument. Corollary: an error in a checkable form is closer to value than
  correctness in an uncheckable one, because only the first can be corrected.

Levers, priced: prose compression (58 unpinned rules, 4 543 B of tail — `experiments/2026-09-24_kernel-prose-census/`);
`@SOURCE_ROUTING` secondaries (525 B, still no caller — only the primaries got one); or the ceiling.

- **M7 — the fixed point is INDEXED BY THE INSTRUMENT.** Owner, 2026-09-24: once the agent reaches
  that quality at commodity cost, «можно и приёмку доработать, вроде x-ray высокого разрешения, и
  звук померять». Today's `@LOOP_PROGRESS` knows one move at the fixed point — stop. There are two:
  stop (done AT THIS RESOLUTION) or RAISE THE INSTRUMENT and see whether gain reappears. A sharper
  oracle does not improve the product; it improves the measurement, and that is what creates new
  acceptance cells. Belongs in `EVOLUTION_LOOP` as a first-class candidate class beside product
  improvements, guarded by the same admissibility the kernel already demands: the new instrument
  must sit on the claim's layer, exclude alternatives, return an ADDRESS and be drivable here.
  **Second half, without which it gets adopted once and reverted:** the first effect of a sharper
  instrument is that everything looks WORSE — the new reds are previously invisible residual made
  visible, never a regression. AGENTS.md already forbids excusing errors as "pre-existing"; blaming
  the instrument is the same refusal to look, and nothing forbids it yet.
