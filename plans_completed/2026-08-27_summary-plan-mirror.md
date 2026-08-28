# Summary plan-mirror — task SVs from the master plan replace dead key_phrases

**Created:** 2026-08-27
**Status:** IMPLEMENTED <!-- workflow: lifecycle IMPLEMENTED | gate G9 -->
**Tree:** Local_Development (session changes uncommitted on top)
**reuse:** `util/plan-status.ts` (getPlanStatus/hasOpenItems), `IncrementalCheckpoint` row shape (`diffs`/`impact` precedent for Exact payloads), `extractSemanticVector`, `summaryRequestProse`

## Context

Layer-1 summaries (`s`) carry a `## Semantic Vector` section. The model writes
`dominant` + `key_phrases` with weights. Grounded finding (2026-08-27):
`keyPhrases` is parsed (`extractSemanticVector`, compaction.ts:544-559) but has
**zero consumers** — svHint passes only `dominant` (compaction.ts:581-583).
Dead tokens on every summary.

User decision (Alexander): **no invented key_phrases. The semantic vector must
be real.** A summary should mirror the master plan state — the task list with
their per-task semantic vectors (kernel `MASTER_PLAN_SCHEMA` defines `sv` per
task) — so summaries become reverse-searchable anchors:
search task-SV → hit `s` row → `sessionread` → Exact handles.

Doctrine fit: plan state is **system Exact** (same class as tool filediffs +
CodeGraph on `s`), never model-authored. The model keeps Inferred prose
(dominant, Goal, Key decisions, Current state); the system attaches the mirror.

## Contract (the design)

1. `## Semantic Vector` in model prose keeps only `dominant` — key_phrases die.
2. At sidecar capture, the system reads active plans (`plans/*.md`) and stores a
   `planState` Exact payload on the checkpoint row — mirroring the kernel
   MASTER_PLAN_SCHEMA goal/task state AND the GATED_WORKFLOW spine:
   ```
   { plans: [{ file, lifecycle, gate,
               goal: { sv[], done_pct },
               invariants: string[],
               tasks: [{ id, sv[], status, oracle, done_pct, attempts, last_failure }] }] }
   ```
   — workflow axis: `lifecycle` (DRAFT/ACTIVE/EXECUTING/VERIFYING/
   IMPLEMENTED/COMPLETED/INVALIDATED from the plan Status line), `gate`
   (current G1..G9 position from a plan-level tag), per-task `oracle`
   ([x]⇒PASS stamped at G8, [~]⇒PARTIAL, [ ]⇒PENDING) — so a summary answers
   «где мы в спайне», not just «что в задачах» (user directive 2026-08-27).
2b. **Kernel-native vocabulary (user directive 2026-08-27):** the mirror uses
   the kernel's own anchors verbatim — `@GATE_1_GROUND..@GATE_9_CLEAN_STATE`,
   lifecycle enums, epistemic statuses, rule names (`@INFOMARK_SEP`,
   `@PLAN_BINDING`, `@CLOSURE_PROOF`). Post-compact the model recognizes the
   block as native — zero new format to learn.
2c. **Ride the Exact stamp:** planState renders into the `s` Exact stamp block
   (`formatExactSystemStamp` path) → folds into `m*` → **model-visible after
   every compact**. The TUI panel is the human twin of the same payload.
3. Plan file convention: task lines carry trailing metadata tags, e.g.
   `- [ ] **T3 — plan mirror capture** <!-- sv: plan,parse,state | done_pct: 0 | attempts: 0 | last_failure: - -->`
   plus a plan-level workflow tag near Status:
   `<!-- workflow: lifecycle EXECUTING | gate G7 -->`
   plus an optional plan-level `## Invariants` bullet list. Missing tags degrade
   gracefully (lifecycle from Status default ACTIVE, gate unknown, attempts=0,
   empty sv, no invariants). Plans without tags get a plan-level entry only.
4. Mirror renders into the LAYER-1 display panel (synthetic+ignored): stage,
   attempts/last_failure (only when >0), invariants — so a reopened session sees
   the real state, and task sv strings are searchable via messagesearch.
5. Old summaries with key_phrases stay readable (parser ignores phrases).

## Tasks

- [x] **T1 — prose: drop key_phrases.** <!-- sv: prose,dominant,template --> `summaryRequestProse` (compaction.ts:565-596):
  SV section = `dominant` line only; drop the key_phrases format block.
  files: compaction.ts. oracle: typecheck; grep `key_phrases` → only legacy notes.
