# Restore realtime user-turn interruption

## Goal

Restore the pre-`292fb6e893` behavior for a second ordinary user prompt in the
same session: it supersedes active reasoning immediately, aborts that provider
stream, and starts the new turn. Preserve the hardened bounded cancellation
behavior and the Novita h3 transport; do not revert h3 or reintroduce a
connection-wide close.

## Prior art

- `292fb6e893^:packages/opencode/src/effect/runner.ts` is the direct prior
  implementation of `Runner.ensureRunning()` with supersession semantics.
- Current `Runner.ensureRunning()` deliberately joins an active run; current
  `SessionPrompt.runLoop()` consumes the queued user message only after a
  `stop` finish.
- The captured Novita response for `ses_f7620c0e6ffeGFCwSTU7jYuIb4` ended with
  provider-native `finish_reason: sensitive`; this is independent of the
  realtime interruption regression.

## Tasks

- [x] Add runner and session-prompt regressions for active-turn replacement.
- [x] Keep `Runner.ensureRunning()` as the internal join path; add the explicit
  `Runner.supersede()` path selected only by a fresh `SessionPrompt.prompt()`.
- [x] Propagate `InstanceRef` into replacement work and bind synchronous system
  environment rendering to it, so a replacement turn keeps its project context.
- [x] Verify the focused regressions and typecheck from `packages/opencode`.

## Smoke Tests

### Baseline

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `cmd_runner start --cwd D:\zPython\opencode\packages\opencode -- bun test test/session/prompt.test.ts` | Existing suite passes; no test currently proves new-prompt supersession | 40 pass, 13 skip, 2 fail (unrelated current failures: native mode identity/tool stability; Layer-1 sidecar call count), exit 1; `prompt submitted during an active run…` currently passes with queue semantics. |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | Targeted session/runner test through `cmd_runner` | Second prompt aborts the first in-flight run and completes its own run. |
| 2 | `cmd_runner start --cwd D:\zPython\opencode\packages\opencode -- bun typecheck` | Exit 0. |
| 3 | `git diff --check` | No whitespace errors. |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation begins after baseline.
- [x] Post-implementation smoke passed before `[x]`.
- Post-implementation [Exact]: `bun test test/effect/runner.test.ts` — new
  supersede regression PASS; the file retains 2 baseline failures whose tests
  expect an obsolete queued-second-work contract. `bun test test/session/prompt.test.ts`
  — realtime replacement PASS; full suite remains baseline-equivalent at 40 pass,
  13 skip, 2 unrelated fail. `bun typecheck` exit 0 (20260910T062824Z_c4403290).
