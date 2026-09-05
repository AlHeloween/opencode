# Bug: routing dialog wrote the SAME setting to TWO config positions (duplicate writers)

plan_id: 2026-09-02-routing-writer-duplicate
state: IMPLEMENTED (2026-09-02)
origin: Alexander 2026-09-02 13:50 UTC — «у тебя 2 разных конфига на билде, они различные, так какой из? Это баг». `D:\!Smit\Smit2-Pasha\opencode.jsonc` contained BOTH `agent.build_mode.routing` (top-level) and `agent.build_mode.options.routing` — written by the SAME build.

## Root cause [Exact — code]

Two writers, two shapes, one logical setting:

- `local.tsx` `writeGlobalAgentField:468` (GLOBAL scope): `agentConfig.routing = field.routing` → **top-level** `agent.<name>.routing`. The writer predates rev 4 (built for `model`/`variant`, where top-level IS canonical — ConfigAgent.Info fields); rev 4 reused it for routing without noticing the runtime reader (`llm.ts` → `Provider.openRouterRouting(input.agent.options)`) reads ONLY `options.routing`.
- `local.tsx` `setAgentRouting` worktree branch: PATCH /config with `agent.<name>.options.routing` → canonical shape.

Top-level spelling only survives via config-normalize promotion (config/agent.ts), and normalize PRESERVES the original key (`{...agent, options}` spread) — so both blocks coexist in the file forever, silently shadowing (top-level wins at promotion time).

## Fix

1. `local.tsx` `writeGlobalAgentField` — new `options` field deep-merges into `agent.<name>.options`; `routing` no longer written top-level.
2. `local.tsx` `setAgentRouting` global branch — writes `{ options: { routing } }` → ONE canonical shape (`agent.<name>.options.routing`) across session/worktree/global scopes.
3. `config/agent.ts` `normalize` — collision warn: top-level unknown key promoting over an existing `options.<key>` logs `OVERRIDES (values differ)` / `identical — remove one` instead of silent shadowing.
4. `test/config/agent-normalize.test.ts` (NEW) — pins the winner contract: top-level unknown key overrides explicit `options.<key>`; options survive without a duplicate.

## Smoke Tests

- `bun test test/config/agent-normalize.test.ts` → **2 pass / 0 fail** (`20260902T140234Z_e8798e3a`).
- typecheck `packages/opencode` → exit 0 (`20260902T140234Z_a69e05eb`).
- Live (user rebuild): routing save in ANY scope produces only `agent.<name>.options.routing`; a file with both spellings logs the collision warn on startup.

## Open items

- User's `D:\!Smit\Smit2-Pasha\opencode.jsonc`: remove the stale top-level `routing` block (keep `options.routing`); fix `provider.openrouter.options.routing.order: ["NovitaAI"]` → `["novita"]` (invalid slug — breaks agents without their own routing).
