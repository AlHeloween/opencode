# t95 — graph-first becomes a reminder, never a refusal

<!-- intention: enforced graph-first scanner refusal -> one-time layer-routing reminder note appended to a running scanner result -->
<!-- goal_sv:
```yaml
Keywords: graph-first-reminder 0.35, no-scanner-block 0.25, layer-routing 0.20, out-of-worktree-path 0.12, tests-move-with-behaviour 0.08
Semantic dominant: The runtime graph-first gate stops refusing grep, glob and list and instead runs them and attaches a one-time note naming the layer each tool answers, because the owner wants guidance rather than enforcement and the kernel now routes instruments by the question's layer.
md5: 5acc42a7b9c647d786d3df9f52879074
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```
-->

## Goal

`scannerGate` returns a note, never a refusal. The first `list`/`grep`/`glob` in a session with
`.codegraph/` and no codegraph call RUNS and returns its normal result with one appended note line;
the second scanner call carries no note; nothing is ever thrown; opt-out gives no note; a path
outside the worktree gives no note. Predecessor: `plans_completed/2026-10-15_graph-first-read-not-scan.md`
(T3 backstop + T6 pre-build); the measured 10-15 numbers (2560 scanner calls / 92 sessions) stay as history.

Owner (verbatim, 2026-10-19): «не надо так требовать codegraph, это должно быть обычным системным
напоминанием, а не enforcement.» Same day on the kernel: «Так - мы привязали codegraph к греп как
правило - это глупо.» The kernel now routes by layer (t90): text → grep, files by name → glob/list,
structure → codegraph.

Out of scope here: the separate «docs are read, not scanned» block in `bash.ts:725` and `cmd.ts:521`.
The owner did not mention it. It stays, and this is the record that it exists.

## Context

- `src/session/graph-first.ts`: `scannerGate` (:89-102) returns the message and consumes a once-per-session
  refusal; `graphFirstRoute` (:77-83) builds the «BLOCKED» text.
- Callers throw it: `src/tool/ls.ts:78-79`, `src/tool/grep.ts:112`, `src/tool/glob.ts:47`.
- The gate keys on the WORKTREE having `.codegraph/`, not on the path asked for. So a `list` of
  `D:\zPascal\ Projects\ClientSoft\docs` (another project, a docs folder) was refused, although the
  graph cannot answer it.
- Related: `session/graph-prebuild.ts` (`markPrebuilt`), `session/processor.ts:728` (`noteToolCall`),
  `session/prompt.ts:1671`. `noteToolCall`/`markPrebuilt` stay: they suppress the note (graph-aware).
- Tests: `test/session/graph-first.test.ts`, `test/config/gate-flags.test.ts:82-91`,
  `test/session/prompt.test.ts:2891+`.

## Tasks

- [x] S1 Tests move with the behaviour (RED first, same change) — rewrite `test/session/graph-first.test.ts`:
  first scanner with `.codegraph/` and no codegraph call returns a note (not undefined/throw) and runs;
  second scanner returns undefined; `graphFirstNote` text contains `codegraph_explore` and `grep` and
  `glob/list` and contains no `BLOCKED`; opt-out (`OPENCODE_GRAPH_FIRST=0`) returns undefined;
  path outside worktree returns undefined and does not consume the latch (next in-worktree call still notes);
  `noteToolCall`/`markPrebuilt` suppress the note. <!-- sv:
```yaml
Keywords: reminder-tests 0.40, red-first 0.25, out-of-worktree-control 0.20, no-blocked-text 0.15
Semantic dominant: Rewrite the graph-first suite to prove a running scanner with a one-time note and no refusal.
md5: a1b2c3d4e5f60718293a4b5c6d7e8f01
prev-md5: 5acc42a7b9c647d786d3df9f52879074
parent-goal-md5: 5acc42a7b9c647d786d3df9f52879074
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] S2 `scannerGate` returns a note, callers append it — `graphFirstRoute` renamed to `graphFirstNote`
  (no `BLOCKED` string anywhere in this lane); `scannerGate(input: {sessionID, tool, worktree, target?, env?})`
  returns `{note}` once per session, `undefined` otherwise; `target` outside `worktree` returns undefined
  without consuming the latch; latch field `refused` renamed to `noted`; `ls.ts`/`grep.ts`/`glob.ts` no longer
  throw — they resolve the search path first (grep moves the gate after `cwd` is known), then append the note
  line to `output` on every return shape; header comment keeps the 10-15 numbers as history, mechanism text
  becomes reminder + layer routing. <!-- sv:
```yaml
Keywords: scanner-note 0.40, caller-append 0.25, target-guard 0.20, blocked-rename 0.15
Semantic dominant: Replace the once-refusal with a once-note that callers append to a normally running result.
md5: b2c3d4e5f60718293a4b5c6d7e8f0123
prev-md5: a1b2c3d4e5f60718293a4b5c6d7e8f01
parent-goal-md5: 5acc42a7b9c647d786d3df9f52879074
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] S3 Docs and descriptions — grep for `graph-first` and `BLOCKED` in `src/tool/*.txt`, `docs/` /
  `AGENTS.md`, skills: `grep.txt`/`glob.txt`/`ls.txt` carry no refusal text (no change needed); `graph-first`
  hits in `bash.ts`/`cmd.ts`/`doc-read.ts`/`constitution.ts` are other lanes and stay. Touched here:
  `graph-prebuild.ts` + `prompt.ts` comments (refusal → reminder wording). <!-- sv:
