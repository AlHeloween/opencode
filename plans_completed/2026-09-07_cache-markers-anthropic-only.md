# Cache markers: Anthropic-only (strip openaiCompatible/openrouter/bedrock/copilot/alibaba stamps)

State: ACTIVE (user directive 2026-09-07 16:08–16:20: "openrouter вообще нет, да и по остальным тоже", "openaicompatible claude routers — выходит из правил").

## Root cause
`applyCaching()` (transform.ts) stamped ALL cache dialects on the same messages:
first 2 system + last 2 non-system. The openaiCompatible stamp
(`cache_control: {"type":"ephemeral"}`) is NOT part of the OpenAI wire standard
— OpenAI-compatible providers (Novita, Zen, DeepSeek, OpenAI, Azure) cache
AUTOMATICALLY by token prefix (OpenRouter docs: "Most providers automatically
enable prompt caching"). Because the "last 2" stamp moves every turn, mid-request
bytes changed each turn → provider auto-cache broke at the second-to-last message
every turn. Novita wire dump proof: tool_call + tool_result carried
`cache_control` the server never documented (request still 200 — ignored, but
prefix bytes churned). Anthropic keeps the marker: explicit breakpoints are THE
caching mechanism there (SDK converts to per-block cache_control; moving
breakpoint = designed "advances as conversation grows").

## Tasks
1. transform.ts `applyCaching`: providerOptions map → only `anthropic: { cacheControl: { type: "ephemeral" } }`. Remove openrouter/bedrock/openaiCompatible/copilot/alibaba entries.
2. transform.ts `message()` gate: applyCaching runs ONLY for anthropic routes (providerID anthropic | google-vertex-anthropic | npm @ai-sdk/anthropic). Claude-via-openaiCompatible routers explicitly OUT (user directive). DeepSeek/OpenAI/Azure/Copilot/Alibaba out of the gate.
3. Tests: transform.test.ts two expectation blocks (anthropic, google-vertex-anthropic) → only anthropic namespace; add regression test — openai-compatible (novita-ai) route produces NO cache markers anywhere in the rendered messages.

## Deferred (separate authorization, must be tested)
- OpenRouter explicit `prompt_cache_breakpoint` + `prompt_cache_options {mode:"explicit", ttl:"30m"}` around summary generation (user idea 2026-09-07 16:11). OpenAI-dialect explicit caching exists ONLY as prompt_cache_breakpoint — NOT as cache_control/ephemeral.

## Smoke Tests
- Baseline [Exact 2026-09-07T16:14Z]: `bun test test/provider/transform.test.ts test/provider/transform-reasoning.test.ts` → 191 pass / 0 fail.
- Post-change: same suites green (updated expectations + new no-marker test); `bun typecheck` in packages/opencode exit 0.
- transform-reasoning.test.ts:312 already pins `cache_control` ABSENT on copilot body — must stay green.

## Progress log
[2026-09-07T16:26Z] Implemented: applyCaching → anthropic-only providerOptions; message() gate → anthropic/google-vertex-anthropic/@ai-sdk/anthropic only; message-level stamping restored (anthropic semantics). Bedrock pins rewritten to no-marker contract.
[2026-09-07T16:30Z] Oracle 1: transform suites → 192 pass / 0 fail (incl. new regression: novita-ai openai-compatible renders ZERO cache markers). [Exact]
[2026-09-07T16:33Z] Oracle 2: typecheck exit 0. Oracle 3: llm.test.ts 27 pass / 0 fail after updating one stale pin — x-session-affinity:null → "session-test-1" (pin predated the correlation-headers-for-all-providers contract from commit afba7ed; not caused by today's change).
[2026-09-07T16:38Z] Residual: none blocking. Deferred (needs own authorization + tests): OpenRouter explicit prompt_cache_breakpoint/prompt_cache_options around summary (user idea 16:11).
