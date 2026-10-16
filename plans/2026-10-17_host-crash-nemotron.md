<!-- intention: silent host death on nemotron-3-ultra-free h2 streaming request -> diagnosed cause with worker-death oracle and multi-word model picker match -->
# t77 — host crash on nemotron-3-ultra-free + picker cannot find "nemotron free"

Owner verbatim (2026-10-17 ~00:00): «новый прикол поднимай сервер заново и пусть робот посмотрит логи, я выбран
nemotron ultra free - кстати что сложно на opencode найти модель в названии которой есть nemotron и free? Так вот
сервер упал.»

Scope: STAND ONLY (.temp/t77-stand, port != 4096). No `bin/`, no kernel, no restart of the robots' host.
Free models only (nemotron-3-ultra-free, zero cost); never print env values.
Work in D:/zPython/opencode on branch Local_Development. Commits via `python scripts/commit_own.py --session <id>`.
Tests from packages/opencode, ONE file per call, via cmd_runner. Never `bun test` without a path.

<!-- sv: Keywords: nemotron crash 0.30, h2 streaming 0.25, worker rpc 0.20, death oracle 0.15, picker filter 0.10 | Semantic dominant: Silent h2 streaming worker death on nemotron request plus multi-word picker miss. | md5: 7f3a9c1e4b5d6a708192a3b4c5d6e7f | prev-md5: 00000000000000000000000000000000 | parent-goal-md5: 00000000000000000000000000000000 -->

## Ground (G1, read yourself — summary is testimony)

- Host run `logs/cmd_runner/20261016T144431Z_49cb3be7/`: `state.json` finished exit_code 1
  finished_utc 2026-10-16T15:59:27Z, `stderr.log` 0 bytes, `stdout.log` 925690 B, `stdout_text.log` 318701 B.
  Tail = spinner frames only, no crash banner (verified by python tail read, ev_511858fca8f946721778950a).
- Owner session `ses_eba8fd224ffenYvFZL0n4191pc` on `opencode/nemotron-3-ultra-free`:
  - `.opencode/data/log/1792166356975_log_nemotron-3-ultra-free_ses_eba8fd224ffenYvFZL0n4191pc.jsonl`
    15:59:16.975–17.005Z: process -> turn.prepare (requestMs 196) -> stream -> system prompt
    (length 122810) -> output token budget (contentTokens 48157, limitOutput 128000) -> request shape -> cache marker.
  - `.opencode/data/log/1792166357005_log_nemotron-3-ultra-free_internal.jsonl`: reasoning census then
    `gateway.protocol.decision` using h2 (chain h2>http/1.1, streaming true) at 15:59:17.052Z. Nothing after.
  - `.opencode/data/log/1792166356583_log_system_ses_eba8fd224ffenYvFZL0n4191pc.jsonl`: single `loop` line.
  - Cited `1792164342314_log_system_internal.jsonl` + `1792161881185_log_system_internal.jsonl` NOT on disk
    (glob 17921643* = none; system_internal on disk starts 179216651*). Absence recorded, not assumed.
- Code (codegraph, verbatim source already read):
  - `packages/opencode/src/util/rpc.ts:1-123` — `listen` maps handler throw to `rpc.error`; `client.call`
    with `timeoutMs` rejects `RPC call timed out after ${timeoutMs}ms: ${method}` (line 91). WORKER_CALL_TIMEOUT_MS
    = 30000 in `packages/opencode/src/cli/cmd/tui/thread.ts:41`.
  - `packages/opencode/src/cli/cmd/tui/worker.ts:1-230` — `unhandledRejection` LOGS and does NOT exit
    (except OPENCODE_STRICT_WORKER=1); `uncaughtException` logs then `process.exit(1)`. So a silent death is
    native/Bun, OOM, or a lost log flush — not a JS rejection.
  - `packages/opencode/src/cli/cmd/tui/thread.ts:172-206` — `worker.onerror` logs `thread error`;
    `uncaughtException`/`unhandledRejection` log `process error`. No `worker.onclose`/exit watcher that says
    `server died: <cause>`. A hung worker surfaces only as the 30 s RPC timeout.
  - `packages/opencode/src/provider/gateway/adaptive-client.ts:363-1277` — `wrapFetch`; decision at :792-799;
    h2 streaming at :858-868 via `H2.requestStream`; h2 non-stream via `H2.request`; fallback only on
    `shouldDowngrade` (:919-948). A throw in `requestStream` acquire or a native http2 crash bypasses fallback.
  - `packages/opencode/src/provider/gateway/h2-transport.ts:1-620` — pool per origin, `requestStream:420-547`
    (`settle` defaults status to 200 when headers missing at :469; `writer.write().catch` destroys req at :494-497).
  - `packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx:223-227` — filter is
    `fuzzysort.go(needle, providerOptions, { keys: ["title", "category", "description"] })` on the WHOLE needle.
    `description` = `providerID/modelID` (e.g. `opencode/nemotron-3-ultra-free`), `title` = `Nemotron 3 Ultra Free`.
    Multi-word `nemotron free` must match ONE key to hit; space vs `-` likely misses. Test will decide.
  - `packages/opencode/src/cli/cmd/tui/component/protocol-probe.ts:41-49` — `probeProtocol` returns `h2`
    when plain HEAD reaches; `dialog-model.tsx:282-309` pins it via `setModelProtocol`. Explains `configured: h2`.
  - Model entry `packages/opencode/src/provider/models/opencode.json` models.nemotron-3-ultra-free: no `options.protocol`;
    api `https://opencode.ai/inference/openai/v1`, context 1000000, output 128000.

