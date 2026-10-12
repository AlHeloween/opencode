# CUA-CONTEXT-20261011 r1 — bounded stabilization of the cached execution context

Ticket: 16d37be2f4b37cdeed52a98535c3210cb5938d15 (smit-opencode, epoch 1) · parent ae28f20fa35a0d88e603081e78193531f4e97508 · root c4005f4a3284758f2085332529c4ee44d277048f
<!-- intention: completed CUA capture cannot be consumed by a subsequent coordinate click within a tool loop -> verified current execution context for cached tools without changing provider catalog, permissions or capture safety -->

sv: Keywords: runtime-context 0.40, cua-freshness 0.30, catalog-stability 0.20, bounded-stabilization 0.10 · Semantic dominant: cached tool invocation must read the live execution context (messages) while the provider catalog stays frozen.

## Grounded mechanism (Inferred from source, run-verifiable)

- `session/prompt.ts:1656` `while (true)` is the step loop; inside it `msgs` is REBUILT every step (`:1663 msgs = [...cachedMsgs, ...newMsgs]`, `:1669` assign, `:1685 msgs = msgs.map(...)`, `:1837 msgs = yield* insertReminders(...)`) — a NEW array each step.
- `session/prompt.ts:1891-1918` caches `tools` for the whole turn when the agent name is unchanged; `SessionTools.resolve({ messages: msgs })` (`:1901`) runs ONLY on the cache miss, so the cached tool closures hold the step-1 array VALUE.
- `session/tools.ts:192-226` builds `Tool.Context` per call — `messageID: input.processor.message.id` is LIVE (processor is the stable handle) but `messages: input.messages` (`:200`) is the frozen value.
- `tool/cua.ts:443` passes `ctx.messages` into `cuaBoundClickArgs` → `:246-268` searches completed `cua` parts for `metadata.observation` and throws «There is no image observation for this target in this session» when absent.
- ⇒ A capture completed in step N is invisible to a coordinate click in step N+1 whenever the tools were resolved before it. That is the recorded ClientSoft failure.

## Envelope (authorized surfaces only)

- MODIFY_PROJECT: `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/tools.ts`, new `packages/opencode/test/session/tool-context-freshness.test.ts`.
- PLAN_WRITE: this plan, `docs/_progress_log.md`.
- MODIFY_CANDIDATE: `experiments/2026-10-11_cua-runtime-context/`, build output `dist/` via `_build.ps1`.
- Prohibitions kept: no bin, no kernel, no ClientSoft/BRS, no install/promote/commit/push, no ACL bypass, no schema/description/order change, no weakening of the CUA observation guard, no delegation.
- Budget: 55 calls / 35 steps / 30 min (ticket); returns BLOCKED with the exact remainder if the live-GUI oracle is out of scope.

## Tasks, claims, falsifiers

- **T1 — failing-capable baseline (RED).** Fixture `experiments/2026-10-11_cua-runtime-context/baseline.test.ts` replays the recorded class with the ACTUAL `SessionTools.resolve` + the ACTUAL `cua` tool: resolve with the step-1 array, then reassign the local array (exactly `prompt.ts:1663`) to include the assistant message carrying the completed capture part, then invoke a coordinate click.
  - claim: the click rejects «There is no image observation for this target in this session» — the stale-context defect, reproduced with real machinery. falsifier: the click finds the observation (RED fails to reproduce → premise not established → STOP with diagnostic, per brief).
- **T2 — minimal fix (lazy context, frozen catalog).** `SessionTools.resolve` accepts `messages` as an array OR an accessor; the per-call `Tool.Context` resolves it at call time; `prompt.ts` passes `() => msgs` / `() => visible`. Catalog, schemas, descriptions and order are untouched (fingerprint pin below).
  - claim: a tool resolved once in step 1 observes a message appended in step 2. falsifier: fingerprint change or a schema/描述 diff (then revert).
