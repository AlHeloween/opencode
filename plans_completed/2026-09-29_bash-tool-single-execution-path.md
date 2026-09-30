# bash/cmd tools — one execution input, cmd quoting, tests on the production paths

<!-- intention: bash.ts/cmd.ts run a command three divergent ways and their suites exercise only the non-production one -> one execution input shared by every path, cmd.exe receives the command intact, and the suites drive the job and sync paths the product actually uses -->

Status: ACTIVE — delivered and verified except K4 and C6 (2026-09-29)

## Why

Read in full on 2026-09-29 (`bash.ts` 846 lines, `cmd.ts` 623 lines). Tests and code are wrong on
BOTH sides; every red must be assigned to its side before a line moves.

Found by reading + codegraph + `adm --query opencode "bash tool cmd.exe /c quoting …"` — the adm
leg is what surfaced the `timeout` contradiction (docs + regression suite vs code); neither the
read nor codegraph pointed at `regression.test.ts` / `docs/background-jobs.md`.

## Findings (found by reading, pinned; each now carries the oracle named in Tasks)

### Code

| id | defect | pin |
|----|--------|-----|
| C1 | three execution paths; sync + Jobs-absent fallback run `params.command`, only the job path runs `effectiveCommand` → cmd_runner auto-wrap is scanned but NOT executed in sync/fallback (the guard passes on the wrapped string, the bare binary runs) | `bash.ts:718-723,766-776,823-833`; same in `cmd.ts:517-521,565-568,613-616` |
| C2 | `pathWarnings` reach the model only on the sync path; job + fallback compute and drop them | `bash.ts:754,836`; `cmd.ts:554,617` |
| C3 | cmd.exe `/c` with >2 quotes strips the first and last quote → the payload leaves quoting, `>` in `=>` becomes a redirect; target = `i+1).join(String.fromCharCode(10)))` in cwd = the recurring 0-byte artefact | `bash.ts:383`, `cmd.ts:270`; verbatim set by `packages/core/src/cross-spawn-spawner.ts:395-408` |
| C4 | `timeout` is in the schema, computed, passed, never read by `run`; contradicts `docs/background-jobs.md:169-212` and `test/tool/regression.test.ts:100-218` | `bash.ts:159,734,632`; `cmd.ts:212,531,457` — history: `02e79a96c8` (07-20) removed, `115161b06e` (07-26) re-added 30 s, `e4a6cbf1c2` (07-31) removed again; suite + docs never followed |
| C5 | `Shell.select()` silently turns a refused `SHELL` (Git Bash on win32) into COMSPEC | `shell/shell.ts:123-129` |
| C6 | background return cast `as any` | `bash.ts:820`, `cmd.ts:610` |
| C7 | `stripCommand` fd patterns have no left boundary: `/1\s*>\s*nul/` eats the last digit of `127.0.0.1 > nul` → `127.0.0.` (baseline: "Ping request could not find host 127.0.0..") | `strip-win.ts:5-13` |
| C8 | AST constitution block throws `Error("")`: message recomputed from `enumerationToolDecision`, which is `""` whenever the tool RESOLVES | `shell-constitution.ts:77-92` vs `enumeration-tools.ts:124` |
| C9 | one policy, two answers: `guardCommand` lets a resolved unix enumerator through (`constitution.ts:795-811`), AST `evaluate` blocks every FILE_ENUMERATOR (`constitution.ts:569-581`); the comment at `shell-constitution.ts:72-74` claims the opposite | same |
| C11 | `cmd.ts` carried a private path validator — a second answer that ignored the sandbox rules | `cmd.ts:298-326` (removed) vs `util/path-validator.ts:243` |
| C12 | external_directory asked only when the external TARGET exists → a command that CREATES a file outside the project (`Set-Content C:\out\new.txt`) was never asked | `bash.ts` collect, `cmd.ts` collect |
| C13 | `POWERSHELL_FILES` listed cmdlets only — `cd ..`, `cat <outside>`, `rm`, `cp` under PowerShell were never scanned; cmd's set lacked the POSIX names that run from Git's usr/bin | `bash.ts:100-112` (moved to `tool/shell-sets.ts`) |
| C14 | `/dev/null` → `nul` conversion ignored `hasPython`, so the strip's own Python guard never saw a `/dev/null` (strip-win.test red on HEAD, by reading) | `strip-win.ts:46-51` |
| C15 | batch grammar without a line terminator: bare `dir` parses as `(ERROR (command_name))`, no `cmd` node → invisible to `commands()`, the constitution AND the permission scan (probe `experiments/2026-09-29_bash-exec-baseline/probe-dir.ts`) | `bash.ts:331`, `cmd.ts:548`, `constitution.ts:622` → `parseShell` |
| C16 | `cmd.ts` duplicated bash.ts's sets and had drifted (no PowerShell aliases) | → one `tool/shell-sets.ts` |
| C10 | default timeout differs: `cmd.ts:33` = `Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS \|\| 60 s` (the documented + configured `experimental.bashTimeoutMs`), `bash.ts:40` = hard 30 min ignoring both | `bash.ts:40`, `cmd.ts:33`, `config.ts:1036` |

