# Gateway headers: verbatim passthrough + global correlation IDs

State: COMPLETED (G9, 2026-09-07T11:22Z). Oracles: baseline 11/0 (old contract pinned), post-change 6/0 verbatim + smoke 8/8 + typecheck exit 0.

Supersedes the allowlist approach in 2026-09-07_gateway_x-opencode-session_strip.md
(that fixed the Zen 400; this generalizes it: NO header filtering anywhere on the wire).

## Problem 1 (header cutting)
Gateway transports filtered x-opencode-* (h1: stripInternalHeaders, h2 x2). Even the
allowlist is cutting. User: transports must send headers VERBATIM.

## Problem 2 (empty Request/Session ID in Novita dashboard)
llm.ts builds correlation headers ONLY for providerID.startsWith("opencode"); x-request-id
is sent to nobody (gateway metrics read it but it is never set). Novita log: Request ID "-",
Session ID "-", Trace ID populated (server-side). Cache itself works (385.4K/386K read).

## Fix
1. h1-transport.ts / h2-transport.ts (x2): pass options.headers verbatim. Delete
   gateway/headers.ts + gateway-headers.test.ts (allowlist contract is gone).
2. llm.ts: correlation headers for ALL providers:
   - x-opencode-session / x-opencode-request / x-opencode-project / x-opencode-client
   - x-request-id = input.user.id (fills Novita "Request ID" convention + our own
     gateway metrics requestId)
   - x-session-id: openrouter → providerCacheKey (unified affinity namespace,
     commit 8e5bdc41), others → input.sessionID
   - x-session-affinity: same unified value
   - parent-session-id, openrouter X-Session-Id→now merged into x-session-id,
     response-cache spread, User-Agent stay.
3. adaptive-client: after consuming x-opencode-oauth-token/account-id/oauth-url into
   real headers (Authorization / ChatGPT-Account-Id / URL rewrite), DELETE the three
   credential inputs from the outgoing set. Not correlation headers — consumed secrets;
   duplicating the bearer into a nonstandard key ends up in provider logs. Flagged to user.

## Smoke Tests
- baseline: bun test test/provider/h1-transport.test.ts test/provider/gateway-headers.test.ts PASS (old contract pinned).
- post: updated h1-transport.test.ts (VERBATIM contract: x-opencode-* present, oauth present) + bun test provider suite + typecheck PASS.
- experiments wire-probe.mjs updated to verbatim expectations, rerun PASS.
- residual: Novita dashboard columns verify on next real request (server-side; we send the standard headers).
