# Subplan 05: Rules / Skills / Tools — enable/disable/save in TUI (like /mcps)

plan_id: 2026-08-31-settings-05-rules-skills-tools
state: IMPLEMENTED 2026-09-01 (rev 2: merge-patch enable fix) (rev 2: merge-patch enable fix)
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
- TUI: dialog-feature-toggle.tsx (mode-parametrized DialogSelect, Status chips reused from dialog-mcp) — new endpoints called via the hey-api CORE client escape hatch (`sdk.client.client.get/patch`) until the spec pipeline documents all bridged routes; /skill via typed sdk.client.app.skills. Writes: config GET (read state) → minimal single-key PATCH /config (RFC 7386 merge-patch — see Revision 2); instance disposed server-side (config.ts httpapi update).
- Oracles: typecheck exit 0 (`20260831T083049Z_3744d9df` pre-app.tsx, final `20260901T083319Z_43b522bc`); SDK tsc after gen restore exit 0 (`20260901T082551Z_4089a589`). LSP 'session'/'mcp does not exist on OpencodeClient' diagnostics after regen were STALE — tsgo clean.

## Revision 2 (2026-09-01, pre-user-test code audit): RFC 7386 merge-patch

Code audit BEFORE the user's live toggle test found two defects in the shipped write path:

1. **Enable was a silent no-op.** Dialog "enable" deleted the key from the PATCH payload, but the server merges with remeda `mergeDeep(existing_file, payload)` — deep-merge only recurses keys present in BOTH objects (remeda@2.39.0 source), so the stale `rules.<name>: false` / `tools.<id>: false` / `skills.disabled[]` survived in the file. Deletion is unrepresentable in mergeDeep.
2. **Project-layer pollution.** The dialog PATCHed the FULL `GET /config` result (merged global+project+defaults); mergeDeep then wrote every global/defaults-derived setting into the PROJECT file on the first toggle — breaking the three-layer governance.

Fix (RFC 7386 JSON Merge Patch semantics for PATCH /config):

- `config.ts` `Config.update`: `mergeDeep` → `mergePatch` — `null` deletes the key, plain objects recurse, everything else replaces (arrays replace wholesale, same as before). Written result never contains null.
- Schema: `rules` / `tools` map value widened to `Boolean | Null` (annotation documents null = delete-on-patch; null never persists). `skills.disabled` needs no null — arrays replace, so enable sends the reduced array (or `disabled: null` when it empties).
- Dialog: sends MINIMAL single-key subtrees — disable → `{rules:{[name]:false}}`, enable → `{rules:{[name]:null}}`; skills → `{skills:{disabled:[...]}}` / `null`; tools mirror rules. No full-config PATCH, no global keys dragged into the project file.
- Known layer edge (documented, not fixed): disabling via GLOBAL config then enabling in the dialog removes the PROJECT key only — the merged view still shows disabled until the global key is edited by hand (global PATCH is set-only, subplan 02/04 gap).

### Smoke tests (rev 2)

- Baseline: existing `test/server/httpapi-config.test.ts` run BEFORE edits — **FAIL** (`20260902T034900Z_1e96f6a8`, `SyntaxError: Failed to parse JSON`); flaky — PASSED on later reruns (`20260902T040024Z_1dcfb0bc`). Instrumented the suite (status+body dump incl. the "200-with-empty-body" flake class); not reproduced since — needs live watching.
- New suite **5 pass / 0 fail** (`20260902T041422Z_94977b9c`): rules disable→`false` / null-enable→key GONE; pollution guard (seeded config.json keeps exactly `$schema`+`username`+`shell`+patched `rules`); skills array replace + null delete; tools round-trip; baseline plain-values PATCH.
- typecheck exit 0 (`20260902T041528Z_3e84fd37`).
- Test-asset notes learned the hard way: fixture `config:` option writes **opencode.json**, not config.json (seed via `init` to control the file PATCH rewrites); `loadFile` injects `$schema` on parse.

## Open items (follow-ups)

1. Spec pipeline repair: document all bridged routes (describeRoute or an Effect OpenAPI merge in Server.openapi) — one regen then covers the whole surface; unblocks typed sdk methods for /config and tool ids.
2. /mcps save parity: MCP connect/disconnect is runtime-only (mcp/index.ts:613-627) — persistence to config.mcp[].enabled would complete the user's enable/disable/save trio for MCPs too.
3. Subplan 02 (jsonc writers) still pending — PATCH /config rewrites project config.json via JSON.stringify (comment loss) — config.json is strict JSON so this is only a gap for jsonc project files.
