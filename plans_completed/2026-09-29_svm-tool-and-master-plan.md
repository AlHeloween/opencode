<!-- intention: an agent must be able to STORE and READ the manifest of the turn it is in — task, plan ref, semantic vector, turn estimate — and the turn must be told when it is missing; the master plan becomes the rendered summary that no plan-file move can touch -> one SVM store + one tool + one turn-note reminder + a generated MASTER_PLAN.md -->
# SVM tool, per-task manifests, and the master plan

**Status:** DRAFT — owner, 2026-09-29, verbatim: «без шуток — тулза для SVM нужна — полноценная, и напоминалка в начале каждого хода если SVM не вбит. Таже на каждую задачу надо обязательно семантический вектор, реф на план и приблизительное количество ходов до перемещения в plans_completed. Ну и нужен реф на мастер-план — он отдельный и в plans_completed никогда не перемещается, должен отражать реальную сводку по разработке со всеми рекурсиями. Придумай как это реализовать удобно, понятно что в мастерплане SVM должен быть напечатан и обновлятся.»

## The kernel this implements (do not re-derive)

§1.4: SVM is «the complete context of ONE atomic task … `{turn_id, parent_turn_id, goal_hierarchy,
goal_vector, task_vector, evidence_vector, oracle_vector}` … seeded at G0 … one task keeps one
manifest, **updated per turn, never duplicated** … a BRIEFING that points to evidence, never evidence
itself». The owner's additions above are the same object seen from the plan side: a task needs its
**vector**, its **plan ref**, and its **distance to done in turns**.

## Decisions, each with its reason

1. **SVM is STATE, so it lives in the store — not in a new file.** Two planes already exist (SQLite
   for relational, LMDB for hot keyed state); a manifest is hot keyed state read on the turn path.
   Keys are flat and explicit: `svm:task:<planFile>#<taskId>` and `svm:session:<sessionID>` (which
   task this session is on). A new JSON file would be the exact growth the storage canon forbids.
2. **The master plan is DERIVED, never hand-maintained.** `MASTER_PLAN.md` lives at the repo ROOT —
   outside `plans/`, so `planFiles()` cannot see it and `reconcilePlans()` can never move it, which
   is precisely «он отдельный и в plans_completed никогда не перемещается». It is rendered from two
   sources that already exist: the plan files (which tasks exist, their boxes) and the SVM records
   (their vectors, plan refs, turn estimates). A summary that is generated cannot drift from the
   plans; a summary that is written by hand drifts the first week.
3. **One tool, three verbs, and it is also the renderer.** `svm` — `read`, `set`, `render`. `render`
   writes `MASTER_PLAN.md` recursively: goal level 0 → each plan → each task with its sv, plan ref
   and `eta_turns`, plus the pass/open counts the plan mirror already computes. Nothing new is
   measured; the tool only joins what exists.
4. **The reminder rides the turn note that already exists.** `prompt.ts` already appends `jobsNote`
   and `statusNote` as synthetic text parts on the fresh user message. A missing SVM is exactly that
   kind of fact, so it becomes a third line in the status note — no new injection point, no new
   surface that could be delivered twice (the 2026-09-29 loop was a re-delivered surface), and it is
   measured by the census the note already prints.
5. **The SVM is written into the summary on the fly** (owner, 2026-09-29: «в summary SVM можно кидать
   на лету»). The layer-1 capture already stores `diffs`, `impact` and `planState` for its window;
   the task manifest is the fourth such fact, so it is written AS the row is captured — no separate
   step, and the durable row then carries the manifest too, not only the store.
6. **At the fold the master plan is the LAST carrier** (owner, 2026-09-29: «при компакте masterplan
   идет сразу после всех summaries и ходов»). In `m*` it stands after every summary row and after
   the verbatim tail-adjacent messages, so the rendered goal → plans → tasks summary is the last
   thing a reader meets before the fresh tail — which is where a reader looks for direction.

## Shape of one SVM record

