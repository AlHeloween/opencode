# Gateway strips x-opencode-session from wire — OpenCode Go 400 + OpenRouter response-cache opt-in

State: COMPLETED (G9). All oracles PASS 2026-09-07: tests 11/0, smoke 8/8, typecheck exit 0.

## Problem (Exact)
Provider error using opencode-go:
`Error from provider (Console Go): Request is missing x-opencode-session and cannot be routed efficiently. Please see https://opencode.ai/docs/go/#where-can-i-use-it`

Server side (packages/console/app/src/routes/zen/util/handler.ts:100) reads
`x-opencode-session` from the incoming request. Client side
(packages/opencode/src/session/llm.ts:935-959) sets it for every provider whose
`providerID.startsWith("opencode")` — so the header IS produced. It dies in transit.

## Root cause (Exact, git-archaeology)
Commit `903da62f04` "fix(gateway): align wire diagnostics" (2026-08-12) introduced
`cleanHeaders()` into the adaptive gateway transports, filtering
`!key.toLowerCase().startsWith("x-opencode-")`:
- packages/opencode/src/provider/gateway/h1-transport.ts:9-13 (used at :41 fetch)
- packages/opencode/src/provider/gateway/h2-transport.ts:267-269 (request)
- packages/opencode/src/provider/gateway/h2-transport.ts:421-423 (requestStream)

Before that commit (4ba80f7f6e) h1-transport sent `options.headers` verbatim.
The filter's *intent* was log hygiene ("Produce wire-format headers for **logging**:
no auth, no internal x-opencode-*" — adaptive-client.ts:106-114, wireHeaders()),
but it was applied to the actual request wire, so the legitimate routing headers
(`x-opencode-session`, `x-opencode-request`, `x-opencode-project`, `x-opencode-client`)
never reach opencode.ai/zen. zen handler then deletes them upstream — fine — but
they must arrive first. `x-session-affinity` is derived server-side from
`x-opencode-session` (console openai-compatible.ts:31), so affinity routing also broke.

The strip is also redundant for OAuth: adaptive-client.ts:325-341 already
consumes `x-opencode-oauth-token/account-id/oauth-url` into real headers BEFORE
transport, and the same file builds log-safe `wireHeaders()` for diagnostics.

History note: header construction once lived in `src/session/llm/request.ts`
(commit fb9d69ef62, extracted) and was folded back into llm.ts (e68144cb67).
Construction is intact; only transport strips it.

## OpenRouter "24h cache TTL" — verified against primary sources (Inferred)
- `X-OpenRouter-Cache-TTL` (1-86400s, default 300) is REAL but belongs to
  **Response Caching** (cache identical API responses; requires enabling with
  `X-OpenRouter-Cache: true`; scoped per API key; exact-body hash).
  Source: https://openrouter.ai/docs/guides/features/response-caching (fetched, source_stamp).
- **Prompt caching** docs (fetched, source_stamp) contain NO 24h TTL option:
  sticky routing 10 min, `session_id`/`x-session-id`, `prompt_cache_key`;
  TTL knobs are provider-level (`cache_control.ttl:"1h"` Anthropic,
  `prompt_cache_options.ttl` OpenAI explicit ≥30m).
- The pasted "Use code with caution" text conflates response-cache TTL with
  prompt caching and invents a 24h prompt-cache claim. Rejected.

### Implemented feature (opt-in, zero behavior change by default)
Config: `provider.<id>.options.responseCache: true` (and optional
`responseCacheTtl` seconds 1-86400). When set AND providerID === "openrouter",
llm.ts injects `X-OpenRouter-Cache: true` (+ TTL header when configured).
Header spread order in llm.ts already puts model.headers/config headers AFTER,
so user can override per provider/model.

## Tasks
1. `packages/opencode/src/provider/gateway/headers.ts` — NEW shared helper:
   `stripInternalHeaders(headers)` strips `x-opencode-` EXCEPT allowlist
   `x-opencode-session|x-opencode-request|x-opencode-project|x-opencode-client`;
   also strips `authorization` variants? — NO, keep authorization (Zen relies on it).
   Export `SESSION_AFFINITY_ALLOWLIST`.
2. h1-transport.ts: use helper (rename cleanHeaders -> wireHeaders alias of helper).
3. h2-transport.ts: replace both inline filters with helper.
4. adaptive-client.ts: leave diagnostics `wireHeaders()` as-is (it already
   filters everything for LOGS — correct); update its comment to note the
   transport allowlist exception.
5. `packages/opencode/src/provider/response-cache.ts` — NEW tiny helper:
   `responseCacheHeaders(providerID, options)` → `{}` unless openrouter+opt-in.
6. llm.ts: spread `...responseCacheHeaders(...)` into the non-opencode header branch.
7. Tests:
   - extend packages/opencode/test/provider/h1-transport.test.ts:
     session/request/project/client headers SURVIVE; oauth-token still stripped.
   - NEW packages/opencode/test/provider/gateway-headers.test.ts: allowlist matrix.
   - NEW packages/opencode/test/provider/response-cache.test.ts: opt-in matrix
     (non-openrouter → {}; openrouter no opt → {}; openrouter opt-in → header set;
     ttl clamp 1..86400; invalid ttl → omitted).
8. Smoke in experiments/2026-09-07_go_session_smoke/ (user-required):
   `wire-probe.mjs` — starts local Bun server asserting `x-opencode-session`
   presence, drives H1.request with opencode-shaped headers; writes RESULTS.md.

## Smoke Tests (contract)
- baseline_oracle: `bun test test/provider/h1-transport.test.ts` from
  packages/opencode PASSES pre-change (proves harness + current strip behavior).
- post_change_oracle: `bun test test/provider/h1-transport.test.ts
  test/provider/gateway-headers.test.ts test/provider/response-cache.test.ts`
  PASS + `bun run typecheck` PASS.
- experiments smoke: node wire-probe.mjs exit 0, RESULTS.md records captured
  headers pre/post (pre: session absent → reproduces bug; post: session present).
- expected_delta: wire carries x-opencode-session on gateway transports;
  non-session x-opencode-* (oauth, endpoint-kind, provider/model hints, request-id)
  remain stripped; default behavior for non-openrouter providers unchanged.

## Risks
- R1: Some upstream (non-Zen) endpoint chokes on x-opencode-session. Mitigation:
  allowlist mirrors exactly what zen handler deletes after use
  (handler.ts:172-175) — these four are Zen-consumed; no other known consumer.
- R2: OpenRouter header injection could surprise users. Mitigation: strict opt-in,
  off by default, documented as response-cache only.
- R3: h2 streaming path missed → bug resurfaces. Mitigation: both h2 sites
  replaced + unit tests assert via shared helper (h2 needs live socket; covered
  by helper tests + identical call sites).
- Rollback: single revert of the three transport files + llm.ts helper spread
  (no schema, no persisted state).