### Tests

| id | defect | pin |
|----|--------|-----|
| T-a | runtime has no `Jobs` layer and no test passes `run_in_background:false` → `bash.test.ts` exercises ONLY the fallback; job and sync paths uncovered | `test/tool/bash.test.ts:22-31` |
| T-b | shell matrix includes Git Bash, which `ok()` refuses → every `[bash]` case actually runs cmd under a bash label | `bash.test.ts:53-71` vs `shell.ts:84` |
| T-c | truncation cases run in `projectRoot` on the default shell (cmd here) → C3 fires, the suite litters `packages/opencode` | `bash.test.ts:79-87,1218-1326` |
| T-d | "warns about double drive letter paths" asserts only `exit 0` | `bash.test.ts:1586-1609` |
| T-e | `test.skip("terminates command on timeout")` has no reason and expects a message the code never emits | `bash.test.ts:1110-1134` |
| T-f | `regression.test.ts` timeout / tree-kill cases assert the pre-07-20 contract | `regression.test.ts:100-218` |
| T-g | `cmd.test.ts` path-validation cases: workdir inside the project, only `exit 0` asserted | `cmd.test.ts:916-962` |
| T-h | PowerShell "conditionals" / "nested expressions" cases built on `Write-Host`/`Write-Output`, in POWERSHELL_SAFE since 09-16 → can never ask | `bash.test.ts:247-277,733-762` |
| T-i | `dir` / `Get-ChildItem` cases (cmd paths-with-spaces, backslash preservation) assert a native enumerator runs — blocked by the owner's 09-21 policy | `cmd.test.ts:171-201`, `backslash_preservation.test.ts:81-105,199-222` |