## Candidates (G2 medoids, L1-clustered)

- C1 h2-stream native death (tier 2, Inferred): `H2.requestStream` on opencode.ai inference + 48k content tokens
  crashes the worker process below the JS handlers. Falsifier: stand run with same model+size on http/1.1 also dies.
- C2 lost-flush silent death (tier 2, Inferred): worker DID log `exception` but async log buffer died with the
  process before flush; TUI only sees RPC timeout. Falsifier: sync flush/exit hook makes the cause line appear.
- C3 provider error path without transport error (tier 2, Inferred): 401/429/5xx body on h2 stream never reaches
  `captureErrorResponse` (streaming branch has no error capture), reader throws, worker follows. t71 measured
  keyless free models answer 401/429 service-side. Falsifier: stand with keyless vs keyed behaves identically.
- C4 picker single-key fuzzy miss (tier 2, Inferred): `fuzzysort.go` whole-needle vs single key misses
  `nemotron free` although tokens exist across title+description. Falsifier: unit probe shows it DOES match.
- C5 TUI has no worker-death oracle (tier 1, Exact): `thread.ts` watches `onerror` only; no exit/close watcher,
  so death reads as `RPC call timed out` instead of `server died: <cause>`. Falsifier: code shows such a watcher.
- C6 OOM on 122k system prompt + 48k content (tier 3, Unknown): possible but no heap/state evidence; stays Unknown
  until stand measures. Not selected for implementation, only for stand observation.

Selected CENTRAL_TASKS: C1, C2, C4, C5 (C3 rides the stand matrix as a variation, C6 stays Unknown).

## Plan contract

- [x] S1 — Stand reproduce: DONE, mechanism differs (see R-S1). `.temp/t77-stand` (dist copy, own data dirs
  (t65 route), one session `opencode/nemotron-3-ultra-free` short prompt. Then vary ONE thing at a time:
  prompt size near 48k tokens, h2 vs http/1.1 (`options.protocol`), concurrent sessions. Honest Unknown if no repro.
  Oracle: stand run id + state.json + tail bytes; prediction written BEFORE the run.
- [x] S2 — Picker probe PINNED (SM2 divergence: predicted FAIL, observed 7/7 PASS on current code).
  `dialog-model-description.test.ts`): query `nemotron free` (+ reversed `free nemotron`) must match
  `opencode/nemotron-3-ultra-free` (both tokens, any order, across `-`/`/`/space). Predict FAIL before run.
- [x] S3 — Picker fix CLOSED WITHOUT CODE CHANGE: filter matches on current code+data (S2); token-AND
  somewhere, order-free); single-word path unchanged. Keep fuzzysort for scoring, add token gate.
- [x] S4 — Worker-death oracle tests: `test/util/rpc.test.ts` +2 (`workerDown` pending + fail-fast),
  with `server died: <cause>` (not bare timeout) — unit test on `Rpc.client` + thread watcher harness.
  (ii) worker: death flush — `uncaughtException`/native path flushes `exception` line synchronously before exit.
  Predict FAIL before run. Thread wiring test added post-implementation (verification, not RED-first).
- [x] S5 — Worker-death fix (b) DONE: `Rpc.client.workerDown` + `thread.ts worker.onerror` wiring. (a) root
  failure; never let a stream-setup throw escape the worker). (b) Death oracle: thread watches worker
  exit/error/close, logs cause, UI says `server died: <cause>`; worker installs sync-flush exit hook.
