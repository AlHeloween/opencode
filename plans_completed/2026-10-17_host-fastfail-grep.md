<!-- intention: fleet host survives any robot tool call -> path-less grep bounded, host death leaves its cause -->
# t85 — host FAST_FAIL 0xC0000409 on path-less grep

Owner verbatim (2026-10-17): «[process exited with code 3221226505 (0xc0000409)]?».

Intention: no single tool call by a robot can kill the robots' host, and when the host dies it leaves its cause.

<!-- sv: Keywords: host-fastfail 0.30, grep-bound 0.25, stand-repro 0.20, death-oracle 0.15, heavy-dirs 0.10 | Semantic dominant: Bound the path-less grep that can take the host down and leave a death cause. | md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 | prev-md5: 00000000000000000000000000000000 | parent-goal-md5: f45403497c6c4e9fb8ef529a2afa3bc8 -->

Scope: STAND ONLY (.temp/t85-stand, port != 4096). Never a second opencode on D:/zPython/opencode. No bin/, no kernel. grep/glob always with explicit path, never at repo root. Work in D:/zPython/opencode on branch Local_Development. Commits via `python scripts/commit_own.py --session ses_eb5b61990ffeM6su57S1EEAZmS`. Tests from packages/opencode, ONE file per call, via cmd_runner. Never `bun test` without a path.

## Ground (G1, measured 2026-10-17 — re-read source, summary is testimony)

- `packages/opencode/src/tool/grep.ts:111-115` — default path when omitted: `params.path ?? ins.directory`, joined as `path.join(ins.directory, ".")` → worktree root. `packages/opencode/src/tool/grep.ts:116-121` stat → cwd=root, file=undefined.
- Timeout: NONE in grep path. `packages/opencode/src/tool/grep.ts:123-130` passes only `{cwd, pattern, glob, file, signal: ctx.abort, gitignore}`; `packages/opencode/src/file/ripgrep.ts:231-233,393-442` `raceAbort` vs `ctx.abort` only, no `Effect.timeout`. `packages/opencode/src/tool/bash.ts:44`, `cmd.ts:36` have 60 s default; grep/glob do not. Kernel claim «at the repo root they time out (20 s)» (`prompt_kernel/addons_claude.py:62-64`) is an observed wall time, not an enforced bound — the 5-minute run refutes it as a guarantee.
- Caps: display-only. `packages/opencode/src/tool/grep.ts:177-179` `limit=100` slices display; collection is unbounded: `packages/opencode/src/file/ripgrep.ts:402-410` `Stream.runCollect` all `match` events, then `packages/opencode/src/tool/grep.ts:152-175` per-file `fs.stat` (concurrency 16) + full sort. No `--max-count` (`packages/opencode/src/file/ripgrep.ts:226` only when `input.limit` set; grep.ts never sets it).
- rg flags: `packages/opencode/src/file/ripgrep.ts:217,221-228` → `--no-config --json --hidden --glob=!.git/* --no-messages` + `--no-ignore` by default (searches everything unless `gitignore:true`), `--hidden` always, pattern via `-e`, target `.`. So a path-less call walks `node_modules/`, `.opencode/data/` (opencode.db size), `logs/`, `external/`, `dist/`.
- Output to session: `packages/opencode/src/tool/grep.ts:219-226` returns `{title, metadata:{matches, truncated}, output}` → tool part `output` + `metadata.matches`; rendered by `packages/opencode/src/cli/cmd/run.ts:92-104` and `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:3010-3019`. Description/contract: `packages/opencode/src/tool/grep.txt:12-20`.
- Crash: `logs/cmd_runner/20261017T123439Z_4239f0f0/state.json:6` `exit_code -1073740791` (0xC0000409 FAST_FAIL), `started 12:34:39Z finished 12:58:24Z`; `meta.json:11` argv `bin/opencode.exe` (the host itself); `stderr.log` 0 bytes; `stdout_text.log` spinner frames only. Last robot t84 part `prt_149ec8e25001fHTfmEPINNafWO` (`ses_eb614bf4dffega8eN3YWTMcXdV`) is `grep running` with `{"pattern":"parent-goal-md5|prev-md5|note: hash values are generative"}` and NO path → worktree root, 5 minutes before death. No Application-log event, no WER, no `%LOCALAPPDATA%/CrashDumps` opencode dump (Claude-measured; faulting module unknown). Earlier deaths different codes (2026-10-16 exit 1 nemotron; 2026-10-17 exit −1 t81 python) — common cause NOT established. conhost dumps within seconds of exits = timing coincidence only.
- t77 oracle: `packages/opencode/src/util/rpc.ts:46-50,126-138` `workerDown` → `server died: <cause>`; `packages/opencode/src/cli/cmd/tui/thread.ts:184-198` `worker.onerror` wires it. That path watches the WORKER from the host. Here the HOST itself fast-failed (`bin/opencode.exe`, FAST_FAIL bypasses JS/stderr), so the watcher could not run and stderr stayed empty — expected, not a second bug.

