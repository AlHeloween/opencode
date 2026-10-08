# The replacement path leaves an empty assistant row

<!-- intention: a red in the turn-replacement path is a named defect with a reproducer and a measured cause -> the empty assistant row that an interrupted step leaves behind is either not created or explicitly accounted for by the test, so the suite is green for a stated reason -->

**Date:** 2026-09-30 · **Status:** DONE 2026-10-07 (classified TEST: the gate released on a proxy signal; re-keyed) · **Severity:** red suite (`test/session/prompt.test.ts`)

## What is measured

`bun test -t "prompt submitted during active reasoning replaces the active turn" test/session/prompt.test.ts`
→ **0 pass / 1 fail**, three consecutive runs, ~2.1 s each, always the same assertion:

```
prompt.test.ts:1356   expect(assistants).toHaveLength(2)   ->   received 3
```

`expect(yield* llm.calls).toBe(2)` — the line ABOVE it — **passes**, so exactly two provider requests
were made. The extra assistant message was created without a request.

## What the third message IS (named by instrument, not by guess)

Instrumented the same predicate once and printed every assistant row; the diagnostic was removed in the
same session and the tree is back at `324b55fb9b`:

```
{"id":"msg_…b8a8","parentID":"msg_…b6bf","parts":["step-start","text","step-finish"],"texts":["first"]}
{"id":"msg_…ba24","parentID":"msg_…b9e2","parts":[],                            "texts":[]}        <-- extra
{"id":"msg_…ba2f","parentID":"msg_…b9e2","parts":["step-start","text","step-finish"],"texts":["second"]}
```

The extra row has **no parts at all**, and it shares its parent with the `second` reply. `src/session/prompt.ts:1825-1840`
creates one assistant message per LOOP STEP, and `finalizeInterruptedAssistant` (`1842-1850`) marks such a row
completed with an `Aborted` error. So the extra row is a step of the *replacing* turn that was interrupted
before it produced a single part, after which a fresh step ran for the same user message.

## Attribution — measured, and it is NOT this session's change

- Same predicate on the tree two commits earlier (S2, before S3 existed): **red, identically**, in the full-file run.
- Same predicate with the `svm` tool REMOVED from `ToolRegistry`'s `builtin` list — the only behavioural delta
  S2 put on the request path: **red, identically** (`20260929T235628Z_defbfb0a`).
- Reverting the harness's layer provision alone is NOT a valid trial: the test then dies with
  `Service not found: @opencode/Storage` (`20260929T235646Z_adb217d1`) — which proves the provision is
  REQUIRED by the registry change, not a behaviour choice.
- The interruption path lives in code this session never touched.

⇒ The defect predates the S1/S2/S3 chain. It is still OUR red: an inherited defect is a deliverable, never an
exemption, so it is recorded here rather than waived.

## Why a before-run could not be taken (and what that costs every future attribution)

`git worktree add <path> 43600af587` + junctions for `node_modules` — the OLD tree cannot run at all: its
`@opentui/solid` preload needs `@babel/core`, which is no longer installed, so it dies BEFORE the test
(`preload not found "@opentui/solid/preload"`, then `Cannot find module '@babel/core'`).

**An old commit is not re-runnable in this repo.** A before-measurement must therefore be a surgical revert
in the working tree. (`git checkout`/`switch`/`restore`/`reset --hard` are blocked by the constitution;
`git worktree` is permitted but useless for this purpose while the toolchain has moved.)

## Cause — measured 2026-10-07 (worktree at `368314d7ca`)

✓ **Still red alone, and it is a race.** Solo, 3/3 red: twice at the plan's assertion (`:1356`, 3 assistants —
`20261007T164423Z_ae2696ab`, `164429Z_47d8b7d9`), once one line earlier (`:1352`, `llm.calls` = 1 —
`164402Z_bcddae9a`). In the full file it passes (42/13/0 — `164505Z_a3b8a119`, `164614Z_e081c3e2`): file order
changes the timing, not the defect.

