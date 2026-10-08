# A prompt that supersedes a turn between its steps can return with no reply

<!-- intention: a user prompt that replaces a running turn is sometimes left unanswered (no request, one aborted empty row) -> every replacing prompt either gets its own reply or a visible, named failure; the race between the superseded run and the new run is reproduced, explained and closed -->

```yaml
Keywords: supersede 0.30, runner-race 0.25, lost-reply 0.20, interrupt-ordering 0.15, reproducer 0.10
Semantic dominant: The replacing prompt's run races the superseded run's in-flight interrupt and can end without answering.
md5: 6c1f0e8a93b24d7f05ae11c2d8e4b7a9
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

**Date:** 2026-10-07 · **Status:** OPEN · **Severity:** user-visible (a prompt silently gets no answer) · **Found by:** `plans_completed/2026-09-30_replacement-empty-assistant-row.md`

## What is measured

✓ Run `20261007T164727Z_1933d7c9` (worktree at `368314d7ca`, `test/session/prompt.test.ts` «prompt submitted during
active reasoning replaces the active turn» with its OLD sequencing — the gate released as soon as the second user
row was durable, plus a temporary row dump): both prompt fibers exited **successfully**, `llm.calls` = **1**, and
the session held: user A → assistant `"first"` (no error) → user B → **one** assistant row for B, `parts: []`,
aborted. Prompt B returned without a single request for it — the replacing prompt was not answered.
Shape seen in 1 of 3 solo runs; the other two (`164423Z_ae2696ab`, `164737Z_12d50d10`) answered B but left an
extra aborted empty row before the reply.

## Mechanism — Inferred, not yet reproduced deterministically

- `prompt()` writes the user row before `loop({ supersede: true })` (`src/session/prompt.ts:1483-1511`), so a
  running turn whose step ends in that window sees the newer user row and opens a step FOR it.
- `Runner.supersede` (`src/effect/runner.ts:176-187`) forks `Fiber.interrupt` of the old run (async, 3 s timeout),
  fails its `done`, and starts the new run at once — the old run's interruption and the new run overlap on the
  same session's rows.
- Open question: what ended B's own run without a request. `isAssistantTurnComplete` returns false for the
  aborted row (no `finish`, `src/session/compaction.ts:1216`), so the loop-exit at `prompt.ts:1744` should not
  fire on it. Candidates to discriminate: B's run being interrupted by the overlapping old-run teardown, or B's
  `onInterrupt` (`lastAssistant`) answering B with the aborted row.

## Acceptance

- [ ] A deterministic reproducer: prompt B lands while turn A is BETWEEN steps (not inside a held request), and the
      test fails on the missing reply to B.
- [ ] The cause is named by instrument (which fiber ends B's run, and how), not by this plan's inference.
- [ ] Fixed in the runner or the loop so that B always gets its own reply (or a visible, named error) — and the
      existing replacement test in `prompt.test.ts` stays green.

## Smoke Tests

- Baseline: the new reproducer → red (B unanswered or `llm.calls` < 2).
- After: the reproducer → green; `bun test test/session/prompt.test.ts` → 0 fail (42 pass / 13 skip today,
  `20261007T165018Z_ec8ed218`), and `test/effect/runner*.test.ts` (if present) unchanged.
- Negative control: a prompt during an in-flight held request (the existing replacement test) keeps exactly two
  assistant rows.