## Candidates (G2 medoids)

- C1 Unbounded scan OOM/native death (tier 2, Inferred): path-less grep collects every match + stats every file → memory/native pressure → FAST_FAIL. Falsifier: stand path-less call stays alive with flat memory.
- C2 No-timeout hang misread as crash (tier 2, Inferred): 5-minute run is the scan still working, death from another cause. Falsifier: stand path-less call finishes or is killed by new bound.
- C3 Heavy-dir amplification (tier 2, Inferred): `.opencode/data`, `logs`, `node_modules`, `external` dominate cost. Falsifier: same pattern with those dirs excluded finishes fast.
- C4 Host-death silence (tier 1, Exact): FAST_FAIL writes nothing; t77 watcher covers worker, not host. Falsifier: code shows a host-level handler that can run after FAST_FAIL.
- C5 Prior-death common cause (tier 3, Unknown): exit 1 / −1 vs 0xC0000409 — different codes, no shared evidence. Stays Unknown.

Selected CENTRAL_TASKS: C1, C3, C4 (C2 rides the stand as the null hypothesis, C5 stays Unknown).

## Plan contract

- [x] S1 — Stand repro + control DONE (non-repro, honest result). `.temp/t85-stand/bin` = dist copy (3 files), work with same pattern + 300 logs + 100 MB big.bin (real opencode.db 1 698 725 888 B ≈1.7 GB not replicated — 1/17 scale + node_modules/external/dist/.opencode/data not replicated). Probe `C:\Windows\rg.exe` same flags: WIDE 0.19 s exit 0 303 matches 5.5 MB, NARROW (a.txt) 0.02 s exit 0. Run 20261017T144241Z_7c6da776. PREDICTED slow death → observed fast PASS = forecast error (divergence logged): scale, not path-lessness alone, is the amplifier. Peak working set not obtainable for 0.19 s run (no state.json under worktree log root — C:\WINDOWS\logs — recorded). No second opencode on D:/zPython/opencode; no network; no env values.
- [x] S2 — Bound tests RED-first DONE (EXPECTED_FAIL pinned). `grep.test.ts` new heavy-excludes test FAIL 7 pass/1 fail (run 20261017T144421Z_aecc2dd6: heavies found); `glob.test.ts` new test FAIL 2 pass/1 fail (run 20261017T144729Z_0ab89deb). Predictions (FAIL) held.
- [x] S3 — Bound fix DONE (one file per call). `src/tool/grep.ts`: 20 s signal timeout (AbortSignal.timeout+any, AbortError→friendly timeout), per-file limit 101, root-wide heavy excludes (`!dir/**` for node_modules/.opencode/logs/external/dist/.temp/.codegraph) unless named. `src/tool/glob.ts`: same 20 s signal timeout + same excludes (output already capped via take(101)). Post-fix: grep 8/8 (run 20261017T144632Z_cb6aac79), glob 3/3 (run 20261017T144808Z_4d43abf8).
- [x] S4 — Death-cause path check DONE (no code change). t77 `server died` (rpc.ts:46-50,126-138 + thread.ts:184-198) watches WORKER from host; here HOST fast-failed so it could not run; stderr 0 B is FAST_FAIL bypassing JS/stderr — expected. Bun-native FAST_FAIL has no JS hook: residual stands with reproducer (stand probe + state.json exit -1073740791).
- [x] S5 — Reopen note + regression + build DONE. Reopen note in plans_completed/2026-10-17_host-crash-nemotron.md (no git mv — acceptance holds); commit d19ec8a136778a328890ddcf5027c07f950eac9b via commit_own.py; _progress_log.md entry; _build.ps1 exit 0 run 20261017T144948Z_0afa2979 smoke 10.0.1428. This S5 flip commits separately.

