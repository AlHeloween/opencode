# Zen (provider `opencode`) transport upgrade h1 → h2

Created: 2026-09-11T05:30Z
Status: COMPLETED 2026-09-11 (all oracles PASS; user directive fulfilled)

## Why

- h3 probe 2026-09-11 (Bun pinned-protocol fetch, cmd_runner `20260911T051102Z_9d5a214c`):
  openrouter.ai and opencode.ai zones have **HTTP/3 disabled server-side**
  (`HTTP3HandshakeFailed` on h3 pin, no alt-svc). h3-for-zen/openrouter impossible
  until zone owners enable it — and no code change needed when they do
  (`GatewayProtocol` already has "h3").
- Zen (provider id `opencode`, api `https://opencode.ai/zen/v1`) currently falls
  into the resolver default `provider === "openai" ? "h2" : "http/1.1"` → runs **h1**.
- Server supports h2: pinned http2 GET 200 (probe above), and **h2 SSE streaming
  smoke passed end-to-end** (cmd_runner `20260911T051635Z_4eefe556`: 200, 46 chunks,
  Layer-3 identity headers required — `x-opencode-session` etc.).

## Change

1. `packages/opencode/src/provider/gateway/adaptive-client.ts` — `resolveGatewayProtocol`:
   default for `provider.startsWith("opencode")` becomes `"h2"` (matches novita-pattern:
   transport default rides provider family; openai exception stays).
2. `packages/opencode/src/provider/provider-sync.ts` — extend the verified-transport
   comment: openrouter stays h2 (h3 disabled in zone, probed 2026-09-11); zen upgraded
   h1→h2 (probe + SSE smoke evidence).
3. `packages/opencode/test/provider/adaptive-client.test.ts` — resolver unit test:
   `opencode` → h2, `openai` → h2, `novita-ai`/unknown → http/1.1, configured override wins.

## Smoke Tests

Baseline (already captured, Exact):
- Probe `20260911T051102Z_9d5a214c`: zen h2 pin 200 (server h2 OK), h3 pin handshake fail.
- Zen SSE smoke `20260911T051635Z_4eefe556`: h2 streaming end-to-end PASS with identity headers.
- Resolver current behavior: `opencode` → http/1.1 (code read, adaptive-client.ts:55).

Post-change oracle:
- [x] `bun test test/provider/adaptive-client.test.ts` from `packages/opencode` — PASS incl. new resolver test (2026-09-11, cmd_runner `20260911T053314Z_0e31a62d`: 4 pass, 0 fail, 34 expect calls).
- [x] `bun typecheck` from `packages/opencode` — zero errors (2026-09-11, cmd_runner `20260911T053323Z_56c62f4e`, exit 0).
- [ ] Log evidence on next real zen request: `gateway.protocol.decision` shows
      `configured: h2, using: h2` (deferred to next live zen session; unit test +
      resolver determinism is the shipped oracle).

## Risks

- Zen free-tier console validates OpenCode identity headers, not transport —
  h2 upgrade cannot regress app-level auth (smoke proved headers, transport orthogonal).
- `opencode-go` shares the family prefix → also h2; probe showed zen/go h2 200 OK.
- Fallback chain h2 → h1 unchanged (`shouldFallbackToH1` categories).