- [x] **T2 — parser: dominant-only.** <!-- sv: parser,checker,semantic-vector --> `extractSemanticVector` stops parsing
  phrases; `SemanticVector` loses `keyPhrases` (grep-proven zero consumers).
  Checker `MIN_SUMMARY_SECTION_CHARS["Semantic Vector"]` 40 → 25 (dominant
  line alone must pass). files: compaction.ts. oracle: typecheck + unit tests.
- [x] **T3 — plan mirror capture.** <!-- sv: plan,parse,state,mirror --> New `collectPlanState()` (util/plan-status.ts
  neighborhood): parse `plans/*.md` → per-task `{id, sv[], status, oracle,
  done_pct, attempts, last_failure}` from checkboxes + trailing metadata tags,
  plan-level `{lifecycle, gate, goal sv, done_pct, invariants[]}` from Status
  line + workflow tag + Invariants section. Store as `planState` field on
  `IncrementalCheckpoint.save` (prompt.ts capture path). files:
  util/plan-status.ts (or session/summary.ts), incremental-checkpoint.ts,
  prompt.ts. oracle: typecheck + new unit test (fixture plan with/without
  metadata tags → payload shapes).
- [x] **T4 — render mirror into Exact stamp + panel.** <!-- sv: stamp,panel,spine --> Extend the Exact stamp
  block with a `## Plan state` section (kernel-native anchors): spine line
  `spine: G1 done · G4 done · G7 active · G8 pending (@GATE_8_ORACLE)`,
  lifecycle+gate, per task — id, oracle, attempts/last_failure (>0 only), sv;
  invariants. `formatLayer1SummaryDisplay` shows the same block in the UI
  panel. files: compaction.ts, prompt.ts. oracle: unit test asserting the
  folded stamp contains spine/lifecycle/task-sv strings (post-compact pickup).
- [x] **T5 — tests + fixtures.** <!-- sv: tests,fixtures,regression --> Update fixtures writing key_phrases
  (prompt.test.ts:759/843/901 bodies, summary.test.ts:328) to dominant-only;
  add plan-mirror tests (T3/T4). files: test/session/*.ts. oracle: bun test
  test/session (serial).
- [x] **T6 — docs.** <!-- sv: docs,compaction-contract --> compaction.md: "What one summary is" table — SV section =
  dominant; add planState row to the Exact table; note reverse-search path.
  files: docs/compaction.md. oracle: grep review.

## Smoke Tests

- baseline: `bun typecheck` (from packages/opencode) → exit 0 (current tree PASS, verified 2026-08-27)
- post: `bun typecheck` → exit 0
- post: `bun test test/session/summary.test.ts test/session/compaction.test.ts --timeout 20000` → 0 fails
- blast radius: compaction.ts prose/parser/checker, plan-status, incremental-checkpoint schema (+1 optional field), prompt.ts capture path, display formatting, session tests, compaction docs. No DB migration (checkpoint rows are schemaless payloads — verify before T3).

## Premises (all Exact, this session)

- keyPhrases has zero consumers (grep 2026-08-27)
- checker minima live in `MIN_SUMMARY_SECTION_CHARS` (compaction.ts:437-441)
- checkpoint rows store payloads (`diffs`, `impact` precedent)
- plan-status machinery exists (util/plan-status.ts, tested)
- retry loop merges sections by heading (prompt.ts:882-926)

## Open questions

- plan `sv=` convention is new — old plans degrade to plan-level entries (accepted).
- `IncrementalCheckpoint` payload shape: confirm schemaless field addition before T3.

## Follow-ups (right after this plan completes — user directive 2026-08-27)

- **LSP effect-lint noise in `prompt.ts`**: ~10 "Effect must be yielded
  (floatingEffect)" diagnostics on lines NOT touched by this plan; `tsgo`
  typecheck is green (exit 0, verified 2026-08-27). Investigate: lint rule vs
  deliberate floating patterns — fix call sites or scope the rule. Do this
  immediately after the plan's tasks are done.

## Verification protocol (user directive 2026-08-27)

- After implementation: **check the corresponding tests** —
  `test/session/compaction.test.ts`, `test/session/summary.test.ts`,
  `test/session/prompt.test.ts`, `test/util/plan-status.test.ts` (T3/T4 surface)
  — and **correct fixtures/assertions** to the new contract (dominant-only SV,
  planState payload, panel block).
- Gate: corrections land **only after successful smokes** (typecheck exit 0 +
  targeted `bun test` green). No test edits on a red baseline.
- Any probe/scratch/repro code for this verification lives in `experiments/`
  (ISO-prefixed filenames), never in `test/` or repo root — per WORKSPACE_LANES.