✓ **The rows, by instrument** (temporary row dump in the test, removed; `164727Z_1933d7c9`, `164737Z_12d50d10`): in
BOTH failing shapes turn A's assistant row holds `"first"` with **no error** — the held reply was delivered and
turn A was never interrupted. The test released `gate` as soon as the second user row was durable, but
`prompt()` writes that row (`createUserMessage`, `touch`, `setTitle`) BEFORE `loop({ supersede: true })`
(`src/session/prompt.ts:1483-1511`), and `Runner.supersede` forks the old fiber's interrupt
(`src/effect/runner.ts:176-180`). So the gate could open before the replacement reached turn A: A finished
`"first"`, its loop saw the newer user message and opened a step for it, the supersede aborted that step before
any part → the empty row parented to the second prompt.

**Classification: TEST** (the gate is keyed on a proxy that precedes the event it stands for — the test was not
exercising the scenario it names). Fix, in the test only, assertions NOT relaxed: `gate` is now released only
once turn A's row carries the abort written by `finalizeInterruptedAssistant` — while `gate` holds the stream that
is the only writer of an error on that row — and the test now ALSO asserts that turn A was replaced (its row has
the error and never received `"first"`). Cause written into the test's prose.

## Acceptance

- [x] The extra row is either not created, or the test states WHY one may exist — one of the two, never a relaxed assertion. ✓ not created once the test exercises its named scenario: `toHaveLength(2)` and `calls === 2` unchanged, three assertions added.
- [x] The predicate is green with the cause named in the test's own prose. ✓ solo 3/3 green (`20261007T164942Z_2b5983dc`, `164951Z_78351193`, `165000Z_b886da16`), was 0/3.
- [x] `bun test test/session/prompt.test.ts` → 0 fail (the 13 skips are pre-existing and stay that way). ✓ **42 pass / 13 skip / 0 fail** (`20261007T165018Z_ec8ed218`, 58.7 s).

## The two 30 s timeouts reported 2026-10-07 (`20261007T134540Z_31a451a6`: 40/2/13)

«loop calls LLM and returns assistant message», «static loop returns assistant text through local provider».
**Classification: HARNESS (machine load) — no change made.** ✓ The file already carries
`setDefaultTimeout(30_000)` (`prompt.test.ts:64`). Alone each passes in ~5 s wall (`20261007T164446Z_a3e008b7`,
`164452Z_eea66e91`); the whole file passed 3/3 with both green (`164505Z_a3b8a119` 57.3 s, `164614Z_e081c3e2`
61.2 s, `165018Z_ec8ed218` 58.7 s). The 30 s red was not reproduced on a machine running one test file at a time;
the reported run sat beside parallel runs (coordinator: parallel runs here hit bun's timeouts). A timeout raise is
not licensed by this evidence, and none was made.

## Residual — split out, not closed here

✗ **Replacing prompt can return with NO reply** (`20261007T164727Z_1933d7c9`, old test sequencing): both prompt
fibers exited successfully, `llm.calls` = 1, and the only row for the second prompt was the aborted empty one —
the user's replacing prompt got no answer. Mechanism Inferred (`Runner.supersede` starts the new run while the
old fiber's interrupt is still in flight, `src/effect/runner.ts:176-187`). Tracked in
`plans/2026-10-07_supersede-between-steps-loses-reply.md`.

## Smoke Tests

- Baseline (measured now): `bun test -t "prompt submitted during active reasoning replaces the active turn" test/session/prompt.test.ts` → **1 fail**.
- After: the same command → **1 pass**, and the rest of the file is unchanged (41 pass / 13 skip in the full run `20260929T234355Z_f3fd0b66`).
- Negative control: the two other prompts-during-reasoning tests in the same file must keep their current verdicts — this fix may not buy green by weakening the replacement contract. ✓ unchanged (full file 42/13/0 before and after; no source change, the replacement contract was tightened, not weakened).
