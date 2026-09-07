# Progress log — headers verbatim + correlation IDs for all providers

[2026-09-07T11:10Z] Baseline oracle: header tests (allowlist contract) 11 pass / 0 fail. [Exact]
[2026-09-07T11:12Z] User directive: "мы не должны резать хидеры вообще" — allowlist approach superseded; transports must send headers verbatim. Second issue: Novita dashboard Request ID/Session ID columns empty.
[2026-09-07T11:14Z] Evidence: llm.ts built correlation headers ONLY for providerID.startsWith("opencode"); x-request-id never sent by anyone (gateway metrics read it, nobody set it). Novita doc sweep (llms-full.txt): no documented request-header contract for those columns — they are correlation conventions filled from standard request headers; Trace ID column is server-side. Cache itself healthy: 385.4K/386K = 99.8% hit. [Inferred]
[2026-09-07T11:16Z] Task: h1/h2 transports (3 sites) — verbatim options.headers; gateway/headers.ts + gateway-headers.test.ts DELETED (allowlist contract obsolete).
[2026-09-07T11:18Z] Task: adaptive-client — consumed OAuth inputs (x-opencode-oauth-token/account-id/oauth-url) deleted from outgoing set AFTER folding into authorization/ChatGPT-Account-Id/url; flagged to user (these are secrets, not correlation).
[2026-09-07T11:19Z] Task: llm.ts — correlation headers for ALL providers: x-opencode-session/request/project/client, x-request-id (= input.user.id), x-session-id + x-session-affinity (= providerCacheKey for openrouter, sessionID otherwise; OpenRouter X-Session-Id merged into x-session-id).
[2026-09-07T11:21Z] Oracle: h1-transport.test.ts rewritten to VERBATIM contract (all headers incl. oauth-token arrive) 6 pass / 0 fail; wire-probe.mjs 8/8; typecheck exit 0. [Exact]
[2026-09-07T11:22Z] Residual: Novita dashboard columns verify on next real request (server-side rendering). Request ID column likely expects our x-request-id; Session ID may map from x-session-id — confirm in Novita log after a live turn.
