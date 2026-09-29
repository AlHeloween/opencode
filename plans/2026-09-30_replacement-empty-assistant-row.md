# The replacement path leaves an empty assistant row

<!-- intention: a red in the turn-replacement path is a named defect with a reproducer and a measured cause -> the empty assistant row that an interrupted step leaves behind is either not created or explicitly accounted for by the test, so the suite is green for a stated reason -->

**Date:** 2026-09-30 · **Status:** OPEN · **Severity:** red suite (`test/session/prompt.test.ts`)

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

## Acceptance

- [ ] The extra row is either not created, or the test states WHY one may exist — one of the two, never a relaxed assertion.
- [ ] The predicate is green with the cause named in the test's own prose.
- [ ] `bun test test/session/prompt.test.ts` → 0 fail (the 13 skips are pre-existing and stay that way).

## Smoke Tests

- Baseline (measured now): `bun test -t "prompt submitted during active reasoning replaces the active turn" test/session/prompt.test.ts` → **1 fail**.
- After: the same command → **1 pass**, and the rest of the file is unchanged (41 pass / 13 skip in the full run `20260929T234355Z_f3fd0b66`).
- Negative control: the two other prompts-during-reasoning tests in the same file must keep their current verdicts — this fix may not buy green by weakening the replacement contract.