Note: T-b was fixed in parallel by another agent — `5d5c637a54` (matrix without Git Bash); its
handoff note in `_progress_log.md` («Owner assigned #2 to another agent») is what this plan picks up.

## Acceptance frame

| criterion | surface | instrument | falsifier |
|-----------|---------|------------|-----------|
| A1 one input | `bash.ts`, `cmd.ts` | new test: fake `cmd_runner.cmd` on PATH + `setCmdRunnerProbe(true)`, crash-prone command, `run_in_background:false` AND fallback | output lacks the fake runner's marker |
| A2 warnings everywhere | same | test with an external existing dir in the command, all three paths | any path's output lacks "Path issues" |
| A3 cmd intact | `bash.ts`, `cmd.ts` | test in a tmpdir cwd: `"<bun>" -e "console.log('a=>b')"` via cmd | output ≠ `a=>b`, or any new file appears in the tmpdir |
| A4 timeout contract single | code + schema + docs + regression suite | decided by owner (see Decisions) | the four surfaces disagree |
| A5 suite on product paths | `bash.test.ts` | Jobs layer present; job path + `run_in_background:false` both driven | a path with no case |
| A6 matrix = policy | `bash.test.ts` | matrix from `Shell.list()` | a label ≠ the shell that ran |
| A7 no litter | `packages/opencode` | `git status --porcelain --ignored` before/after the file runs | any new untracked/ignored file |

## Baseline (B0, 2026-09-29, `bun test <file>` from packages/opencode, logs in experiments/2026-09-29_bash-exec-baseline/)

| file | pass | skip | fail | secs |
|------|------|------|------|------|
| test/tool/bash.test.ts | 60 | 2 | 27 | 20 |
| test/tool/cmd.test.ts | 36 | 1 | 2 | 9 |
| test/tool/regression.test.ts | 3 | 0 | 4 | 112 |
| test/shell_tests/windows/backslash_preservation.test.ts | 4 | 0 | 2 | 5 |
| test/tool/parameters.test.ts | all | 0 | 0 | 2 |

✓ A7 falsified on baseline: the run created `packages/opencode/i+1).join(String.fromCharCode(10)))`
(`git status --porcelain --ignored` before/after diff) — C3 + T-c reproduced (Exact).

Red groups (by source, not by line):
- Q (C3/T-c) 3 — truncation cases: `'…/bun.exe" -e "console.log' is not recognized`.
- T (C4/T-f) 4 — regression timeout / tree-kill / safety-net / cmd parity: test timeouts.
- E (C8/C9) 3 bash + 2 cmd + 1 backslash — `Error("")` from the AST constitution.
- S (C7) 1 — streams metadata progressively.
- P ? 16 — pwsh/powershell permission cases: `external_directory` never asked, shell permission
  missing for conditionals / nested expressions, `cd ..` resolves. Cause NOT yet located.

## Decisions

- D1 (OWNER, 2026-09-29): «Таймаут должен быть, нету таймаута только у cmd_runner, иначе чат тупо
  зависнет.» → timeout enforced on every path; cmd_runner commands exempt; default = the documented
  `Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 60 s` in both tools (C10). Code was wrong;
  docs + regression suite were right. Reuse the implementation removed by `02e79a96c8`.
- D2 (OWNER, 2026-09-29): remove `looksLikeCodeFragment` from `write.ts`/`edit.ts` after A3 is
  proven, together with the tests that pin the misattributed cause.

## Tasks

- [x] B0 baseline — table above; stray artefact recorded (removed after R1 so R1 can re-observe it).
- [x] R1 reproducers — `test/tool/shell-exec-contract.test.ts` (tools × {fallback, sync, job} ×
      {A3 quoting, A1 wrap, A2 warnings, D1 timeout, D1 cmd_runner exempt} + C8 + C7), cwd = tmpdir,
      real `Jobs.layer`, fake `cmd_runner.cmd` on PATH. RED on unchanged code: 11 pass / 24 fail
      (`experiments/2026-09-29_bash-exec-baseline/contract-red.log`, 195 s). Every red was predicted:
      fallback 4/4, sync 3 (warnings green — sync printed them), job 3 (wrap green — job executed
      it), C8 2, C7 2; cmd_runner-exempt and "still strips real fd" green. No litter in the repo.
Evidence for every box below: run V1 = `experiments/2026-09-29_bash-exec-baseline/post-3/`
(`summary.txt` + one log per file), typecheck exit 0.

- [x] K1 one execution input in `bash.ts` + `cmd.ts` — contract A1/A2 green on fallback, sync, job
      for both tools (35/35).
- [x] K2 `["/d", "/s", "/c", `"${command}"`]` in both tools — contract A3 green ×6, no file in the
      tmpdir; `backslash_preservation` + `shell_tests/windows` 49/0; no artefact in the repo (A7).
- [x] K3 timeout per D1 in both tools, cmd_runner exempt, one default (C10) — contract D1 ×12 green;
      `regression.test.ts` 7/0 (was 3/4, 112 s → 22 s); `bash.test.ts` "terminates command on
      timeout" un-skipped and green.
- [~] K4 `Shell.select()` silent fallback (C5) — NOT done, but **DECIDED (2026-09-30), so the next cycle does
      not pay for the decision twice. The signal is STATE, not a log.** AGENTS § Debugging Paradigm settles the
      question this item left open: a log may record only what state cannot show, and a shell fallback HAS a
      key — the resolved shell already rides the tool's own metadata
      (`metadata: { shell: Shell.name(shell), permission }`, `bash.ts:258`). So the fix is a QUERYABLE
      resolution, not a line somebody had to have predicted: `select()` records `{ used, requested, fellBack }`
      (the last two meaningful only when a request was actually REFUSED — with no request the platform default
      IS the answer and nothing was ignored), exposed beside the existing accessors as `Shell.resolution()` and
      readable by the surfaces that already render shell state. Still a unit of its own: the accessors
      (`preferred()`/`acceptable()`) have callers in bash/cmd/pty/prompt, so it needs its own baseline and its
      own oracle. What is NOT acceptable is leaving the fallback silent — it is the same class as a stale box:
      the user reads a command's output and cannot tell why their shell was ignored.
- [x] K5 fd patterns bounded (C7) + C14 (`hasPython` in the conversion AND the strip's dead
      `"/dev/null"` source test) — contract C7 ×3 green, `strip-win.test.ts` 15/0 (was red on HEAD by
      reading), `shell_tests/common` 77/0.
- [x] K6 ONE enumeration predicate `enumerationBlock` for `evaluate` + `guardCommand`, message on the
      finding (C8, C9) + C15 `parseShell` (batch grammar gets its line terminator) — contract C8 ×2
      green, parity test `constitution-enumeration-probe.test.ts` 5/0 (it caught C15 in post-1:
      `dir` under cmd grammar had zero findings), `constitution.test.ts` 50/0. The parity case was
      written after the fix and was NOT baselined red on unchanged code (Inferred, not Exact).
- [x] P1 group P located and fixed — C12 (target OR parent exists), C13 + C16 (one
      `tool/shell-sets.ts` with PowerShell aliases and POSIX names under cmd), T-h (non-safe cmdlets),
      `$PSHOME` case compared case-insensitively as `util/wildcard.ts:17` does — `bash.test.ts` 88/0.
- [x] K7 D2 — `looksLikeCodeFragment` and its pinning cases removed; the positive control kept —
      `write.test.ts` 18/0, `edit.test.ts` 41/0.
- [x] S1 T-b by `5d5c637a54` (other agent) + `bash` const only when the policy accepts it; T-c
      truncation in tmpdir; T-d/T-g assert the warning; T-e un-skipped; T-i `dir`/`type` cases moved to
      `if exist` / `findstr` / `Test-Path`. T-a: job + sync coverage lives in
      `shell-exec-contract.test.ts`; `bash.test.ts` stays on the fallback, which now shares the input.
- [x] S2 `regression.test.ts` needed no edit — the code came back to it; `docs/background-jobs.md`
      timeout row updated (cmd_runner exemption, both tools, all paths).
- [x] V1 B0 set + neighbours re-run — every B0 red is green: bash 60/27 → 88/0, cmd 36/2 → 37/0,
      regression 3/4 → 7/0, backslash 4/2 → green; parameters 51/0, path-validator 11/0.
- [x] ✓ C6 `as any` on the background return (both tools) — DONE 2026-09-30. **The cast was load-bearing in
      the worst way**, and that is why it took a measurement to see: the tool's metadata type was INFERRED from
      the foreground return, so the background branch erased it — and every caller then read `jobID` through
      `any` (five call sites, invisible by construction). Removing the cast made the compiler answer
      «Expected 3-4 type arguments, but got 2»: `Tool.define` needs its SERVICE union named as soon as `M` is
      declared, which is precisely why the author left `M` inferred and reached for `as any`. Both tools now
      declare `Metadata` once (`jobID?: string` for the background handle) and name their services: a TYPE-ONLY
      change, no runtime behaviour. Oracles: `bun typecheck` → exit 0 (`20260930T014722Z_8487a46c`), plus the
      suites that read `jobID` and hold the contract (`shell-exec-contract`, `job-workflow`, `regression`).

## Smoke Tests

- baseline: B0 set, counts + names recorded before any edit.
- post-change: R1 reproducers green, B0 set re-run, A7 litter check.

## Residual (out of this plan)

- `CRASH_PRONE_RE` is anchored at `^`/separator, so a quoted full path (`"C:/…/bun.exe" build`)
  bypasses the crash-prone guard (`shell-constitution.ts:209-212`) — separate unit.
- `cmd.ts` still duplicates bash.ts's scanner (`parts`, `collect`, `run`); the sets are shared now,
  the machinery is not.
- Not run: a live TUI session through `bin/` (forbidden without the owner) — the fix reaches the
  owner's runtime only after the owner's rebuild.
- Tool note: `Glob` timed out (20 s) on `packages/opencode/**` twice; `git ls-files` + Grep answered.
  CodeGraph auto-sync went DISABLED mid-session (lock held by another writer) — its later answers
  were read-verified.
