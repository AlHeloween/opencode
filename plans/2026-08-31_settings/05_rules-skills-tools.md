# Subplan 05: Rules / Skills / Tools — enable/disable/save in TUI (like /mcps)

plan_id: 2026-08-31-settings-05-rules-skills-tools
state: IMPLEMENTED 2026-09-01
parent: [master.md](master.md)
origin: Alexander 2026-09-01 — "включение rules, skills, тулов должны управляться как /mcps. enable/disable/save." Also: remove the obsolete `/opentui` TUI command (skill now lives in `.opencode/skills/`) — done in the same window.

## Abstract

Three agent-behavior surfaces become toggleable from the TUI with PERSISTED state (the `/mcps` dialog pattern — DialogSelect list, SPACE toggle, status chips — plus save, which /mcps lacks: its connect/disconnect is runtime-only):

| Surface | Storage (source of truth) | Runtime enforcement point |
|---|---|---|
| Rules (`.opencode/rules/*.md(c)`) | NEW `config.rules: Record<filename, boolean>` | `session/instruction.ts` rules loader (filter `=== false`) |
| Skills | `config.skills.disabled: string[]` (NEW field in ConfigSkills.Info) | `skill/index.ts` `all` + `available` (system prompt, skill tool, /skill route all shrink) |
| Tools | EXISTING `config.tools: Record<string, boolean>` (config.ts:259) | EXISTING runtime-deny (`session/tools.ts:106` — "Tool disabled by user configuration") |

Writes go to the PROJECT config (`PATCH /config` → `Config.update`, worktree opencode.jsonc) — rules are worktree-scoped by nature; tools/skills follow project policy. Known gap (documented): `Config.update` rewrites via JSON.stringify — comments in the file are lost (subplan 02 fixes the writer).

## Structure

```
TUI (app.tsx commands)                     Server
  /rules  → DialogFeatureToggle rules  →  GET /config/rules   (NEW: names + enabled from config)
  /skills → DialogFeatureToggle skills →  GET /skill          (EXISTING, now respects disabled)
  /tools  → DialogFeatureToggle tools  →  GET /tool           (NEW: registry ids)
        SPACE toggle → GET /config → merge key → PATCH /config → Config.update (worktree jsonc)
```

Generic `DialogFeatureToggle` (mode param) reuses the DialogMcp mechanics (FRAMEWORK_INHERITANCE — no three dialog copies).

## I/O

- Toggle input: category, item name, current state. Output: persisted config key; toast on failure (error visibility policy).
- Defaults: absent = enabled (rules/skills/tools). Tools toggle writes `false` on disable, DELETES the key on enable (inherit). Skills disable appends to `skills.disabled`, enable removes. Rules mirror tools.
- After PATCH: dialog state refreshes; instances pick the change up on the next prompt (config.update invalidates).

## Server deltas

1. `config.ts` (schema): `rules` section. `config/skills.ts`: `disabled?: string[]`.
2. `session/instruction.ts` rules loop: skip disabled basenames.
3. `skill/index.ts`: `all`/`available` filter by `config.skills?.disabled` (Config.Service already in the layer).
4. `httpapi/config.ts`: GET `/config/rules` → `{name, enabled}[]` (fs glob `.opencode/rules/**` + config map).
5. `httpapi/instance.ts`: GET `/tool` → `string[]` (ToolRegistry ids).
6. SDK regen: `bun run packages/sdk/js/script/build.ts` (auto-generated `packages/sdk/js/src/gen/`).

## TUI deltas

- `dialog-feature-toggle.tsx` (NEW): mode-parametrized DialogSelect; space toggle per mode; Status chips (✓ Enabled / ○ Disabled); error toasts.
- `app.tsx`: commands `rules.list` (slash `rules`), `skills.list` (slash `skills`), `tools.list` (slash `tools`), category Agent.

## Smoke Tests

- typecheck (packages/opencode) exit 0 — PASS (`20260901T083319Z_43b522bc`).
- Live (user rebuild): /rules lists rule files; SPACE disable → project config gains `rules.<name>: false`; next prompt drops the rule from the system prefix; /tools toggle refuses execution with the existing "Tool disabled by user configuration" message; /skills disabled skill leaves the available_skills block; /opentui command gone.

## Implementation notes (2026-09-01)

- /opentui command removal: done first (`.opencode/command/opentui.md` deleted — skill lives in `.opencode/skills/`).
- Server: config schema gained `rules` (Record<string,boolean>) + `ConfigSkills.Info.disabled`; instruction.ts filters rules; skill/index.ts filters get/all/available; GET /config/rules + GET /experimental/tool/ids (already existed, now SPEC-DOCUMENTED) serve lists. The redundant /tool route initially added to httpapi/instance.ts was REMOVED — /experimental/tool/ids already covers it (@OBSOLETE_CLEANUP).
- SDK: regen attempted 3×. DISCOVERY (spec debt, pre-existing): the spec pipeline (Server.openapi → hono generateSpecs) only documents describeRoute routes — ALL bridged Effect routes (mcp/session/sync/file/...) lack metadata, so a fresh regen DROPS them from the generated client (the committed gen predates the bridge migration and was stale). Regen REVERTED (OPENCODE_ALLOW_DESTRUCTIVE targeted checkout of gen dirs — generated-only content) to keep the TUI compiling; describeRoute metadata for config.get/update/rules + experimental.tool.ids KEPT in source (requestBody uses a literal JSON Schema — hono-openapi does not preprocess resolver() in requestBody position).
- TUI: dialog-feature-toggle.tsx (mode-parametrized DialogSelect, Status chips reused from dialog-mcp) — new endpoints called via the hey-api CORE client escape hatch (`sdk.client.client.get/patch`) until the spec pipeline documents all bridged routes; /skill via typed sdk.client.app.skills. Writes: config GET → mutate → PATCH /config (server mergeDeep into project file — partial payload never drags globals in); instance disposed server-side (config.ts httpapi update).
- Oracles: typecheck exit 0 (`20260831T083049Z_3744d9df` pre-app.tsx, final `20260901T083319Z_43b522bc`); SDK tsc after gen restore exit 0 (`20260901T082551Z_4089a589`). LSP 'session'/'mcp does not exist on OpencodeClient' diagnostics after regen were STALE — tsgo clean.

## Open items (follow-ups)

1. Spec pipeline repair: document all bridged routes (describeRoute or an Effect OpenAPI merge in Server.openapi) — one regen then covers the whole surface; unblocks typed sdk methods for /config and tool ids.
2. /mcps save parity: MCP connect/disconnect is runtime-only (mcp/index.ts:613-627) — persistence to config.mcp[].enabled would complete the user's enable/disable/save trio for MCPs too.
3. Subplan 02 (jsonc writers) still pending — PATCH /config rewrites project config.json via JSON.stringify (comment loss) — config.json is strict JSON so this is only a gap for jsonc project files.
