<!-- intention: up to 2500 concurrent provider streams must ride a REUSED pool of HTTP/2 sessions (one session caps at the server's advertised 128), never short-lived connections, and the TUI sidebar must show the living connection as an icon -> session pool + model concurrency limits + connected/disconnected badge -->
# H2 session pool, model concurrency, connection badge

**Status:** ACTIVE — owner directive 2026-09-29: «провайдеры сильно не любят когда рвут соединение… до 1000 потоков через одно… чтобы всё было reuse и по феншую» + per-model limits given by the owner: **deepseek-flash 2500**, **deepseek-v4-pro 500** concurrent streams. Owner answered: badge = LIVING CONNECTION (keep-alive H2 session open), not auth and not last-request.

## Measured (2026-09-29, `experiments/2026-09-29_h2-limits/probe-settings.mjs`)

- ✓ `api.deepseek.com` advertises **maxConcurrentStreams=128** on one session; `openrouter.ai` = 100; `api.anthropic.com` = 100. So 2500 streams need ≈20 sessions to deepseek — «through one» is impossible by the server's own SETTINGS; the honest shape is a **pool of reused sessions**.
- ✓ Today `h2-transport.ts` keeps **ONE** session per origin (`sessions: Map<string, H2Session>`) with a wait queue on overflow, ping-healthcheck before use, graceful per-stream RST_STREAM(CANCEL) on abort, and eviction of the oldest session once `MAX_IDLE_SESSIONS=10` — that eviction would kill a warm pool (20+ sessions/origin) as soon as it exists.
- ✓ Our own adaptive limits are far below the provider allowance (deepseek route observed with `maxInflight 100 / maxStreams 50`), so we throttle ourselves ~50×.

## Design decisions

1. **Pool per origin**, not one session: sessions chosen by lowest load (`activeStreams / remoteMaxConcurrentStreams`); a new session is opened only when every session is full AND the pool is under its cap; the cap derives from the model concurrency limit: `ceil(limit / remoteMaxConcurrentStreams)` (2500/128 → 20 for deepseek-flash).
2. **Never tear a warm session**: close only on goaway/error/health-fail; eviction applies to genuinely idle pools, never to a pool servicing streams. Sessions stay warm for reuse.
3. **Model concurrency registry** (owner-provided): `deepseek/deepseek-flash: 2500`, `deepseek/deepseek-v4-pro: 500`; feeds both the gateway limiter (`maxStreams`/`maxInflight`) and the pool cap. Unknown models keep today's policy.
4. **Badge**: server emits `gateway.connection.state` (provider, open sessions, active streams) on session open/close and stream start/end (throttled); the sidebar renders a plain icon `●` connected / `○` disconnected next to the protocol row.

## Tasks

- [x] ✓ **T1 (done):** measure server SETTINGS per origin — see above (deepseek 128 / openrouter 100 / anthropic 100).
- [x] ✓ **T2 pool** `h2-transport.ts`: session pool per origin, load-based pick, lazy cap `ceil(ceiling/perSession)`, wait queue on pool, stale-ping only after 30 s idle, dead sessions self-remove via error/close/goaway, no idle eviction. Oracle (real origin, `experiments/2026-09-29_h2-limits/probe-pool.mjs`): **300 streams → 3 sessions, 1000 streams → 10 sessions**, 1000/1000 answered (401 — no key), same sessions alive after idle (run `20260929T075948Z_9b298eff`).
- [x] ✓ **T3 limits**: `model-limits.ts` (deepseek-flash 2500 / deepseek-v4-pro 500) wired into `providerPolicy` (never below the ceiling) and `enforcePolicyFloors` (clamp raised 100/50 → 2500/2500); H2 calls carry `concurrencyLimit` from the registry. `bun typecheck` exit 0 `20260929T075843Z_53f4787a`.
- [ ] **T4 badges** (NEXT; owner addendum 2026-09-29T09:34Z, live screenshots): status must be GLYPHS, not words — (a) the `active` agent carries a glyph in /agents (the `← active` text may shrink, the leading dot already hints at it), (b) the protocol carries a glyph, (c) the LIVING CONNECTION carries `●` connected / `○` disconnected in the sidebar. Sources: a `gateway.connection.state` event (pool open/close) for (c); the last-fact/label helpers for (b); `local.agent.current()` for (a). Acceptance: sidebar row `deepseek · OpenAI · auto(unknown)` must never render a blank — the current `(unknown)` is the target of (c).
- [~] **T5 oracles:** `bun typecheck` exit 0 and the live pool oracle (300→3 / 1000→10 sessions, 1000/1000 answered, sessions survive idle) are done; a focused `bun test test/gateway` unit suite for the pool is NOT written yet — residual.

## Out of scope

- h3/h1 transports stay on Bun fetch (their pooling is the runtime's); this plan covers our h2 pool.
- Session-scope live residual from the previous plan.
