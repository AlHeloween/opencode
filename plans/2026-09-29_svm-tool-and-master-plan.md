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
- [ ] **S4 — the master plan.** `render` writes `MASTER_PLAN.md` at the repo root, recursively: goal →
      plans → tasks, each task with its sv, plan ref and `eta_turns`, plus the open/pass counts.
      **SV IS MANDATORY FOR EVERY ENTRY — owner, 2026-09-29, verbatim:** «в мастерплане sv для каждого
      субплана, таска или линка обязателен, чтобы было четко ясно — нафига это все и с чем это
      коррелирует». So `render` emits the entry's OWN vector for every plan, every task and every link it
      prints, and an entry whose vector is absent is rendered as MISSING — never as a bare title, because
      absence of an oracle reads as FALSE. A plan's vector is read from its own `<!-- intention: … -->`
      header (that header is the one home; a retyped copy is a second source), a task's from the SVM
      store. The end state the owner named is the point of it: any agent picks the plan up on autopilot
      and works in the right key without guessing — so the file must read correctly for an agent that has
      never seen this session. Acceptance: the file is outside `plans/`, `planstatus`/`reconcilePlans`
      ignore it, a second render immediately after the first is byte-identical, and **no rendered plan or
      task lacks its sv — asserted by the test, not eyeballed**. Until `render` lands, `MASTER_PLAN.md`
      carries hand-derived plan vectors with their derivation stated in the file itself.
- [ ] **S6 — the fold carrier.** At the Layer-2 fold the rendered master plan is emitted AFTER every
      summary block and after the window's messages, as the last carrier before the fresh tail
      (owner, 2026-09-29). Acceptance: a folded `m*` shows the master plan last; it is a RENDER of the
      same two sources S4 uses, so a stale copy cannot be inherited — and its absence is visible
      (absence of an oracle reads as false).
- [ ] **S5 — the plan-ref invariant.** A task SVM whose `plan:` names a file that does not exist is
      reported, not silently kept — the same coupling check `statusNote` already runs for vectors.

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
