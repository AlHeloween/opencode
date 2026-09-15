# Crash Diagnostics Experiment

**Purpose:** Discover the root cause of opencode's exit code 3 crash by running the TUI in full debug mode with all diagnostic flags enabled.

## Method

1. Launch opencode TUI with `bun packages/opencode` (TypeScript source, not compiled binary) with:
   - `--log-level DEBUG` — enable all log levels (stderr + file)
   - `--print-logs` — mirror logs to stderr for live capture
   - `OPENCODE_AUTO_HEAP_SNAPSHOT=1` — auto heap snapshot on memory pressure
   - `OPENCODE_SHOW_TTFD=1` — show time-to-first-drawing metrics
   - All Bun/JSC crash diagnostics enabled

2. Send a short prompt interaction via cmd_runner to trigger normal operation.

3. Wait for crash (or terminate after sufficient runtime).

4. Collect and analyze:
   - Run log (exit code, timestamps, env)
   - Cmd_runner stderr/stdout
   - Log files from `.opencode/data/log/`
   - Crash dumps from `.opencode/data/diag/`
   - WER heap dumps from `.opencode/data/diag/wer/`
   - Bug reports from `.opencode/data/bugs/`

## Files

| File | Purpose |
|------|---------|
| `run_debug.cmd` | Launch harness with all debug flags |
| `results.md` | Analysis of findings |

## Debug flags used

| Flag | Value | Effect |
|------|-------|--------|
| `--log-level DEBUG` | — | All log levels written (default is INFO) |
| `--print-logs` | — | Logs printed to stderr for live capture |
| `OPENCODE_AUTO_HEAP_SNAPSHOT` | `1` | Writes `.heapsnapshot` when RSS > 2GB |
| `OPENCODE_SHOW_TTFD` | `1` | Shows time-to-first-drawing metrics |
| `BUN_ENABLE_CRASH_REPORTER` | `1` | Bun crash dumps to diag/ |
| `WEBKIT_CRASH_LOG` | `.../diag/webkit_crash.log` | JSC fatal crash info |
| `JSC_dumpJITDataOnCrash` | `1` | JIT data at crash time |
| `BUN_JSC_forceRAMSize` | `8GB` | Heap limit |
