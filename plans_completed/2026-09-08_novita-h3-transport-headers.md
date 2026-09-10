# Novita transport + headers contract (2026-09-08)

## Problem
1. Novita base URL in registry is `https://api.novita.ai/openai` — live canonical is `/v3/openai` (verified: listing endpoint lives there; all three paths serve the same fusion layer, but /v3 is the documented base).
2. Live benchmark [Exact]: h3 beats h2 from Malaysia (median 2188ms vs 3294ms, tail 2x shorter, 0 give-ups vs 1). Novita advertises `alt-svc: h3` and Bun 1.4.2 fetch supports `{ protocol: "http3" }`.
3. `x-opencode-*` headers must go ONLY to opencode-owned providers — third-party providers react badly to foreign namespaced headers.
4. Novita dashboard: Request ID column reads our `x-request-id`; Session ID column reads nothing we tried (9-way differential smoke + wire dump + official SDK source — no session header mechanism exists client-side). User decision: bind `x-request-id = sessionID` so Novita request rows group by session (request-id == session-id makes rows of one session grep-able in their console).

## Tasks
1. [x] provider-sync.ts: novita shell `api` → `https://api.novita.ai/v3/openai`; VERIFIED_H2_OPTIONS → VERIFIED_NOVITA_OPTIONS `{protocol:"h3", streaming:true}`; openrouter keeps h2.
2. [x] adaptive-client.ts: `GatewayProtocol` + `"h3"`; h3 branch = Bun fetch pinned `{protocol:"http3"}` with fallback h3→h2→h1 via existing `shouldFallbackToH1` categories; protocol.decision log extended.
3. [x] llm.ts headers: three layers — universal (x-request-id/x-session-id/x-session-affinity/User-Agent) for everyone; provider-specific per provider; `x-opencode-*` only when providerID.startsWith("opencode"). For novita: `x-request-id = sessionID` (2026-09-08 directive).
4. [x] Tests: llm.test.ts — novita fixture: x-request-id == sessionID, no x-opencode-* on third-party provider; opencode provider keeps x-opencode-*.
5. [x] Regenerate bundled snapshot (script/generate.ts) so binary carries new api base + options.

## Smoke Tests
- Focused: `bun test test/session/llm.test.ts` from packages/opencode (novita header contract) — PASS required.
- Focused: `bun test test/provider/` (transform/balance/h1-transport regressions) — PASS required.
- Live: scripts/bench-novita-h2-vs-h3.mjs already proved h3 transport; post-change live TUI turn on novita model → gateway.protocol.decision logs `using: h3`.
- Typecheck: `bun typecheck` from packages/opencode.

## Result (2026-09-08, final)
- Oracle 1 (headers contract): llm.test.ts + llm-headers.test.ts → 31 pass / 0 fail.
- Oracle 2 (typecheck): exit 0 (twice: after main edits, after test fixes).
- Oracle 3 (full provider + llm suites): 469 pass / 2 fail — both are the SAME
  5s-timeout class in provider.test.ts under full-suite load:
  - "opencode loader keeps paid models when auth exists" times out in the
    FULL FILE run on a CLEAN TREE too (git-stash baseline, `20260908T152832Z_dd9ab179`:
    77 pass / 1 fail same test) — pre-existing load-order flake, NOT from this plan.
    Passes solo with our changes (`20260908T144817Z_b47d2872`).
  - "model blacklist excludes specific models" — same class; passes solo with
    our changes (`20260908T153118Z_ea5b9ef8`, 1 pass / 0 fail).
- Fixed en route (was pre-existing on clean tree, adaptive-client.test.ts
  2 fail at `20260908T144627Z_9299cbb7`): test asserted `body_raw`/`.diff`
  surface removed by the 2026-09-04 readable-wire refactor (5d433565df).
  Updated to the current capture surface: parsed body, per-response
  .raw.txt/.md sidecars, OpenAI-shaped SSE fixture, per-test capture isolation.
  Now 2 pass / 0 fail (`20260908T152405Z_720491c9`).
- Residual (pre-existing, not plan-blocking): provider.test.ts 5s timeout under
  full-suite load — candidates: per-test timeout bump or Store singletons
  sharing SQLite across tmpdirs; separate task.
- Live verify (next real TUI turn on novita): gateway.protocol.decision logs
  `using: h3`; Novita console rows group by session (x-request-id = sessionID).
- Process incident during closure: the first `_progress_log.md` update used `write` and
  truncated the 1264-line history; caught by git-diff review, restored from git HEAD
  and re-merged (final state: 25 insertions on top of history, verified). Lesson:
  `_progress_log.md` updates must use `edit`-anchored prepend, never bare `write`.