```
task:     T3
plan:     plans/2026-09-29_codegraph-impact-decoupling.md
sv:       <@SV_FORMAT block: Keywords/dominant/md5 chain>
eta_turns: 4            # turns until this plan moves to plans_completed/
state:    doing         # doing | blocked | verified | waiting-on-user
oracle:   <what will prove it — the instrument, not the hope>
```

## Tasks

- [x] ✓ **S1 — the store.** Shipped `8162b91e54` (`src/session/svm.ts`); `bun typecheck` exit 0
      (`20260929T233140Z_f504484f`). `SVMRecord` + `read`/`write`/`missing` over the plane that
      ACTUALLY exists — the `Storage` service (keyed, single-writer via `TxReentrantLock`, files under
      `{data}/storage/`) — **not** "LMDB/SQLite": that wording was written before the plane was
      checked, and no LMDB runs at runtime (its import shim is not written). Key is the array form
      `["svm","task",<planId>,<taskId>]`, `<planId>` = the plan's BASENAME without extension, because
      a `Storage` key becomes a file path and a plan path contains separators. `read` returns
      `undefined` for an unwritten task (never an invented record); `missing(planFile, taskIds)` names
      exactly the tasks without one, zero included.
- [x] ✓ **S1b — the store's round-trip test.** `test/session/svm.test.ts`. Oracles: `bun test
      test/session/svm.test.ts` → **4 pass / 0 fail** (`20260929T233743Z_744dc662`); `bun typecheck`
      exit 0 (`20260929T233752Z_132fcaa4`). The blocker S1 hit is now NAMED, not worked around:
      `provideTmpdirInstance(body)` must run inside `Effect.scoped` (it yields a `Scope`) with
      `CrossSpawnSpawner.defaultLayer` merged in, because `tmpdirScoped` yields `ChildProcessSpawner`.
      Both were named by the compiler, and the fix is the sibling Storage tests' own merge
      (`summary.test.ts`, `mechanical-writer.test.ts`) — reused, not invented. Covers `planKey`
      (both separators, missing extension), the round-trip, `undefined` for an unwritten task, and
      `missing()` naming exactly the absent ids.
- [x] ✓ **S2 — the tool.** `src/tool/svm.ts` over the S1 store, name `svm` wired in all four places
      (definition, `ToolRegistry.layer` + `builtin`, `util/dsml-normalizer`), and `Storage.defaultLayer`
      added to the registry's layer because the tool genuinely needs the store. **That requirement GREW,
      and the growth is recorded, not smoothed over:** two test harnesses that assemble
      `ToolRegistry.layer` by hand (`prompt.test.ts`, `snapshot-tool-race.test.ts`) now provide Storage
      too. **Split, named rather than glossed:** this ships `read|set`; `render` moves to S4, where its
      derivation lives — a verb advertised before it exists is a lie the model will act on. `set`
      REFUSES a manifest missing sv/etaTurns/oracle instead of storing a partial one, and the refusal is
      proven by reading the task back in the SAME instance. The store's functions now take
      `Storage.Interface` as a parameter: `Def.execute` may carry no service requirement (`R = never`),
      so a tool captures the store at init — one spelling per function, no second variant.
      Oracles: `bun test test/session/svm.test.ts test/tool/svm.test.ts` → **7 pass / 0 fail**
      (`20260929T234054Z_4c6ad0be`); `bun test test/tool/registry.test.ts test/session/tools.test.ts` →
      **13 pass / 0 fail** (`20260929T234105Z_fac7d49b`); `bun typecheck` exit 0
      (`20260929T234300Z_f180c798`, after the layer annotation gained `Storage.Service` and the two
      harnesses gained the provision).
- [x] ✓ **S3 — the reminder.** The note carries one more line, and it describes the task the note
      ITSELF already points at (`owed: … · next: <plan> <task>`): the manifest's dominant, its eta and
      its state — or `svm: MISSING for <plan> <task>`. **The acceptance is restated because the old one
      contradicted itself:** it asked for the dominant "when present" and then for the line to be absent
      in that same case, which cannot both hold. What it says now: the line is printed whenever the note
      has a next task, so a reader can tell "not written down" from "nothing to say" — the discipline
      `coupling:` and `claims:` already follow (a check whose silence cannot be told from its absence is
      not a check).
      Two functions carry it: **`owedTasks`** (exported; ONE spelling of "what is owed" — `tailNote`
      prints `owed[0]` and the caller reads `owed[0]`'s manifest, so the debt line and the svm line
      cannot name different tasks) and **`SVM.readNote`**.
      **The reader is service-free on purpose:** the note is built on the prompt path, and a service
      requirement there propagates into every layer that provides `SessionPrompt` (`tool/memory.ts`
      names the trade). The file comes from `Storage.keyFile` — the store's OWN mapping, exported for
      this — so it cannot drift even in spelling.
      **The oracle caught a real, silent defect and the fix is part of this task:** the storage plane
      captured its root when the LAYER was built, while `project/instance.ts:47` sets the global when an
      INSTANCE is created — so a layer built before its instance (the app's at start-up, a test's
      outside `provideTmpdirInstance`) read and wrote a DIFFERENT worktree's store. That is the
      mechanism behind the leaked record fixed in `9e53d317a0`, and it would have made this line report
      every task as MISSING while the store held manifests: silent, permanent, invisible in production.
      `Storage` now resolves its root per operation, so the writer and the reader agree by construction
      instead of by the accident that a process starts inside its own worktree.
      Oracles: `bun test test/session/svm.test.ts test/session/tail-note.test.ts test/tool/svm.test.ts
      test/session/mechanical-writer.test.ts test/session/summary.test.ts
      test/session/summary-anchors.test.ts test/session/snapshot-tool-race.test.ts` → **54 pass / 0 fail**
      across 7 files (`20260929T235113Z_8ee6f185`) — the last four are there because the plane they all
      sit on changed; `bun typecheck` → **exit 0** (`20260929T235145Z_0c67f68f`). The store's suite gained
      the round trip ACROSS the two implementations (write through the service, read through `readNote`)
      and a malformed-manifest case, because "the reader never throws" is what stops one bad manifest
      from blanking the whole note.
- [x] **S4 — CLOSED 2026-10-07 (owner: «Закрыть, sv — правило»).** The renderer half is done and verified in code
  (`SVM.applyRender` via `tool/svm.ts:76`, `NON_PLAN_FILES` `plan-status.ts:417`, plans/MASTER_PLAN.md rendered ✓).
  The authoring half — «no rendered plan or task lacks its sv» (113 MISSING on 2026-10-07) — never converges while
  new boxes keep appearing, so it leaves this plan and becomes a STANDING RULE enforced by a plan-form check (sv +
  a three-line status header per plan), to be built as the mechanism of the 2026-10-07 plans triage. Original box:
  **S4 — the master plan.** <!-- done_pct: 90 | attempts: 1 | last_failure: the renderer is DONE and rendered; what remains is AUTHORING -- one `svm set` per open box (47 of the 80 still carry no `sv` tag, 79 have no manifest in the store) and 2 plans that state no intention at all. Not a renderer defect, and every render COUNTS them. --> `render` writes `MASTER_PLAN.md` in `plans/`, recursively: goal →
      plans → tasks, each task with its sv, plan ref and `eta_turns`, plus the open/pass counts.
      **SV IS MANDATORY FOR EVERY ENTRY — owner, 2026-09-29, verbatim:** «в мастерплане sv для каждого
      субплана, таска или линка обязателен, чтобы было четко ясно — нафига это все и с чем это
      коррелирует». So `render` emits the entry's OWN vector for every plan, every task and every link it
      prints, and an entry whose vector is absent is rendered as MISSING — never as a bare title, because
      absence of an oracle reads as FALSE. A plan's vector is read from its own `<!-- intention: … -->`
      header (that header is the one home; a retyped copy is a second source), a task's from the SVM
      store. The end state the owner named is the point of it: any agent picks the plan up on autopilot
      and works in the right key without guessing — so the file must read correctly for an agent that has
      never seen this session. Acceptance: the file lives IN `plans/` (owner, 2026-09-30: «master plan
      должен быть в планах, а не в корне иначе его никто читать не будет»), is excluded from the plan
      scanner as canon like `plans/README.md` — `NON_PLAN_FILES` in `util/plan-status.ts`, so neither the
      status report nor `reconcilePlans` can ever file it into `plans_completed/` — a second render
      immediately after the first is byte-identical, **no rendered plan or task lacks its sv**, and **the
      goal at level 0 carries its own vector**: a rule every entry obeys cannot be one the top of the tree
      exempts itself from (an outside reader asked exactly that, 2026-09-30). `masterPlanCoverage` pins the
      reciprocal: every plan under `plans/` is named in the rendered file. Until `render` lands,
      `plans/MASTER_PLAN.md` carries hand-derived vectors with their derivation stated in the file itself.
  - **IN PROGRESS — the DERIVATION landed** (`renderBody` in `session/svm.ts`, `summarize()`, and
    `parsePlanFiles` split out of `collectPlanState` in `util/plan-status.ts` so the renderer gets the whole
    set rather than the three-plan head surface), and it was **MEASURED against the real repository** instead
    of assumed (`experiments/2026-09-30_svm-render/probe.ts`; the body is written as an artifact,
    `body.md`, 12 999 bytes / 128 lines): **15 plans · 61 open boxes · 2 plans with NO `<!-- intention -->`
    header · 61 of 61 open boxes with NO `<!-- sv: … -->` tag · 61 of 61 with NO manifest in the store ·
    `gapsBefore: []`** (the map names every plan — the coverage fix of `831e05d82e` holds).
    ⇒ The acceptance «no rendered plan or task lacks its sv» is **not yet satisfiable in this repository**:
    the vectors the render is supposed to READ do not exist yet, and the render prints MISSING for every one
    of them, correctly. That is AUTHORING work — one `svm set` per box, one header per plan — and it is this
    task's real remainder, not a renderer defect.
  - **The renderer's own test caught a real defect before the commit**: it printed `manifest: undefined`,
    because it addressed `record.dominant` while the store returns the RAW record whose dominant is a LINE
    INSIDE `sv`. Two readers of one store with two shapes; `summarize()` is now the single one, used by both
    `readNote` and `renderBody`.
  - Oracles: `bun test test/session/svm.test.ts` → **7 pass / 0 fail** (`20260930T011153Z_13ce0026`, the new
    case asserts read-from-source, MISSING-for-absent, and byte-identical re-render); `bun typecheck` →
    exit 0 (`20260930T011205Z_832da94f`). Still OPEN in this task: the **`svm render` verb** (the tool writes
    the file across `RENDER_MARKER`, refusing a file with no hand-owned head so the GOAL is never invented),
    and the authoring of the missing vectors named above.
  - **LANDED — the verb, and the FIRST REAL RENDER.** `applyRender` lives in `session/svm.ts` and the verb
    `svm read|set|render` is its only surface; the operation is in ONE place, so the probe that rendered the
    real repository (and any re-render) exercises the SHIPPED path rather than a copy of it.
    `plans/MASTER_PLAN.md` now has the split the design named: the hand-owned head (goal + rules + standing
    rules) through the `RENDER_MARKER`, and the generated body below it — **22 233 bytes, 240 lines**.
    The first render's own report (`20260930T013912Z_2d8a1166`): **15 plans · 71 open boxes · 2 plans with no
    `intention` · 52 of 71 boxes with no `sv` tag · 71 of 71 with no manifest · `gapsBefore` named 14 plans the
    map did not mention** (the 15th counted as named only because the head's prose mentions it — the check is a
    text-contains, by design and by documentation).
    **And the movement is the point:** `missingTaskSv` was 61 of 61 an hour ago and is 52 of 71 now — vectors
    are being WRITTEN INTO THE SOURCES while this task sat open, which is exactly what printing MISSING
    instead of hiding it is for.
  - Oracles: `bun test test/tool/svm.test.ts test/session/svm.test.ts` → **12 pass / 0 fail**
    (`20260930T013759Z_58750ed5`) — including that a refusal writes NOTHING at all, that the hand-owned head
    survives a render verbatim, and that a re-render is byte-identical; `bun typecheck` → exit 0
    (`20260930T013834Z_39205702`); the real render run: `20260930T013912Z_2d8a1166`.
  - **A DEFECT THE ACCEPTANCE CAUGHT IN MY OWN DESIGN:** the first version put `gapsBefore` INTO the body — and
    a body that reports the previous state of the file it generates changes the instant it is written, so a
    re-run could never be byte-identical. Measured, not argued: the second render differed from the first on
    that one line. A DELTA belongs in the tool's report; the body states only what is true NOW. Both halves are
    asserted now.
  - REMAINDER: the manifests are authoring work (one `svm set` per open box), and 2 plans still state no
    intention at all. Both are now COUNTED by every render instead of being invisible.
  - **WHY THIS BOX IS `[ ]` AND NOT `[~]`.** `[~]` marks a task the agent **decided NOT to do** — that is its
    defined meaning in this repo (`plans_completed/2026-09-24_open-boxes-slot.md`: «a task not done is closed
    `[~]` with its reason»), and `getPlanStatus` reads `[x]` and `[~]` alike as complete, so a plan whose last
    box is `[~]` is one the mover files into `plans_completed/`. This box is WORK WAITING, not work declined:
    written as `[~]` it made the plan read as finished, `planstatus` reported `plans/2026-09-29_svm-tool-and-master-plan.md`
    as `misplaced`, and `reconcile` would have carried a live remainder out of `plans/`. A pending box is `[ ]`;
    `last_failure` / `attempts` / `done_pct` are the fields that say WHY it is still open.
- [x] ✓ **S6 — the fold carrier.** DONE 2026-09-30. `SVM.renderFoldBlock(worktree)` (with `svm render`) renders the
      map AT the fold — the same two sources, through the same `renderBody` — and the compaction head carries it as
      the LAST block, after the recent messages and after the closing pointers, so the fresh tail reads off a map of
      the tree rather than off the middle of the last task. The block's header is owned by the builder and the
      caller paints only into the body: one spelling of the header.
      TWO ENABLING DECISIONS, both forced by where this runs:
      (a) `renderBody` is now SERVICE-FREE and no longer an `Effect` — `Storage` is not in `SessionCompaction`'s
      layer, and adding it would propagate a requirement into every provider of compaction (the trade
      `tool/memory.ts` and `readNote` name and answer the same way). Every input it reads is a plain file; the
      record read is `readRecord`, addressing the store's OWN mapping (`Storage.keyFile`), so reader and writer
      cannot drift in spelling.
      (b) `storedRecord` became the exported `readRecord(planFile, taskId)`, keyed through `taskKey` — the same
      function the WRITER uses. The enumeration held a plan DIRECTORY and composed the key beside it: a second
      spelling of one mapping, which is the drift `keyDir`/`keyFile` exist to prevent.
      Absence is VISIBLE two ways: a fold that carried no render prints MISSING (the builder's fallback), and a
      render that fails prints UNAVAILABLE with its reason (`renderFoldBlock` never throws — the fold is the
      boundary, and a throw would take the boundary with it).
      Oracles: `bun test test/session/svm.test.ts test/session/summary-block-shape.test.ts
      test/session/fold-determinism.test.ts test/tool/svm.test.ts` → **33 pass / 0 fail** (`20260930T032653Z_1f9668f8`);
      `bun typecheck` → **exit 0** (`20260930T032648Z_4d3c7acc`); LIVE measurement on the REAL repository
      (`experiments/2026-09-30_s6-fold-carrier/check.ts`, `20260930T032829Z_3c60c493` then `20260930T032920Z_d099c720`):
      the block is a real render (15004 then 14853 bytes, never UNAVAILABLE), it names 15 real plans and 68 then 67
      open boxes, and **m\* ends with it** — `true` in BOTH runs.
      THE TWO RUNS ARE THE PROOF THAT IT IS NOT A COPY. The first measured the block byte-identical to the body of
      `plans/MASTER_PLAN.md` below the marker (`true`): both derived from the same state. The second measured them
      DIFFERENT (`false` — 14853 bytes against the file's 15004, 67 open boxes against 68), because between the runs
      S6's OWN box was closed and the file had not been re-rendered yet. A carrier that inherited a copy would have
      matched the file; this one was FRESHER than it. That divergence is exactly the property this box claims.
      First run of the oracles FAILED on my own test (`dir` used outside its `inTmpdir` scope — named exactly by
      tsgo and by bun, then fixed) — recorded because a red that names its own file is the cheap half of the
      oracle working.
- [x] ✓ **S5 — the plan-ref invariant.** DONE 2026-09-30. `SVM.resolvePlan` + `SVM.orphanManifests`
      (`session/svm.ts`) enumerate the store's own layout — a key IS `["svm","task",<planId>,<taskId>]`, so
      the directory is the plan and the file name is the task — and read a record's contents ONLY when its
      key does not resolve, to take its `plan:` literally. That is the predicate the box states («names a
      file that does not exist»), and the two tiers are what keep it from crying wolf: cheap while it
      resolves, exact when it does not. A record whose ref cannot be resolved is REPORTED, never dropped
      (the store has no `remove`, by design — this file's header).
      Reported on TWO surfaces, because the oracle named both: **the coupling line** every turn — a third
      carrier beside the vector and the map entry, one axis («every declared plan ref must resolve»),
      `<plan> <task> has no file on disk — the record outlived its plan (MOVED|DELETED)`, with the store's
      own count printed at zero beside the vector count, since one number must not answer two questions —
      and **`svm read`**, in the title and `metadata.planRef`, while `output` stays pure data (prose
      appended to it would make the tool unparseable to its own test). `MOVED` is kept apart from
      `DELETED`: the remedies differ, so they are never folded together. `Storage.keyDir` was split out of
      `keyFile` so the directory a key maps to has ONE spelling — the S3 defect was exactly two spellings
      of one mapping.
      Oracles: `bun test test/session/svm.test.ts test/session/vector-coupling.test.ts
      test/tool/svm.test.ts` → **22 pass / 0 fail** (`20260930T031801Z_15e39bef`), both halves asserted at
      both layers (an orphan is NAMED; a live record is NOT flagged); `bun typecheck` → **exit 0**
      (`20260930T031756Z_c1c9c5b6`); and a LIVE measurement of the real store
      (`experiments/2026-09-30_svm-orphan/check.ts`, `20260930T032010Z_5054c96f`): the real worktree gives
      `checked: 3, orphans: []` while the same three records against a directory with no `plans/` give all
      three as `deleted` — the enumeration reaches them, and it does not cry wolf on live ones.

## Smoke Tests

- Baseline (before S1): no way to ask «what is this task's vector and how far is it from done» other
  than reading prose out of the transcript.
- After S1/S2: `svm set T3 …` then `svm read T3` in a NEW process returns the same fields; `render`
  twice → identical bytes.
- After S3: a turn with no task SVM shows the missing line; with one, shows the dominant; and the
  synthetic-part count on the user message is asserted (it was the 2026-09-29 loop's lesson).
- Negative control: a task SVM pointing at a deleted plan file must be REPORTED, not dropped.
- After S5/S6: a captured summary row carries the manifest it was written with (read it back from the
  store, not from the transcript), and a folded `m*` renders the master plan last.

## Out of scope

- Nothing under `bin/`.
- No change to how plans are found or moved (`util/plan-status.ts` stays the owner of that).
- The kernel is not touched: SVM is already specified there; this plan is its runtime.
