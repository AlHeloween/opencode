# OpenRouter provider-routing config (pin upstream / quantization)

Created: 2026-08-28T09:10Z
Revision: 2 (2026-08-28T09:55Z — T1 grounded to no-op: provider config `options` is
Record(String, Any) (provider.ts:910), flows to loaders via getLanguage merge
(provider.ts:1606-1609, proven by bedrock options.region pattern) — no schema change
needed; per-model override (models.<id>.options.routing) comes free from the same merge)
Status: COMPLETED 2026-08-28T19:00 — E2 verified live: 12/12 post-restart requests carry
`provider: {order:[Z.AI], allow_fallbacks:false, quantizations:[fp8]}` (wire analyzer
2026-08-28_wire_analysis_post.txt: "routing pin present: 12/166"), upstream stable Z.AI,
cached_tokens monotonic 191k→230k, PURE-APPEND every turn. (was EXECUTING)

## Why

Wire evidence (2026-08-28): openrouter routes `z-ai/glm-5.3-flash` to 15 upstreams.
Unpinned routing flips between them (our session: Z.AI; direct probe: Novita) — each
flip = cold cache namespace (full re-prefill) + quantization lottery (5/15 upstreams
declare `quantization=unknown`; fp4 risk) + 2x price spread ($7.5e-8 vs $1.5e-7).
opencode today sends only `prompt_cache_key`; routing prefs are accepted by the
provider natively (`provider: {order, allow_fallbacks, quantizations, ...}`).
@openrouter/ai-sdk-provider v3 exposes these as first-class settings (d.ts:242-288),
so no body-hacking is needed.

## Goal

Per-provider config → SDK routing settings → wire. Verified by raw-wire capture
showing `"provider": {"order": [...], ...}` in the request body.

## Tasks

### T1 — config schema

- REVISED (r2): no schema change. `Provider.Info.options` is `Record(String, Any)`
  (provider.ts:910) — `options.routing` passes through as-is, openrouter-native
  snake_case keys preserved verbatim (no translation layer = no drift).

### T2 — wiring (provider.ts)

- DONE: openrouter custom loader (provider.ts `custom().openrouter`) gains `getModel` —
  reads merged `options.routing` (provider.options ⊕ model.options, per-model override
  free) and calls `sdk.languageModel(modelID, { provider: routing })`. SDK stores it as
  model-level settings; serialized into every request body (dist getArgs:
  `provider: this.settings.provider`, index.js:3643). No routing configured → default
  `languageModel(modelID)` path unchanged. Helper `openRouterRouting()` exported for tests.

### T3 — tests + E2 verify

- DONE (unit/config-flow): `test/provider/openrouter-routing.test.ts` — 6 tests PASS
  (`20260828T100744Z_fa71182f`): helper undefined/passthrough/reject, SDK wire contract
  (settings.provider lands on model settings — serialization source), config-flow via
  list() (tmpdir opencode.json → Info.options.routing).
- DONE (regression): full provider suite idle rerun 324/62 (`20260828T101940Z_c0d66b51`)
  vs baseline 364/17 (`20260828T095050Z_8850ba19`): deterministic failure set identical
  (model-resolver×2, provider.sort, copilot×3); all extra fails are 5s-timeouts scaling
  with measured 1.9x machine slowdown (541s vs 283s, across ALL files incl. bedrock/
  vertex/cloudflare untouched by this diff). Zero new assertion failures. typecheck PASS
  (`20260828T095906Z_2d94a8c4`).
- PENDING (E2): rebuild binary → live session with routing.order=["Z.AI"],
  allow_fallbacks=false → gateway raw-wire body must contain provider block;
  per-response upstream stays Z.AI across turns (mechanism probe-proven: 3/3, cache
  896/931). Analyzer: experiments/kv-cache-parity/2026-08-28_gateway_wire_analysis.py.

## Out of scope (follow-up)

- OpenTUI settings dialog for routing (config-first now; UI later).
- Per-model routing override (provider-level is enough for the pain).

## Smoke Tests

smoke_na: false
baseline:
- label: provider tests (pre-edit)
  cmd: bun test test/provider
  workdir: packages/opencode
  expected_exit: 0
post_checks:
- label: provider tests (post-edit)
  cmd: bun test test/provider
  workdir: packages/opencode
  expected_exit: 0
- label: typecheck
  cmd: bun run typecheck
  workdir: packages/opencode
  expected_exit: 0
- label: E2 wire contains provider block
  cmd: python experiments/kv-cache-parity/2026-08-28_gateway_wire_analysis.py
  expected_exit: 0
blast_radius: packages/opencode/src/provider/schema.ts (config schema),
  packages/opencode/src/provider/provider.ts (settings passthrough), tests.
  No request-body change unless user configures routing.

## Prior art

reuse: SDK-native settings (@openrouter/ai-sdk-provider v3 d.ts:242-288) — no custom
body injection; openrouter docs routing guide linked from d.ts.
