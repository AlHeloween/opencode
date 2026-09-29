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

- [ ] **S1 — the store.** `SVMTask` record + `SVM.Store` over the existing LMDB/SQLite plane, keyed
      `svm:task:<planFile>#<taskId>`; `listMissing(plans)` returns tasks with no record. Acceptance:
      a record survives a process restart and `listMissing` names exactly the tasks without one.
- [ ] **S2 — the tool.** `svm read|set|render` as a native tool (`src/tool/svm.ts`), with the same
      `Tool.define` registry/`builtin`/`dsml-normalizer` spelling discipline as every other tool name.
      Acceptance: `set` → `read` round-trips every field; a task with no SVM is reported as missing,
      never invented.
- [ ] **S3 — the reminder.** One line in the existing turn status note: `svm: missing for <task>` (or
      the task's dominant when present). Acceptance: a turn whose current task has no record carries
      the line; a turn with one does not; the note is still delivered ONCE (the count assertion that
      `read.test.ts` already pins is the guard).
- [ ] **S4 — the master plan.** `render` writes `MASTER_PLAN.md` at the repo root, recursively: goal →
      plans → tasks, each task with its sv, plan ref and `eta_turns`, plus the open/pass counts.
      Acceptance: the file is outside `plans/`, `planstatus`/`reconcilePlans` ignore it, and a second
      render immediately after the first is byte-identical (it is derived, so it must be stable).
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