- **T3 — regression + negative controls (GREEN).** `packages/opencode/test/session/tool-context-freshness.test.ts`:
  1. fresh: capture present after reassignment → click passes the observation guard and fails later on geometry (`Coordinate click is outside the attached image`) — proves the observation was CONSUMED, with no CLI spawn (guard precedes `cli(...)`);
  2. empty history → «There is no image observation…»;
  3. wrong target (window pid ≠ args) → «There is no image observation…»;
  4. used capture (`captureAttempt === capture_id`) → «capture_id was already used for a click attempt».
- **T4 — focus suites.** `test/session/tools.test.ts` (array callers keep working), `test/tool/cua.test.ts` (binder + observation guards intact).
- **T5 — build.** `_build.ps1` via cmd_runner (absolute path), dist candidate only, state.json + full stdout log read.
- [x] **Sweep 2026-10-12 — every task above is done.** The oracle T3 names was re-run TODAY: `20261012T023453Z_42197756`, exit 0, `1 pass / 0 fail / 5 expect() calls` (4.51 s, one file per invocation). T1/T2 by the fix landed 2026-10-11, T4/T5 by their own recorded runs (`20261011T153023Z_bdf517f3`, `20261011T153043Z_9ad1e51a`, `20261011T153248Z_5cc0cfaa`). Closed by the plan-hygiene sweep (SW of `plans/2026-10-10_plan-hygiene-in-build-mode.md`) and moved to `plans_completed/`.

## Predictions BEFORE runs (divergence is a forecast error, logged)

- T1: RED with the exact message above (predicted PASS for the claim).
- T3.1: `outside the attached image`; T3.2-T3.4: the three named messages.
- T4: no new failures vs baseline of those two files.
- Catalog fingerprint: identical bytes for every tool name/schema before and after T2.

## Acceptance boundary (explicit)

- Source fixture/build PASS does NOT prove the ClientSoft live runtime fixed: that needs a live fixture on the candidate (capture → coordinate click in one loop) after a separately authorized candidate application. Until the live GUI oracle runs, parent acceptance stays BLOCKED; map/3D/POF are NOT declared fixed here.

## Baseline measured 2026-10-11 (RED reproduced with the real machinery)

`packages/opencode/test/session/tool-context-freshness.test.ts` (created here) drives the REAL
`SessionTools.resolve` + the REAL registered `cua` tool wrapper. No cua daemon is needed: the geometry
guard runs in TypeScript (`tool/cua.ts:299-301`) BEFORE the CLI spawn, so "the observation was
consumed" is observable without a capture. The only hand-reproduced piece is the loop's own variable
reassignment — the cited line `session/prompt.ts:1663`.

- RED (canonical): run `20261011T143318Z_81523870` — exit 1, 0 pass / 1 fail. A tool resolved at step 1
  rejects a coordinate click with `There is no image observation for this target in this session; take a
  fresh screenshot` even though the capture part IS present in the step-2 array. Mechanism CONFIRMED by
  execution, not only by reading.
- Control, same args, fresh array: reaches `Coordinate click is outside the attached image` (observation
  consumed). Run `20261011T143112Z_2b2f72d1` (0 fail) before the polarity was inverted to the contract.
- Fallibility measured: with the step-2 array passed to the FIRST resolve, the assertion flips to the
  geometry message — run `20261011T143133Z_3a613f69`, 0 pass / 1 fail. The test is not a silent green.

### Difficulties found (these gate T2, not T1)

1. **The primary evidence is NOT in this worktree's DB.** `msg_12a9f4605001…` / `msg_12a9f50a0001…`
   return 0 rows, and `capture_bea1bb1025e8442ea48efdebb524f784` appears only as QUOTED PROSE (the brief
   and my own reads) — never as a real `cua` part with `metadata.observation`. Session
   `ses_ed6ee8fd9ffeOnIKspxMUNfqEM` is absent. So attribution of the LIVE ClientSoft failure to this
   mechanism stays Unknown; only the MECHANISM is proven.
