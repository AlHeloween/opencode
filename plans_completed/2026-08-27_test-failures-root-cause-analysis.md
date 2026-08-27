# Root-Cause Analysis: 5 Remaining Test Failures in `test/session/prompt.test.ts`

Date: 2026-08-27
Scope: static analysis of runner/run-state/processor/storage paths + evidence from
instrumented runs (2026-08-25/26 logs). No fixes applied in this document.
Stable baseline: 37 pass / 5 fail / 13 skip, tsgo clean, working tree clean.

## 0. Executive Summary

The 5 failures collapse into **three independent root causes**:

| # | Root cause | Tests hit | Confidence |
|---|---|---|---|
| RC-1 | `ensureRunning` **supersedes** same-session concurrent callers instead of **joining**; superseded caller's `done` is never force-settled when the interrupted fiber wedges in native I/O | `cancel with queued callers`, `concurrent loop callers all receive same error result`, `prompt submitted during an active run` | Exact (code path proven; wedge proven by force-fail experiment) |
| RC-2 | `runner.cancel` awaits `Deferred.await(run.done)` **unbounded**; a fiber wedged in a never-ending LLM stream never exits, so `done` never settles | `cancel with queued callers` (the 30s stall itself) | Exact (runner.ts:222-230 vs hardened ensureRunning:146-151 asymmetry) |
| RC-3 | Test poll reads via raw `MessageV2.filterCompactedEffect` → `Database.use()` from a **detached fiber**, while all passing polls read via `sessions.messages` service | `running task tool preserves metadata` | Hypothetical→decisive 5-min experiment defined (§3.3) |

Plus one unclassified: `keeps stored part order stable` — creation order is provably
correct in code (§3.4); exact failing assertion must be captured before deeper analysis.

Mandatory hygiene found during analysis: 7 `[dbg]` console.error probes are **committed**
in `src/session/prompt.ts` (lines 1824, 1838, 1843, 1845, 1906, 1910, 1927). Strip before
any next commit.

---

## 1. Architecture Chain (grounded, file:line)

```
prompt.loop(sessionID)
  └─ SessionRunState.ensureRunning(sessionID, onInterrupt, work)   run-state.ts:96
       └─ runner(sessionID, onInterrupt)                           run-state.ts:52
            · Map<SessionID, Runner> per InstanceState             run-state.ts:36
            · same session ⇒ SAME Runner instance ⇒ "join by sharing"
       └─ Runner.ensureRunning(work)                               runner.ts:135
            · state=Running ⇒ SUPERSEDE:                           runner.ts:140-162
                - Fiber.interrupt(old).timeout(3s).ignore.fork     (fire-and-forget)
                - startRun(new work)
                - old run's `done`: NOT settled by this path
            · state=Idle ⇒ startRun
  └─ awaitDone(done) → onInterrupt (lastAssistant) on Cancelled     runner.ts:65-66

runLoop step (prompt.ts:1621-2631)
  ├─ assistant message persisted                    prompt.ts:1926
  ├─ processor.create(...).pipe(onInterrupt→finalize) prompt.ts:1939-1949
  │    └─ stream consumed inside processor; NO AbortSignal wired to LLM call
  │      (processor.ts has zero abort/signal references; llm.ts:312 receives
  │       `abort` only when a caller passes one — loop passes none)
  └─ tool-call event → updateToolCall → session.updatePart          processor.ts:548

session.updatePart (session.ts:794) → SyncEvent.run(PartUpdated)
  └─ runBatch → Database.projectTransaction(..., {behavior:"immediate"})  sync/index.ts:338-364
       · SYNCHRONOUS single SQLite TX: projector + EventTable + seq. Committed on return.
       · no "sync event dropped" warnings in any captured log (grep verified)

Reads:
  · filterCompactedEffect: Database.use(...)       message-v2.ts:1370
      └─ LocalContext tx → currentProjectCtx → Fiber.getCurrent().context[InstanceRef]
      └─ detached fiber (Effect.runPromise from test poll) ⇒ all three likely missing
  · sessions.messages: projectDb(...)              session.ts (service path)
```

Key wedge mechanism (RC-1/RC-2): the test mock's `llm.hang` produces
`Stream.never` (llm-server.ts:428). The loop consumes it with **no abort signal
attached to the underlying HTTP body**. `Fiber.interrupt` cannot complete a fiber
blocked on a native promise that never settles ⇒ `Effect.onExit` never fires ⇒
`done` never settles. Proven empirically: the force-fail(Cancelled) experiment
settled `done` directly and dissolved all hangs.

## 2. Per-Test Causal Chains

### 2.1 `cancel with queued callers resolves all cleanly` (30s timeout)

1. A starts run (llm.hang) → fiber A wedged in stream read.
2. B's loop supersedes: fire-and-forget interrupt on A (3s cap, ignored) → A's
   `done` **never settles** → caller A awaits forever (already lost, independent
   of cancel).
3. B wedges the same way.
4. `prompt.cancel` → `state.cancel` → `Runner.cancel` Running case:
   `Fiber.interrupt(B.fiber)` (awaits death — hangs or no-ops on wedge) then
   `Deferred.await(B.done)` — **unbounded** (runner.ts:226). Test times out.

