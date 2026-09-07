# Progress log — cmd_runner jobdone auto-tail + constitution auto-wrap

[2026-09-07T10:07Z] Baseline oracle: `bun test test/tool/shell-constitution.test.ts` → 11 pass / 0 fail (pre-change, SMOKE_BEFORE). [Exact]
[2026-09-07T10:12Z] Task: shell-constitution.ts — added shouldRouteViaCmdRunner(), autoWrapCmdRunner(), autoWrapBinary(); enforceBinaryViaCmdRunner kept as defense-in-depth net. Diff: +37/-7.
[2026-09-07T10:14Z] Task: cmd-runner-tail.ts (NEW) — cmdRunnerRunID (only trusts cmd_runner `inbox=` marker, rejects traversal ids), cmdRunnerSessionFinished, cmdRunnerTailBlock (tail -n 60, 20s timeout, debug-log on failure).
[2026-09-07T10:16Z] Task: bash.ts + cmd.ts — auto-wrap BEFORE split/parse; effectiveCommand for timeout detection (10 min); background run appends tail block.
[2026-09-07T10:18Z] Task: run.ts — auto-wrap AFTER permission ask (granular "bun *" patterns preserved); timeout upgraded to ≥10 min when wrapped; tail block appended.
[2026-09-07T10:21Z] Oracle: tests 23 pass / 0 fail (47 expect) across shell-constitution.test.ts + cmd-runner-tail.test.ts. [Exact]
[2026-09-07T10:23Z] Oracle: live smoke — background `bun -e …` auto-wrapped: job output shows banner, `cmd_runner tail` of its session shows "autowrap smoke ok 42"; typecheck exit 0. [Exact]
[2026-09-07T10:25Z] docs/background-jobs.md — new "cmd_runner Jobs — Auto-Tail & Auto-Wrap" section.
[2026-09-07T10:26Z] Residual: none blocking. TUI surfacing of the tail block follows the existing job_output path — visible on next real session in the TUI.

# Novita balance + sidebar money format (same session, later task)

[2026-09-07T10:45Z] Root cause (novita-ai shows "No Status"): no status fetcher registered for "novita-ai" in balance.ts registry (only deepseek/openrouter) → getModelStatus returned no_handler. [Exact]
[2026-09-07T10:46Z] Verified official API (webfetch source_stamp): GET https://api.novita.ai/openapi/v1/billing/balance/detail; availableBalance/cashBalance in 1/10000 USD units (10000 = $1.00). [Inferred → Exact after live probe]
[2026-09-07T10:48Z] Task: balance.ts — fetchNovitaStatus registered for "novita-ai"; scales availableBalance (fallback cashBalance) /10_000 to USD; isAvailable = usd > 0.
[2026-09-07T10:50Z] Task: sidebar context.tsx Status block — balance renders one line "pid: $9.05" (USD) or "x.xx CUR" otherwise; insufficient flag appended when !isAvailable (user spec: "provider name: $xxx").
[2026-09-07T10:52Z] Oracle: balance tests 9 pass / 0 fail (novita scaling + handler-registered cases added); typecheck exit 0. [Exact]
[2026-09-07T10:54Z] Live smoke novita-balance-live.mjs: HTTP 200, units 90500 → $9.05. PASS. [Exact]