2. **Blast radius is NOT local to cua.** `ctx.messages` also feeds `tool/read.ts:212`
   (`instruction.resolve(ctx.messages, filepath, ctx.messageID)`), and `session/instruction.ts:88`
   documents behaviour that DEPENDS on the snapshot semantics. The plan's T2 claim/falsifier pins only
   the catalog fingerprint — it does not pin `read`'s dedup behaviour. Making `ctx.messages` live must be
   checked against that consumer before it lands.
3. **T1's design was in tension with its own brief.** The brief forbids «a model, itself recreating the
   cache defect»; T1 as written («then reassign the local array exactly as prompt.ts:1663») is that
   shape. This fixture keeps the real resolve + real wrapper and reproduces only the one cited
   reassignment line; it is a faithful partial integration, not a full-loop test. A full-loop test
   (capture in step 1, click in step 2 through the real turn) remains the stronger oracle for the FIX.
4. **The plan is invisible to planstatus** (its tasks are bullets, not checkboxes → 0 open boxes) and is
   untracked / unmapped in `plans/MASTER_PLAN.md`.

### Next (not done here)

T2 (lazy `ctx.messages`, frozen catalog) requires item 2 resolved first; the plan's envelope forbids
commit, so nothing was committed from this baseline.

## Fix landed 2026-10-11 (T2, minimal)

`session/tools.ts`: the resolve input's `messages` widened to `MessageV2.WithParts[] | (() => MessageV2.WithParts[])`
(`:107`); the per-call `Tool.Context` evaluates it (`:203`). Catalog, schemas, descriptions and order untouched —
the provider prefix is unchanged. `session/prompt.ts`: a turn-scoped `liveMessages` holder (declared `:1548`),
rebound to the step's `msgs` right after `insertReminders` (`:1842`), and the resolve call passes
`() => liveMessages` (`:1906`). Why a holder and not `() => msgs`: `msgs` is declared INSIDE the step loop, so a
closure over it would capture one iteration's binding and return that same array on every later step.

Oracles, all run from `packages/opencode`, one file per cmd_runner run:

- `test/session/tool-context-freshness.test.ts` GREEN `20261011T153008Z_2f4fe101` (1 pass / 0 fail / 5 expect) —
  the cached tool consumes a capture completed after its step, still refuses before it, and the ARRAY form keeps
  snapshot semantics.
- Baselines before the fix: `test/session/tools.test.ts` 2/0 `20261011T152829Z_786ff0a7`;
  `test/tool/cua.test.ts` 12/0 `20261011T152845Z_8c3712bd`.
- Regressions after: tools 2/0 `20261011T153023Z_bdf517f3`; cua 12/0 `20261011T153043Z_9ad1e51a`;
  instruction 16/0 `20261011T153043Z_18485bd4`.
- Final gates: `bun typecheck` exit 0 `20261011T153232Z_ebf6bb30`; `_build.ps1` exit 0 `20261011T153248Z_5cc0cfaa`
  (`✓ built in 28.82s`, smoke `10.0.1275`, `reasoning_prompt.txt` embedded, artifacts in `dist/`).
- `test/tool/read.test.ts` produced NO verdict (`bytes_written: 0`, process gone) — UNKNOWN, never green. It is
  also structurally blind to this change: it hand-builds its `Tool.Context` (`read.test.ts:38-47`, `messages: []`)
  and never calls `SessionTools.resolve`; its own header records the silence as a known property of the file.
- Commit: `7c4876f28a` — the owner's own commit («Tools/Skills update», which also carried the skills edits). It does
  NOT name this plan; this line is the link, because rewriting history is forbidden. The plan's boxes and this
  file's run ids are the durable record of what was verified.

Residual (named, not waived): this fixture reproduces the loop's CALL SHAPE; it does NOT pin `prompt.ts`, so a
revert of the loop to a bare array would still pass it — the guard for that is the full-loop oracle (capture in
step 1, click in step 2 through a real turn), still unbuilt. The live ClientSoft attribution stays Unknown
(difficulty 1); releasing this candidate needs the live fixture, not this test.