Fix direction (two layers):
- **L1 (hardening)**: cancel mirrors ensureRunning's pattern — fire-and-forget
  interrupt + bounded `Deferred.await` (5s) + unconditional idempotent
  `Deferred.fail(done, Cancelled())`. `Deferred.done` on a settled deferred is a
  no-op, so a late real exit cannot double-settle; late real errors are dropped
  only for fibers that were wedged past the window (acceptable; document).
- **L2 (architecture)**: RC-1 join semantics — B never supersedes A; both callers
  await the same `done`; one cancel settles everyone. L1 stays as wedge backstop.

### 2.2 `concurrent loop callers all receive same error result` (fast fail ~8s)

Under supersede: B kills A mid-run. A's resolution path = onInterrupt →
`lastAssistant` **at settle time** — racing B's writes (empty or B's assistant).
With `llm.fail` the assistant may not exist yet ⇒ A rejects ("Impossible",
prompt.ts:1618) ⇒ `a.info.id` throws. Under join: both callers share one run;
the run converts the stream error into a persisted error-assistant (TUI-visible
bubble semantics) ⇒ both receive the same message id. Same fix: RC-1 join +
verify runLoop returns (not throws) on stream error — if it currently throws,
convert to error-assistant return (that is also the correct product behavior).

### 2.3 `prompt submitted during an active run is included in the next LLM input` (~10s fail)

`prompt()` ends with `return yield* loop(...)` (prompt.ts:1609) ⇒ mid-run second
prompt **supersedes** the held first run. Test expects queue semantics: first
turn completes, loop's next step (the `while(true)` reads messages per step)
picks up the second user message. Under supersede: only 1 assistant ever
persists; `assistants.length===2` fails. Under join: second prompt persists its
message, joins the active run, loop runs two turns, all assertions hold by
construction. Same fix: RC-1.

Product-correctness note: join matches the loop's per-step message-assembly
design and sst/opencode's queue behavior; supersede remains available via the
explicit `cancel` API.

### 2.4 `running task tool preserves metadata after tool-call transition` (25s poll timeout)

Proven: stamp executes (probe `task.stamp enter`), write commits synchronously
(SyncEvent immediate TX; zero `no project context` warnings in logs).
Suspect: the poll reads via `Effect.runPromise(MessageV2.filterCompactedEffect)`
from a detached async loop — `Database.use()` resolves the project through
LocalContext/fiber InstanceRef (db.ts:290-304), which a detached fiber may not
carry; result: read against the wrong/no project DB or a stale snapshot, while
the sibling test polling via `sessions.messages` (service path) works.
Decisive experiment: swap the poll to `sessions.messages` (or call
filterCompactedEffect inside the service context). If stamp becomes visible →
test-harness artifact; product behavior was never broken (TUI consumes
PartUpdated bus events, not raw polls). If still invisible → write-side trace
with `PRAGMA database_list` on both paths (next discriminator).

### 2.5 `keeps stored part order stable when file resolution is async` (~5s fail)

Code path is provably order-correct: `Effect.forEach(..., {concurrency:
"unbounded"})` assembles results in input order (prompt.ts:1521-1523);
`assign()` allocates `PartID.ascending()` sequentially (monotonic counter,
id.ts:57-72 — same-ms counter discipline verified); persistence is a sequential
`updatePart` loop; read sorts by `PartTable.id` (message-v2.ts:1324).
Therefore ID/concurrency ordering hypotheses are **ruled out**. Remaining:
assertion content mismatch (e.g. the Read-tool failure text changed) — the
exact failing expectation has not been captured in current runs. Action: run
the single test, read the actual diff, then classify.

## 3. Fix Plan (post-approval)

1. **RC-1 join** in `Runner.ensureRunning` Running/RunningThenRun: return
   `awaitDone(existingRun.done)` when the caller is a same-session loop/prompt
   (no new work) — supersede becomes an explicit API (`interruptAndReplace`)
   reserved for cancel-redirect flows. Estimated: runner.ts + run-state.ts
   signatures, ~40 lines; 3 tests.
2. **RC-2 bounded cancel**: runner.ts cancel cases — fire-and-forget interrupt,
   5s bounded await, idempotent force-fail. ~20 lines; backstop for 2.1/2.3.
3. **RC-3 poll swap** in running-task-tool test: `sessions.messages` path.
   5 min + run; classify product-vs-harness.
4. **2.5 capture**: single-test run, read exact assertion diff, classify.
5. **Hygiene**: strip 7 `[dbg]` lines from prompt.ts; add `no-console` guard
   rule note (they were committed by an instrumentation commit whose revert
   missed src/).
6. Full file run ×2 + native-mode confirmation; update `_progress_log.md`.

Order: 5 → 3 → 4 (cheap discriminators) → 1 → 2 (architectural) → 6.

## 4. Risks / Tradeoffs

- Join changes public behavior of `ensureRunning` for concurrent callers: any
  caller relying on supersede-to-restart (none found in repo grep outside
  cancel flows) would need `interruptAndReplace`. Grep found none.
- Force-fail past the 5s window drops the wedged fiber's eventual real error
  for its own caller (they already got Cancelled). The fiber may still leak
  until scope close; scope finalizer uses the same bounded pattern (no deadlock).
- `Deferred.fail` idempotence is the load-bearing safety property; add a unit
  comment at each call site.
