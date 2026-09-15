# Smoke results — OpenCode Go session-header wire probe

Date: 2026-09-07
Reproduces/verifies: `Error from provider (Console Go): Request is missing x-opencode-session`
Root cause: commit `903da62f04` (gateway wire diagnostics) stripped ALL `x-opencode-*`
headers from the actual request wire in h1/h2 transports.

## Probe
`bun run experiments/2026-09-07_go-session-smoke/wire-probe.mjs`
- Bun.serve captures exact request headers arriving over HTTP/1.1 from
  `H1.request()` (gateway transport used for opencode.ai — h2 is opt-in config).
- Asserts the Zen routing allowlist survives + oauth/internal headers still stripped.
- Same helper gates both h2 request sites (`stripInternalHeaders`).
- Response-cache opt-in sanity (openrouter-only, never opencode-go).

## Results (2026-09-07, post-fix)
```
8/8 checks passed, exit 0
PASS wire: x-opencode-session present
PASS wire: x-opencode-request present
PASS wire: x-opencode-oauth-token stripped
PASS wire: authorization kept
PASS helper: session survives
PASS helper: endpoint-kind stripped
PASS cache: opencode-go never cached
PASS cache: openrouter opt-in
```

Baseline (pre-fix) behavior is git-provable: commit 903da62f04^ h1-transport
sent `options.headers` verbatim; the commit added `cleanHeaders()` filtering
`x-opencode-*` — with that filter, `x-opencode-session` is dropped on the wire
(unit test now asserts the opposite; test file: test/provider/h1-transport.test.ts).

## Companion oracles (packages/opencode)
- baseline pre-change: `bun test test/provider/h1-transport.test.ts` → 1 pass/0 fail
- post-change: `bun test test/provider/h1-transport.test.ts test/provider/gateway-headers.test.ts test/provider/response-cache.test.ts` → 11 pass/0 fail (31 expect)
- `bun run typecheck` (tsgo --noEmit) → exit 0
