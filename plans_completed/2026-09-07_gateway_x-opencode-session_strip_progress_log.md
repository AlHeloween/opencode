# Progress log — gateway x-opencode-session fix + OpenRouter response-cache opt-in

[2026-09-07T08:10Z] Baseline oracle: `cmd_runner start -- bun test test/provider/h1-transport.test.ts` (packages/opencode) → 1 pass / 0 fail. Harness alive, current strip behavior pinned. [Exact]
[2026-09-07T08:18Z] Task: gateway/headers.ts — added shared `stripInternalHeaders()` with Zen allowlist (session/request/project/client). Diff: +24 lines new file. Oracle pending.
[2026-09-07T08:20Z] Task: h1-transport.ts + h2-transport.ts (both request sites) — replaced blanket `x-opencode-*` wire filter with allowlist helper. Oracle pending.
[2026-09-07T08:22Z] Task: response-cache.ts + llm.ts spread — OpenRouter `X-OpenRouter-Cache` (+TTL) strictly opt-in via provider `options.responseCache`; `item.options` = Provider.Info.options. Non-openrouter providers: no change.
[2026-09-07T08:24Z] Task: tests — extended h1-transport.test.ts (session survives on wire), new gateway-headers.test.ts (4), new response-cache.test.ts (5).
[2026-09-07T08:26Z] Task: experiments/2026-09-07_go_session_smoke/wire-probe.mjs (user-required smoke surface).
[2026-09-07T08:28Z] Oracle sweep: tests 11 pass/0 fail (31 expect); smoke 8/8 exit 0; typecheck tsgo --noEmit exit 0. All [Exact].
[2026-09-07T08:30Z] Residual: none blocking. Live end-to-end confirmation against opencode.ai/zen deferred to next real opencode-go request (wire probe covers the transport seam).