```yaml
Keywords: doc-reminder-sync 0.45, txt-contract 0.30, lane-scope 0.25
Semantic dominant: Update only the docs that describe the scanner refusal to describe the reminder instead.
md5: c3d4e5f60718293a4b5c6d7e8f012345
prev-md5: b2c3d4e5f60718293a4b5c6d7e8f0123
parent-goal-md5: 5acc42a7b9c647d786d3df9f52879074
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] S4 Oracles + close — each file through cmd_runner, one per call: `graph-first.test.ts`,
  `gate-flags.test.ts`, the graph-prebuild part of `prompt.test.ts` (by name filter), plus `grep`/`glob`/`ls`
  tool tests if present; `bun typecheck` from `packages/opencode`; `_build.ps1`; a dist smoke: a list call in a
  fresh session returns entries plus the note, not an error. Commit through `scripts/commit_own.py` plus a
  progress-log line. <!-- sv:
```yaml
Keywords: oracles-green 0.40, typecheck-build 0.30, dist-smoke 0.30
Semantic dominant: Prove the reminder with focused oracles, a rebuild and a live dist check before closing.
md5: d4e5f60718293a4b5c6d7e8f01234567
prev-md5: c3d4e5f60718293a4b5c6d7e8f012345
parent-goal-md5: 5acc42a7b9c647d786d3df9f52879074
note: hash values are generative tags — search them, never compute them.
```
-->

## Smoke Tests

- RED: rewritten `graph-first.test.ts` fails on current code (first scanner returns defined note vs current
  defined refusal — the assertion that matters is `contains no BLOCKED` + `target outside → undefined without
  consuming` + `callers do not throw`, which fail on the throwing gate).
- GREEN: `cmd_runner start --cwd packages/opencode -- bun test test/session/graph-first.test.ts`.
- GREEN: `cmd_runner start --cwd packages/opencode -- bun test test/config/gate-flags.test.ts`.
- GREEN: graph-prebuild part of `prompt.test.ts` by name filter (`-t "graph pre-build"`).
- GREEN: `grep`/`glob`/`ls` tool tests if present (one file per call; absent = named, not invented).
- GREEN: `bun typecheck` from `packages/opencode`.
- GREEN: `pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root; read `<run>/state.json` + full output.
- Dist smoke: a `list` call in a fresh session returns entries plus the note, not an error.

## Risks

- Note appended to every return shape — a missed early-return shape (e.g. `Directory not found`) drops the
  note on that path only; mitigated by appending at each return in `ls`/`glob`/`grep`.
- `target` resolution differs per tool (`searchPath` vs `cwd`) — the guard uses `path.relative` + absolute-drive
  check, tested with an outside-worktree fixture.
- `BLOCKED` string lingers in another lane — grep is scoped to this lane's files; other `BLOCKED`s stay.

```yaml
Keywords: graph-first-reminder 0.35, no-scanner-block 0.25, layer-routing 0.20, out-of-worktree-path 0.12, tests-move-with-behaviour 0.08
Semantic dominant: The runtime graph-first gate stops refusing grep, glob and list and instead runs them and attaches a one-time note naming the layer each tool answers, because the owner wants guidance rather than enforcement and the kernel now routes instruments by the question's layer.
md5: 9e8f7a6b5c4d3e2f1092837465a7b8c9
prev-md5: 5acc42a7b9c647d786d3df9f52879074
parent-goal-md5: 5acc42a7b9c647d786d3df9f52879074
note: hash values are generative tags — search them, never compute them.
```