- [ ] S6 — Regression + build. Focused files from S2/S4/S5 (ONE file per `bun test` call via cmd_runner),
  then `pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root; read state.json + whole output.
  Commit via `scripts/commit_own.py`. Trials/probes go to `researcher_agent`.

## Claim ledger

- CL1 worker died on first nemotron-3-ultra-free h2 streaming request — status: Inferred (gateway decision log +
  silence + exit 1); falsifier: stand http/1.1 with same prompt also dies.
- CL2 death left no line in any log — status: Inferred (whole stdout read, stderr 0 B, post-decision silence);
  falsifier: a cause line is found in a log not yet read (name the file+line).
- CL3 picker misses multi-word `nemotron free` — status: REFUTED (7/7 probe PASS on current code+data);
  falsifier: unit probe matches on current code.
- CL4 workerDown keeps old behavior — status: Exact (rpc 8/8, thread 3/3, typecheck exit 0 post-change).

## Risk ledger

- R1 stand touches robots' host/port 4096 — containment: own data dir + own port, never 4096; rollback: kill stand.
- R2 full `bun test` stall (18 min, bytes_written 0, 2026-09-22) — containment: ONE file per call via cmd_runner.
- R3 other robots' staged work in shared index — containment: `commit_own.py` + explicit `git add <path>` only.
- R4 env values in logs — containment: never print values, list removed key NAMES only.

## Smoke Tests (PRE_FLIGHT — predictions BEFORE runs)

- SM1 stand short prompt on nemotron-3-ultra-free/h2: PREDICT crash (exit != 0 or RPC timeout) per owner evidence.
  If PASS (no crash), prediction error → log divergence, vary size/protocol/concurrency once each.
- SM2 picker probe on current code: PREDICT FAIL (`nemotron free` does not match). EXPECTED_FAIL pins the bug.
- SM3 worker-death watcher on current code: PREDICT FAIL (pending `fetch` rejects with bare timeout, no
  `server died`). EXPECTED_FAIL pins the missing oracle.
- SM4 post-fix: SM1 with fix → no crash or guarded fallback with cause line; SM2/SM3 → PASS; existing
  `adaptive-client`, `gateway-h2-pool`, `protocol-probe`, `dialog-model-description` files still PASS.

## Execution envelope (G4 ALLOW)

classes: READ + PLAN_WRITE + MODIFY_CANDIDATE + MODIFY_PROJECT (no PROMOTE_STABLE, no SELF_MODIFY, no EXTERNAL_EFFECT
beyond free-model inference). paths: plans/2026-10-17_host-crash-nemotron.md, packages/opencode/src/cli/cmd/tui/thread.ts,
packages/opencode/src/cli/cmd/tui/worker.ts, packages/opencode/src/util/rpc.ts,
packages/opencode/src/provider/gateway/adaptive-client.ts, packages/opencode/src/provider/gateway/h2-transport.ts,
packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx (+ new test files under packages/opencode/test/tui/),
.temp/t77-stand/**, _progress_log.md. tools: codegraph/read/grep/glob, task(researcher_agent for trials), cmd_runner-held
bun test ONE file, pwsh _build.ps1. bounds: steps 60, tools 160, loops 3, depth 2, time 5400000 ms.
prohibitions: no bin/, no kernel, no robots-host restart, no bare git commit, no full bun test, no env values.

## Results (2026-10-16, recorded after the runs)

- R-S1 stand (.temp/t77-stand, dist 10.0.1413, keyed via env NAMES only): nemotron/h3-auto short prompt →
  `stream error AI_StreamProviderError [504] A Timeout Occurred` after ~5 min, exit 1
  (run 20261016T161839Z_b6079b93). http/1.1-pinned nemotron → SAME 504, exit 1
  (run 20261016T162151Z_640696ad). Transport-independent ⇒ upstream/model-side stall, NOT our h2/h3 code.
  GLM-5.3-flash-free/http1.1 → `stream error` in 2 s, process hung 25+ min in retry (run 20261016T162324Z_2430512b,
  stopped after evidence). Owner's 10-second worker DEATH was NOT reproduced: worst stand case is a clean
  504 + printed error + exit 1 WITH a log line. Root cause (a) stays Unknown (C1/C6); candidates: native/Bun
  http2 crash or OOM under the 48k-token TUI request (stand used a short prompt).
- R-S2 picker: `fuzzysort.go(needle, rows, {keys:[title,category,description]})` matches `nemotron free`,
  `free nemotron`, 3-token, hyphenated, uppercase, and disconnected variants — 7/7 PASS
  (runs 20261016T161204Z_97ec1765, 20261016T161521Z_0ecfa1c6, 20261016T163427Z_f3df74c4). Kept as contract pin
  `test/tui/dialog-model-filter.test.ts`. Owner's miss: NOT this path on this data (stale list or other
  keystrokes — exact cause Unknown, honest residual).
- R-S4/S5: `Rpc.client.workerDown(cause)` rejects pending with `server died: <cause>`, clears timers, fails
  fast after; `thread.ts worker.onerror` logs (unchanged shape) + notifies. rpc 8/8
  (run 20261016T163338Z_2c9ca946), thread 3/3 (run 20261016T163811Z_c3d9d749), typecheck exit 0
  (run 20261016T163903Z_30fc0ebc; first run caught a stale mock in thread.test.ts, fixed same-change per Bug Policy).
  Residual: silent NATIVE death with no error event still surfaces only via 30 s timeout (no verified Bun
  Worker exit event in this codebase) + async-Log flush loss on immediate exit (needs Log-level support).
- Mid-task incidents (own faults, recorded): wrong-file edit to dialog-model-filter.test.ts (sentinel line) →
  reverted at once (address 4b8d33ba identical); rpc.ts edit dropped 2 declaration lines + duplicated 1 → repaired
  same-turn, read back clean. Shared-tree collision: another robot's error.ts/paths.ts refactor broke the test
  preload 16:28–16:33 (import SyntaxErrors); waited, re-ran green — no foreign files touched.
