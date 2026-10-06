<!-- intention: every executable outside the known set (bin/** + git/python/node/pwsh/cmd) must safe-launch via cmd_runner — a freshly built app can crash OR hang, and a bare hang took the TUI and its logs with it (owner directive 2026-10-06) -->
# Unknown-app safe launch — crash-prone inversion

sv: { keywords: { unknown-app 0.30, crash-prone 0.25, cmd_runner 0.20, safe-launch 0.15, constitution 0.10 }, dominant: "Invert the crash-prone rule: anything not a known tool is crash-prone and safe-launches through cmd_runner." }

Owner directives (2026-10-06, verbatim):
- «Любой экзешник кроме известных тулов из бина - crash prone.»
- «Стандартно - если этот апп не известен нам и не прошел тесты - то безопасный запуск.»
- «агент написал приложение, запустил - оно зависло - все» · «так как TUI зависла то и логов никаких».

## Scope (owner-approved via AskUser)

- known set = `bin/**` utilities (bin/ + bin/tools/) + system minimum `git`, `python`, `node`, `pwsh`, `cmd`;
- area = `run` tool AND shell tools (`bash`/`cmd`, incl. the PowerShell description);
- unknown app ⇒ auto-wrap `cmd_runner start -- …`; without `cmd_runner` ⇒ BLOCK (fail-closed, existing behaviour).

## Claim Ledger

- c1 ✓ — any segment head that is a FILE (path or exec-extension) and not a known tool / builtin routes via cmd_runner.
  evidence: `autoWrapCmdRunner("bench_crc32_obj.exe").wrapped === true`, `shouldRouteViaCmdRunner("D:\\x\\probe.exe") === true` (shell-constitution.test.ts, green 20261006T102430Z_615a2190).
- c2 ✓ — known tools / builtins / bare command words stay bare.
  evidence: `"git status"`, `"python x.py"`, `"rg foo"`, `"cd repo && echo ok"`, `"mytool --flag"`, `"Get-Date foo"` → false (same run).
- c3 ✓ — the crash-prone list and fail-closed stay unchanged.
  evidence: existing cases (bun/cargo/zig, cmd_runner pass-through, fail-closed) green in the same run.

## Smoke Tests

- baseline: `test/tool/shell-constitution.test.ts` had no unknown-app cases before the edit; the new cases were proven fallible by a mutation check — logic disabled → 4 fail (20261006T100638Z_5ab07b83).
- post-change oracle: `cmd_runner start --cwd packages/opencode -- bun test test/tool/shell-constitution.test.ts test/tool/bash.test.ts test/tool/cmd.test.ts test/tool/shell-exec-contract.test.ts test/tool/description-integrity.test.ts` → **196 tests, 194 pass, 2 skip, 0 fail** (20261006T102430Z_615a2190).

## Tasks

- [x] T1 `shell-constitution.ts`: `KNOWN_TOOLS` + `NON_APP_HEADS` + `headTokens()` (quoted head = one token) + `isUnknownAppToken()` (files only) + `containsUnknownApp()`; `shouldRouteViaCmdRunner` = crash-prone ∪ unknown-file.
- [x] T2 descriptions: run.txt / cmd.txt / bash.txt / powershell.txt — the unknown-app bullet added.
- [x] T3 tests: +9 cases in `test/tool/shell-constitution.test.ts` (built app; run-tool binary; known/builtins bare; bare words not files; quoted paths; chain; fail-closed; runner paths keep old behaviour).
- [x] T4 focused suite green + `_build.ps1` (10.0.1200 smoke PASS, `.temp/test/ cleaned`, exit 0 — 20261006T102052Z_9be2cc40).
- [x] T5 `_progress_log.md` entry + move to `plans_completed/` + one commit naming this plan.

## Risks / residual

- paths to the KNOWN crash-prone runners (`C:\…\bun.exe -e …`) keep the old unwrapped behaviour — the truncation suite depends on it; extending the rule there means reworking the wrapped-output contract (session output vs command stream) — separate task.
- `start <app>` / `call` can still carry a bare app inside an argument — out of scope, recorded.
- tool-description change = system-prefix change → [KV-CACHE RISK] accepted (effective after the next install/restart; old checkpoints keep the old prefix until compact).