## Claim ledger

- CL1 path-less grep searches the worktree root with no timeout and unbounded collect — status: Inferred (grep.ts:111-130, ripgrep.ts:217-228,393-442); falsifier: a timeout/limit arg is found on that path.
- CL2 host died 0xC0000409 5 min after the path-less grep started with empty stderr — status: Inferred (state.json exit, stderr 0 B, t84 running part); falsifier: a log/cause line for that window is found.
- CL3 t77 `server died` could not run here — status: Exact (thread.ts:184-198 watches worker; dead host was bin/opencode.exe); falsifier: a host-level watcher that survives FAST_FAIL.

## Risk ledger

- R1 stand touches robots' host/port 4096 — containment: own dirs + own port, never 4096; rollback: kill stand.
- R2 full `bun test` stall — containment: ONE file per call via cmd_runner.
- R3 shared index collisions — containment: `commit_own.py` + explicit `git add <path>` only; `_progress_log.md` keep BOTH on conflict.
- R4 env values in logs — containment: list removed key NAMES only.
- R5 Bun-native crash unfixable — containment: bound still lands; native part becomes residual with reproducer.

## Smoke Tests (PRE_FLIGHT — predictions BEFORE runs)

- SM1 stand path-less grep: PREDICT slow growth then death or hang past 5 min (exit 0xC0000409 or `running` + rising working set). If PASS fast, prediction error → log divergence, vary load once.
- SM2 same pattern WITH narrow path: PREDICT fast PASS. If it also dies, trigger is NOT path-lessness.
- SM3 bound tests on current code: PREDICT FAIL (no timeout fires, heavy dirs searched). EXPECTED_FAIL pins the missing bound.
- SM4 post-fix: SM1 shape → bounded FAIL fast with cause line (not host death); SM2 → PASS; `grep.test.ts` (+ `glob` if touched) PASS; typecheck + `_build.ps1` exit 0.

## Execution envelope (G4 ALLOW)

classes: READ + PLAN_WRITE + MODIFY_CANDIDATE + MODIFY_PROJECT (no PROMOTE_STABLE, no SELF_MODIFY, no EXTERNAL_EFFECT beyond free-model-free stand). paths: plans/2026-10-17_host-fastfail-grep.md, plans_completed/2026-10-17_host-crash-nemotron.md, packages/opencode/src/tool/grep.ts, packages/opencode/src/tool/glob.ts, packages/opencode/src/file/ripgrep.ts, packages/opencode/test/tool/grep.test.ts, packages/opencode/test/tool/glob.test.ts, .temp/t85-stand/**, _progress_log.md. tools: codegraph/read/grep/glob (explicit path only), task(researcher_agent for trials), cmd_runner-held bun test ONE file, pwsh _build.ps1. bounds: steps 70, tools 180, loops 3, depth 2, time 5400000 ms. prohibitions: no bin/, no kernel, no second opencode on D:/zPython/opencode, no bare git commit, no full bun test, no env values, never grep/glob at repo root.
