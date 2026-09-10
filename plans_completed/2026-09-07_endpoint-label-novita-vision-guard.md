# TUI endpoint label + Novita vision rejection

State: PARTIAL → endpoint-label task DONE 2026-09-07T16:50Z (user re-escalated: "Почему я все еще вижу (endpoint unpinned)? Ничего не сделано"); vision-guard task OBSOLETE (rejected by live evidence — see below).

## Task 1 — endpoint label only for openrouter — DONE
[2026-09-07T16:50Z] `prompt/index.tsx` modelMeta:
- early return for non-openrouter providers → `endpointLabel: undefined` → `<Show>` hides the element entirely (Novita/Zen/DeepSeek render no endpoint label).
- old fallbacks removed: `(endpoint unpinned)` (fired for every direct provider) and `(actual · unpinned)` (drift warning without routing config — wrong: sticky routing pins server-side by default) → neutral `(actual)`.
- openrouter no-config-no-response state → neutral `(endpoint pending)` (endpointWarn: false), was `(endpoint unpinned)` + warn.
- Oracle: typecheck exit 0 [Exact]. Visual verify on next TUI run.

## Context (Exact)
1. **`(endpoint unpinned)` label is wrong for non-OpenRouter providers.**
   `src/cli/cmd/tui/component/prompt/index.tsx` (modelMeta, ~line 1010-1064):
   endpoint target/actual logic + warning label run for EVERY provider, but
   the routing semantics exist ONLY for OpenRouter:
   - target = routing config (`order[]`/`only[]`/`allow_fallbacks`, agent → model
     → provider → defaults; `OPENROUTER_ROUTING_DEFAULTS` deepseek mirror);
   - actual = `metadata.openrouter.provider` via usage accounting
     (`session/session.ts:609-612`).
   Direct providers (Novita, DeepSeek, z-ai, Zen) have no selectable endpoint
   pool in opencode — the label renders a choice that does not exist.
   Market aggregator lists (Unify/Portkey/LiteLLM/CF-AI-Gateway/Together/
   Fireworks/Vercel) are NOT the criterion: criterion = provider has a routing
   interface wired in opencode. Today that set = `{openrouter}`.
   **Novita specifically**: pure-play provider with own hardware (user,
   2026-09-07) — no upstream pool by definition; never belongs in the
   endpoint-aware set even as the set grows.
   NOTE: `transform.ts` unsupportedParts has PRE-EXISTING type errors
   (TextPart/never union, lines ~369-407, AI-SDK type drift) — fix alongside
   the vision guard since the same function is touched.
2. **Novita 400 `INVALID_REQUEST_BODY: model features vision not support`.**
   Novita catalog for `zai-org/glm-5.3-flash` advertises
   `input_modalities: ["text","image","video"]` (live /v3/openai/models dump),
   but the chat/completions serving path rejects image parts with the 400.
   Our mapping sets attachment/image caps → parts go out → 400 loop
   (retry brings the same parts → same 400 → perceived TUI hang).

## Task 1 — endpoint label only for openrouter
- `prompt/index.tsx` modelMeta: compute endpoint target/actual ONLY when
  `selected.providerID === "openrouter"`; for other providers emit
  `endpointLabel: undefined` (no label, no warning). Keep the existing
  matrix for openrouter unchanged (target / actual / `target→actual!` / unpinned).
- Introduce a named const, e.g. `const ENDPOINT_AWARE_PROVIDERS = new Set(["openrouter"])`,
  so future gateways (Portkey/Unify/Vercel when we wire their routing) join
  by list, not by new branching.

## Task 2 — Novita vision-part guard — OBSOLETE (not implemented)
[2026-09-07T15:30Z] REJECTED by live evidence: the 400 fired exactly once at the openrouter→novita switch boundary (gateway.log: single 400 at 15:01:52, all subsequent novita requests 200 with the same session history containing images). A `cache_control`-style blind image filter was drafted and rolled back (user: "мы сидим на этом провайдере и картинки работают"). No change made.
- Where: `provider/transform.ts` `unsupportedParts()` (runs for every request
  in `message()`), provider-scoped: only for `model.providerID === "novita-ai"`,
  only when the resolved model does not declare image/video input caps —
  catalog says it DOES, so the guard must key off the serving reality:
  config escape `provider.novita-ai.options.stripVisionParts: true` (default
  ON for novita-ai? — decide at implementation; start with explicit opt-in,
  default off, set true in our bin config) — prefer least surprise.
- Behavior: replace `image`/`file` parts with a short text note
  `"[image/video attachment omitted — provider rejected vision input]"` so the
  model knows an attachment existed and the user is not silently ignored.
- Retry: verify 400 is NOT retried anywhere in the provider layer (it is a
  non-retriable class) — if any retry path retries 400, fix that separately.

## Smoke Tests
- baseline: `bun test test/provider/transform.test.ts` (from packages/opencode)
  pass pre-change.
- post: new transform test — novita-ai model + image part → parts replaced
  with the note; non-novita provider → parts intact; provider with vision caps
  + flag off → intact.
- prompt label: unit-render `modelMeta` for novita providerID → no
  endpoint label; openrouter → label present (TUI component test or extract
  the label logic into a pure helper + test that).
- Oracle: `bun run typecheck` PASS.

## Residual / deferred
- Novita Session ID dashboard column: undocumented server-side; Request ID
  (x-request-id) works. No speculative headers.
- Live re-verify on novita-ai after guard: no 400, no hang.
