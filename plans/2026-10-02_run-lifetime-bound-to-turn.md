# Headless `opencode run` lives exactly as long as its turn

<!-- intention: headless run exits when the prompt HTTP call returns (mid-turn, no reply persisted) and hangs forever after a session error -> the process ends on the turn's idle (exit 0) or error (exit 1, fast), never on the request -->

- sv: { keywords: { run-lifetime 0.40, await-event-loop 0.30, error-exit 0.20, headless-oracle 0.10 },
        dominant: "The run command's process lifetime is bound to the turn's idle/error event, not to the prompt HTTP call." }
- implemented by the robot Smit (session `ses_f06a3f279ffed3xB09892N7AfF`, DeepSeek V4.1 Flash) from the brief
  `experiments/2026-10-02_robot-run-lifetime/brief.md`; verified and committed by Claude.

## Measured defect (2026-10-01/02)
- run `20261001T212048Z_93a1e4f9`: one `read` tool turn — `step_finish tool-calls` at 2.45 s, second `step_start` at
  3.43 s, then exit 0 with no `text`; the DB held the user message only.
- run `20261001T142522Z_d2376a8a`: unknown model → one `error` event, then a hang to the 300 s timeout.
- cause (read in code): `run.ts` started the event loop without awaiting it and ended the process when
  `sdk.session.prompt` returned; `session.error` was recorded and ended nothing.

## Tasks
- [x] **R1 unit oracle** — `awaitTurnEnd` in `src/cli/cmd/run.ts` (event stream decides: idle / error / stream-ended;
      a failed request ends the turn); `test/cli/run-lifetime.test.ts`, 5 tests. RED on the extracted old semantics:
      1 pass / 4 fail (Smit, run `20261002T043905Z_c447149b`); GREEN 5/0 (Smit `20261002T044018Z_49360727`, Claude
      re-run `20261002T044216Z_d43a327f`); `bun typecheck` exit 0 (Claude `20261002T044220Z_e1fbee02`).
- [ ] **R2 live oracle** — after the owner's rebuild of dist: a one-`read` turn via `dist/bin/opencode.exe run …
      --format json` emits `text` and exits 0 with the assistant row in the DB; `--model <unknown>` exits 1 within
      seconds. Waits on the build (owner's procedure).

## Smoke Tests
- R1: `cmd_runner start --cwd packages/opencode -- bun test test/cli/run-lifetime.test.ts` → 5 pass / 0 fail.
- R2: the two live runs above, read back from `state.json`, `stdout.log` and the session's DB rows.

## Residual (Smit's report, not oracle-stamped)
- whether the server answers `session.prompt` before the turn ends was not established live — the fix does not
  depend on it;
- «first `session.error` ends the run» rests on code reading (`processor.ts:1590` publishes it on fatal paths only);
- the hard `process.exit(1)` after printing relies on Bun flushing stdout — not live-measured.
- separate defect, delegated (session «Diagnose DeepSeek announce-then-stop»): Smit's first attempt ended a step with
  `finish: stop` after announcing a tool call it never emitted.
