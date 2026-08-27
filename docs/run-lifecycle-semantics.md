# Session run lifecycle semantics

**status:** production · **last_verified:** 2026-08-27 · **owner:** Local_Development

Two layers of truth, same as [`compaction.md`](compaction.md):

1. **Intended contract** (below) — the lifecycle that this fork enforces.
2. **Code Exact** — `runner.ts` / `run-state.ts` / `prompt.ts` / `session.ts` as of commit `8f8d1026f0`.

If they disagree, do not paper over it: fix code toward the contract or mark the gap here.

**RCA source:** [`plans_completed/2026-08-27_test-failures-root-cause-analysis.md`](../plans_completed/2026-08-27_test-failures-root-cause-analysis.md)

---

## 0. Architecture at a glance (2026-08-27)

| Mechanism | File | Contract |
|---|---|---|
| Join | `effect/runner.ts` `ensureRunning` | same-session callers share the active run's `done` |
| Bounded cancel | `effect/runner.ts` `cancel` | cancel ALWAYS returns; wedged fibers cannot stall callers |
| Queue continuity | `session/prompt.ts` `runLoop` break gate | mid-run prompts are consumed by the running loop |
| Event identity | `session/session.ts` `patch` | every `session.updated` carries projectID/directory |
| Abort chain | `session/llm.ts` `stream` → `run` → `streamText` | controller aborts when the consuming scope closes |

---

## 1. Join, not supersede

`SessionRunState` keeps one `Runner` per session (`Map<SessionID, Runner>`). Concurrent
`prompt.loop` / `prompt` callers arrive at `Runner.ensureRunning(work)`:

```
state Idle          → startRun(work)                     (caller owns the run)
state Running       → awaitDone(st.run.done)             (caller JOINS)
state RunningThenRun → awaitDone(st.run.done)            (joins the pending run)
```

**Removed:** the old supersede path (fire-and-forget interrupt + fresh run for the new
caller). Reasons, all tested:

- The session loop re-reads messages **every step** — it is designed to consume
  mid-run submissions itself. Supersede killed the held turn instead of feeding it.
- A superseded caller's `done` never settled when its fiber wedged in native I/O
  → callers hung forever (`cancel with queued callers` 30 s stall).
- The `onInterrupt → lastAssistant` fallback raced the new run's writes.

Supersede remains available deliberately: `cancel` first, then a fresh call.

**Runner.make has exactly one consumer** (`run-state.ts:59`) — no other subsystem
depended on supersede (grep-verified 2026-08-27).

## 2. Cancel: three phases, guaranteed return

```ts
// runner.ts cancel, Running case
yield* Fiber.interrupt(st.run.fiber).pipe(Effect.timeout("3 seconds"), Effect.ignore, Effect.forkIn(scope))
yield* Deferred.await(st.run.done).pipe(Effect.timeout("2 seconds"), Effect.ignore)
yield* Deferred.fail(st.run.done, new Cancelled()).pipe(Effect.ignore)   // idempotent
yield* idleIfCurrent()
```

1. **Fire-and-forget interrupt** — a fiber parked on a native promise that never
   settles cannot be killed by Effect; waiting on its death stalls cancel.
2. **Bounded wait** — fibers that settle naturally keep their real result/error.
3. **Force-fail** — idempotent: `Deferred.done` on a settled deferred is a no-op, so a
   late real exit cannot double-settle. Past the window the caller gets `Cancelled`
   and the real error is dropped **for wedged fibers only**.

**Why fibers wedge at all** — the abort chain is verified end-to-end:
`llm.stream` controller (llm.ts:836-841) → `run({abort})` → `streamText({abortSignal: input.abort})`
(llm.ts:779). The wedge is runtime-shaped: a dead socket (`llm.hang` mock = `Stream.never`)
means zero bytes flow, and abort() does not wake a parked body read that never receives
data. The keep-alive mock experiment (1 s SSE comments, 2026-08-27) was **reverted**: it
flipped abort semantics and broke the `records-aborted` contract. The no-data wedge is a
real edge (dead provider socket); bounded force-fail is the designed answer.

## 3. Queue continuity at the break gate

```ts
// prompt.ts runLoop
if (result === "stop" && !sidecarCaptured) {
  const tail = yield* sessions.messages({ sessionID })
  const lastMsg = tail.at(-1)
  if (lastMsg?.info.role === "user" && lastMsg.info.id !== lastUser.id) return "continue"
  return "break"
}
```

A user message submitted while step N streamed is consumed by step N+1 of the SAME run.
Known upstream race (message lands between the check and Idle) is covered by the next
prompt: with join it re-opens a run and is consumed there.

## 4. Project identity rides on events

`SyncEvent.resolveProjectInfo` falls back to ambient ALS (`Instance.currentMaybe`) only
when the event data lacks project fields. Effect fibers resume on arbitrary async
continuations — ALS zones do not follow them, so ALS-dependent writes fail
asymmetrically (fiber A ✓, fiber B ✗ — observed as `SyncEvent.runBatch: no project
context`). Rule, matching `updatePart`:

> **Every SyncEvent payload carries `projectID` + `directory` from
> `InstanceState.context` (Effect FiberRef — fiber-resident).** `Session.patch` /
> `UpdatedEventSchema` fixed 2026-08-27; touch/setTitle/setPermission inherit via patch.

Do not add new sync events without the project fields.

## 5. Test contract map

| Test | Mechanism under contract |
|---|---|
| `running task tool preserves metadata…` | stamp is written synchronously (`SyncEvent.runBatch` immediate TX); poll matches by tool part, not agent identity string (`build` vs `build_mode`) |
| `cancel with queued callers…` | join + bounded cancel; ~11 s |
| `concurrent loop callers…` ×2 | join; stream errors persist as error-assistant |
| `prompt submitted during an active run…` | queue-check; poll runs **in-context** (detached `Effect.runPromise` loses the database LocalContext → `Database.use` throws NotFound off-fiber) |
| `keeps stored part order stable…` | forEach assembles in input order; PartID monotonic; UTC suffix on non-synthetic text parts |

## 6. Verify

```bash
cd packages/opencode
bun run typecheck                                   # 0 errors
bun test test/session/prompt.test.ts                # 41 pass / 0 fail / 13 skip
bun test -t "cancel with queued callers" test/session/prompt.test.ts
python tools/cg.py ensureRunning --file src/effect/runner.ts   # structural pack
```

Verified twice on 2026-08-27 (full2.log, full3.log). Single environmental flake observed:
`EBADF uv_spawn` under fd pressure after ~6 min (green solo) — not a code defect.

## 7. Deferred

- `Database.use` off-fiber throws `NotFound` — a fragility, not a defect; caller-side
  discipline today (in-context polls).
- `provider.getModel` typed-failure refactor (fallback-to-parent masks config-miss) —
  postponed deliberately; see `_progress_log.md` 2026-08-26/27 entries.
- Dead-socket abort: undici/Bun parked-read wakeup — handled by force-fail, revisit if
  Bun ships wake-on-abort for idle SSE bodies.
