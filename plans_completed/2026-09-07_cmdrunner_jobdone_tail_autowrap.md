# cmd_runner: jobdone auto-tail + constitution auto-wrap

State: ACTIVE (user-authorized 2026-09-07: "добавь в jobs если cmd_runner исполняется чтобы при jobdone возвращался cmd_runner tail ...session..." + "для комманд которые требуют cmd_runner чтобы автоматом cmd_runner start -- ...").

## Task 1 — jobdone auto-tail
When a background job executes a cmd_runner command, on completion append a bounded
`cmd_runner tail <run_id> -n 60` snapshot of the session log to the job output.
- run_id parsed ONLY when output carries cmd_runner's `inbox=` marker (no false positives).
- Skipped when start already streamed the session to completion
  (`[session …: finished]` present) — no duplication on the common path.
- Tail failure (PATH miss, crash) is logged debug, never blocks the job result.
- Files: src/tool/cmd-runner-tail.ts (NEW helper: cmdRunnerRunID, cmdRunnerSessionFinished,
  cmdRunnerTailBlock, TAIL_LINES=60, TAIL_TIMEOUT=20s); bash.ts, cmd.ts, run.ts background paths.

## Task 2 — constitution auto-wrap
`enforceBinaryViaCmdRunner` currently THROWS "must run through cmd_runner".
Replace with automatic routing: crash-prone binaries (bun, cargo, go, …) are
wrapped into `cmd_runner start -- <command>` at execution time.
- bash.ts/cmd.ts: autoWrapCmdRunner(command) before split; output gets a one-line
  `constitution: auto-wrapped via cmd_runner start --` notice; timeout becomes
  CMD_RUNNER_TIMEOUT (10 min) via existing isCmdRunner detection on wrapped command.
- run.ts: autoWrapBinary(binary, args) AFTER constitution+permission on the ORIGINAL
  argv (permission patterns stay granular: "bun *", not "cmd_runner *"); timeout
  upgraded when wrapped.
- enforceBinaryViaCmdRunner stays as defense-in-depth safety net (normally no-op).
- send-payloads untouched (wrapper already isolated).

## Smoke Tests
- baseline_oracle: `bun test test/tool/shell-constitution.test.ts` PASS pre-change.
- post_change_oracle: bun test shell-constitution + NEW test/tool/cmd-runner-tail.test.ts
  + bun run typecheck — all PASS.
- live smoke: through the actual run tool, `cmd_runner start -- bun -e …` background
  job → job_output contains `--- cmd_runner session tail (<run_id>) ---`.
