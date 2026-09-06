---
intent: Preserve OpenRouter upstream affinity for long cached sessions without changing the prompt prefix.
state: completed
reproduce:
  files:
    - packages/opencode/src/provider/transform.ts
    - packages/opencode/src/session/llm.ts
    - packages/opencode/test/session/llm.test.ts
    - packages/opencode/test/provider/openrouter-routing.test.ts
    - bin/opencode.jsonc
  commands:
    - bun test test/session/llm.test.ts test/provider/openrouter-routing.test.ts
    - bun typecheck
  inputs:
    - OpenRouter model request with one canonical OpenCode session ID
    - Z.AI-only OpenRouter routing profile
  expected_outputs:
    - HTTP body session_id and header x-session-id equal the OpenCode session ID
    - prompt_cache_key remains model-scoped
    - provider.only selects Z.AI without provider.order
---

# OpenRouter session identity and sticky routing

## Goal

Make every OpenRouter chat request carry the same canonical OpenCode session ID in both supported affinity channels while preserving the existing model-scoped cache key, and stop the active Z.AI-only profile from disabling sticky routing through `provider.order`.

## Grounded evidence

- Consecutive raw-wire captures around the observed 266K-token miss were append-only and byte-identical over their common message prefix; system, tools, model, routing, and `prompt_cache_key` were unchanged.
- The miss request carried `x-session-id` and the model-scoped `prompt_cache_key`, but no body `session_id`.
- Installed `@openrouter/ai-sdk-provider@3.0.0` spreads `providerOptions.openrouter` directly into both streaming and non-streaming chat bodies.
- The active ignored runtime config `bin/opencode.jsonc` pins Z.AI with `provider.order`; OpenRouter documents that manual order disables sticky routing, while `provider.only` retains a provider allow-list.

## Outcome contract

- OpenRouter only: `session_id === input.sessionID` in the HTTP body.
- Existing OpenRouter `X-Session-Id === input.sessionID` header remains present.
- Existing `prompt_cache_key` stays unchanged and model-scoped; it is not replaced with a bare session ID.
- The active Z.AI runtime profile uses `only: ["Z.AI"]`, retains `allow_fallbacks: false` and `quantizations: ["fp8"]`, and contains no `order`.
- Generic routing pass-through and UI priority-order behavior remain unchanged.
- `constitution.ts`, system prompt assembly, checkpoints, compaction, and tool catalog are untouched.

## Tasks

| ID | Change | Binding | Oracle |
|---|---|---|---|
| T1 | Add body affinity identity | `ProviderTransform.options` → `providerOptions` → OpenRouter SDK body | OpenRouter LLM wire test asserts body/header/cache key |
| T2 | Keep the active Z.AI route sticky-eligible | `bin/opencode.jsonc` routing object | Config read-back asserts `only` and absence of `order` |
| T3 | Record behavior and verification | active routing plan, architecture/workflow docs, progress ledger | focused tests, typecheck, diff checks |

## Risks and containment

- Risk: SDK drops an unknown option. Containment: assert the captured HTTP request body, not only the pre-SDK object.
- Risk: replacing `order` globally breaks intentional priority routing. Containment: change only the active single-provider runtime profile.
- Risk: cache namespace broadens across models. Containment: preserve the existing `session:agent:model` `prompt_cache_key` construction.

## Smoke Tests

Baseline and post-change, from `packages/opencode` through `cmd_runner`:

1. `bun test test/session/llm.test.ts test/provider/openrouter-routing.test.ts`
2. Post-change wire assertion for body `session_id`, header `x-session-id`, and unchanged model-scoped `prompt_cache_key`.
3. `bun typecheck`.
4. `git diff --check`, scoped diff review, and read-back of `bin/opencode.jsonc`.

## Verification

- Baseline: 32 pass / 0 fail (`20260906T043257Z_0bf92f6b`).
- OpenRouter wire regression: 1 pass / 0 fail with body/header/cache-key assertions (`20260906T081251Z_a4391307`).
- Full `llm.test.ts`: 27 pass / 0 fail (`20260906T081358Z_8e0f7cf8`).
- Routing suite: 6 pass / 0 fail (`20260906T081322Z_9533abf4`).
- `bun typecheck`: exit 0 (`20260906T081322Z_f84f121a`).
- Runtime config read-back: `only: ["Z.AI"]`, `allow_fallbacks: false`, `quantizations: ["fp8"]`; no `order` in the OpenRouter profile.
- Constitution, prompt assembly, checkpoint, compaction, and tool catalog were not modified.
