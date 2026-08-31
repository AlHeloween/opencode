# Subplan 04: OpenRouter routing — per-agent, per-model, defaults + interactive dialog

plan_id: 2026-08-31-settings-04-routing
state: PARTIAL — server chain + defaults IMPLEMENTED 2026-08-31; dialog PLANNED
parent: [master.md](master.md)
origin: Alexander 2026-08-31 06:15–06:25 UTC — "настройки уникальны для каждой модели… типа глобальные, локальные"; "для DeepSeek v4 Flash v731 должен быть StreamLake по умолчанию"; "та же модель но разные провайдеры в зависимости от целей, разная квантизация. StreamLake четко указывает точность"; dialog: "всплывающее окно по hotkey, cursor move, space select unselect, в списке fp".

## Resolution chain (priority high → low) — IMPLEMENTED

1. **Per-AGENT** — `opencode.jsonc` → `agent.<name>.options.routing` → `Agent.Info.options` (agent/agent.ts:52, merge :479) → llm.ts:445 threads `Provider.openRouterRouting(input.agent.options)` per-stream → `getLanguage(model, {routing})` (cache key + sha256(routing) hash, provider.ts getLanguage) → openrouter loader `getModel(sdk, modelID, options, extra)` → `extra.routing` WINS.
2. **Config model/provider** — `provider.openrouter.options.routing` / `provider.openrouter.models.<id>.options.routing` (provider.ts:428-437, pre-existing) via merged options.
3. **Per-model DEFAULTS** — `OPENROUTER_ROUTING_DEFAULTS` (provider.ts, near openRouterRouting): `deepseek-v4-flash` → `{order: ["StreamLake"]}` (StreamLake declares its quantization explicitly).

Cache safety: distinct routing → distinct `s.models` cache key (`#<sha256-12>`) — agents sharing a model but differing in routing get separate built models.

## Current config usage (works TODAY, no dialog needed)

```jsonc
{
  // Per-agent: same model, different upstream/quantization per purpose
  "agent": {
    "build":    { "options": { "routing": { "order": ["StreamLake"], "allow_fallbacks": false, "quantizations": ["fp8"] } } },
    "explore":  { "options": { "routing": { "order": ["NovitaAI"], "allow_fallbacks": false, "quantizations": ["fp16"] } } }
  },
  // Per-model (all agents): provider.openrouter.models.<id>.options.routing
  // Provider-level fallback: provider.openrouter.options.routing
}
```
OpenRouter native keys pass through verbatim (openrouter.ai/docs routing: order, allow_fallbacks, require_parameters, quantizations, sort, …).

## Dialog (PLANNED — next step)

`dialog-routing.tsx` (NEW), entries:
- **DialogAgent** keybind "Routing" (ctrl+o) — per-AGENT scope; writes `agent.<name>.options.routing`.
- **DialogModel** keybind "Routing" — per-MODEL scope; writes `provider.openrouter.models.<id>.options.routing`.

UI contract (per Alexander): popup by hotkey; ↑/↓ cursor move; **SPACE toggles** rows; two sections:
- **Order** — provider slugs, selection sequence = priority order (✓ marks); candidates = current config order ∪ per-model defaults ∪ "Add `filter text`" row (no invented slug lists).
- **fp list** — quantizations: fixed enum fp4/fp6/fp8/fp8_mm/fp16/bf16/int4/int8 (OpenRouter docs routing/quantization).
- **allow_fallbacks** — toggle row.
- Save → **global layer** → DialogConfirm (policy) → `sdk.client.global.config.update` (reuse subplan 01 endpoint; extend `writeGlobalAgentField` with `routing` field for agent scope; new helper for provider scope). Session/worktree scoping of routing — deferred (session-settings routing key), recorded here.

## Test cases

1. typecheck — PASS (`20260831T063950Z_a7aab385`).
2. Server: agent routing wins over model config; defaults apply for deepseek-v4-flash when nothing set; non-openrouter ignores routing (loader ignores `extra`).
3. Cache: two agents, same model, different routing → two built models (no cross-talk) — code review + runtime log `request shape` (body.provider differs).
4. Dialog (after implementation): space toggles, order = selection sequence, global write with confirm, comments preserved.
