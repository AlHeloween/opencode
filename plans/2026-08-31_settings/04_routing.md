# Subplan 04: OpenRouter routing — per-agent, per-model, defaults + interactive dialog

plan_id: 2026-08-31-settings-04-routing
state: IMPLEMENTED (rev 2, 2026-08-31) — server chain + defaults + dialog; rev 2 = live endpoints per Alexander feedback
parent: [master.md](master.md)
origin: Alexander 2026-08-31 06:15–06:25 UTC — "настройки уникальны для каждой модели… типа глобальные, локальные"; "для DeepSeek v4 Flash v731 должен быть StreamLake по умолчанию"; "та же модель но разные провайдеры в зависимости от целей, разная квантизация. StreamLake четко указывает точность"; dialog: "всплывающее окно по hotkey, cursor move, space select unselect, в списке fp".

## Resolution chain (priority high → low) — IMPLEMENTED

1. **Per-AGENT** — `opencode.jsonc` → `agent.<name>.options.routing` → `Agent.Info.options` (agent/agent.ts:52, merge :479) → llm.ts:445 threads `Provider.openRouterRouting(input.agent.options)` per-stream → `getLanguage(model, {routing})` (cache key + sha256(routing) hash, provider.ts getLanguage) → openrouter loader `getModel(sdk, modelID, options, extra)` → `extra.routing` WINS.
2. **Config model/provider** — `provider.openrouter.options.routing` / `provider.openrouter.models.<id>.options.routing` (provider.ts:428-437, pre-existing) via merged options.
3. **Per-model DEFAULTS** — `OPENROUTER_ROUTING_DEFAULTS` (provider.ts, near openRouterRouting): `deepseek-v4-flash` → `{order: ["streamlake"]}` (StreamLake declares its quantization explicitly; slug = API-confirmed tag base `streamlake` from live tag `streamlake/fp8` — rev 2 fixed the earlier display-name casing `StreamLake`).

Cache safety: distinct routing → distinct `s.models` cache key (`#<sha256-12>`) — agents sharing a model but differing in routing get separate built models.

## Current config usage (works TODAY, no dialog needed)

```jsonc
{
  // Per-agent: same model, different upstream/quantization per purpose
  "agent": {
    "build":    { "options": { "routing": { "order": ["streamlake"], "allow_fallbacks": false, "quantizations": ["fp8"] } } },
    "explore":  { "options": { "routing": { "order": ["NovitaAI"], "allow_fallbacks": false, "quantizations": ["fp16"] } } }
  },
  // Per-model (all agents): provider.openrouter.models.<id>.options.routing
  // Provider-level fallback: provider.openrouter.options.routing
}
```
OpenRouter native keys pass through verbatim (openrouter.ai/docs routing: order, allow_fallbacks, require_parameters, quantizations, sort, …).

## Dialog — IMPLEMENTED, rev 2 (live endpoints; Alexander 16:36 UTC: «выбор inference point не реальный для конкретно выбранной модели… нормальный список со скроллом и выбор галками, fp precision из списка, а не от балды»)

`dialog-routing.tsx` (NEW), entries:
- **DialogAgent** keybind "Routing" (ctrl+o) — per-AGENT scope; writes `agent.<name>.options.routing`.
- **DialogModel** keybind "Routing" — per-MODEL scope; writes `provider.openrouter.models.<id>.options.routing`.

UI contract (rev 2):
- **Data source**: `GET https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints` — PUBLIC (no auth; verified live 2026-08-31 on deepseek-chat-v3.1 and deepseek-v4-flash). Response: `data.endpoints[]` with `provider_name`, `tag` (full endpoint slug, e.g. `streamlake/fp8`), `quantization`, `status` (0 = healthy, negative = degraded), `uptime_last_30m`, `pricing.prompt`, `context_length`.
- **Order section** = REAL providers of the selected model, grouped by tag base slug; sorted healthy → uptime → price. Rows show name · slug · quants · ctx · $/M in · uptime. Saved-config slugs absent from the live list stay visible/deselectable («saved») — a save never silently drops them.
- **Scrollable viewport** (14 rows) with `··· N more above/below` indicators; ↑/↓ move, ←/→ page.
- **SPACE toggles** (checkbox); selection sequence = `order` priority, markers `[1][2]…`.
- **Quantizations section DERIVED from live endpoints** (value + endpoint count) — no hardcoded fp enum. `unknown` appears if OpenRouter reports it.
- **allow_fallbacks** toggle row.
- Save → **global layer** → DialogConfirm (policy) → `sdk.client.global.config.update` (`writeGlobalAgentField` with `routing` for agent scope; `setProviderRouting` for model scope). Clearing routing from TUI remains a documented gap (patchJsonc set-only).
- **Degraded mode**: fetch failure → error line + `r` retry; `a` manual slug entry ONLY in this state (labeled manual) — never the primary path.

## Test cases

1. typecheck — PASS (`20260831T063950Z_a7aab385`; rev 2: `20260831T164617Z_6b2f0f9c`).
2. Server: agent routing wins over model config; defaults apply for deepseek-v4-flash when nothing set; non-openrouter ignores routing (loader ignores `extra`).
3. Cache: two agents, same model, different routing → two built models (no cross-talk) — code review + runtime log `request shape` (body.provider differs).
4. Dialog: live endpoints listed for the target model (real slugs/quantizations), space toggles, order = selection sequence, viewport scroll, global write with confirm, comments preserved.
5. Live API contract — verified 2026-08-31: endpoints payload shape (tag/quantization/status/uptime/pricing) fetched without auth for deepseek/deepseek-chat-v3.1 and deepseek/deepseek-v4-flash.
