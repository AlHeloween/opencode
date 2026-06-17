# Master Plan: Remove Autoupdates & Telemetry

**Created**: 2026-06-17
**Purpose**: Remove all autoupdate and telemetry collection code from the project per divergence from upstream.

---

## Goal 1: Remove Autoupdates Entirely

**Abstract**: Strip all auto-update infrastructure across CLI, Tauri Desktop, Electron Desktop, web app, config, flags, server routes, OpenAPI schema, i18n strings, and documentation. The `Installation` module retains version/channel/method detection (used elsewhere) but loses all upgrade/latest functionality.

### Task 1.1: Delete CLI Upgrade Files

| [x] | File | Action |
|-----|------|--------|
| [ ] | `packages/opencode/src/cli/cmd/upgrade.ts` | **Delete** — the `opencode upgrade` CLI command |
| [ ] | `packages/opencode/src/cli/upgrade.ts` | **Delete** — background upgrade check logic |

**Dependencies removed**: `Installation.upgrade()`, `Installation.latest()`, `Flag.OPENCODE_DISABLE_AUTOUPDATE`, `Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE`, `config.autoupdate`

### Task 1.2: Clean Installation Module

**File**: `packages/opencode/src/installation/index.ts`

| [ ] | Change | Detail |
|-----|--------|--------|
| [ ] | Keep `Method` type | Used by `uninstall.ts` as type annotation (`Installation.Method`) |
| [ ] | Remove `ReleaseType` type | Used only by `getReleaseType()` |
| [ ] | Remove `Event` block (lines 22-35) | `Updated` and `UpdateAvailable` bus events |
| [ ] | Remove `getReleaseType()` (lines 37-47) | |
| [ ] | Remove `Info` zod schema (lines 49-57) | |
| [ ] | Remove `UpgradeFailedError` (lines 69-71) | |
| [ ] | Remove `GitHubRelease`, `NpmPackage`, `BrewFormula`, `BrewInfoV2`, `ChocoPackage`, `ScoopManifest` schemas (lines 74-83) | Used only by `latest()` |
| [ ] | Remove `latest()` from Interface (line 88) | |
| [ ] | Remove `upgrade()` from Interface (line 89) | |
| [ ] | Remove `upgradeCurl` function (lines 145-165) | |
| [ ] | Remove `getBrewFormula` function (lines 137-143) | |
| [ ] | Remove `latest()` implementation (lines 208-264) | |
| [ ] | Remove `upgrade()` implementation (lines 265-322) | |
| [ ] | Simplify `info()` implementation | Remove `latest:` field, only return `version` |
| [ ] | Remove convenience exports `latest` and `upgrade` (lines 336-338) | Keep `method` export |

**Kept**: `USER_AGENT`, `isPreview()`, `isLocal()`, `method()`, `info()` (simplified), `Service`, `layer`

### Task 1.3: Remove Upgrade References from Entry Points

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/opencode/src/index.ts` | Remove `import { UpgradeCommand }` (line 13), remove `.command(UpgradeCommand)` (line 120) |
| [ ] | `packages/opencode/src/cli/cmd/tui/worker.ts` | Remove `import { upgrade } from "@/cli/upgrade"` (line 6), remove `checkUpgrade` RPC method (lines 73-81) and its call |
| [ ] | `packages/opencode/src/cli/cmd/tui/thread.ts` | Remove `client.call("checkUpgrade", ...)` block (lines 224-226) |
| [ ] | `packages/opencode/src/cli/cmd/tui/app.tsx` | Remove `event.on("installation.update-available", ...)` handler (lines 805-850) |

### Task 1.4: Remove Config & Flag Controls

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/opencode/src/config/config.ts` | Remove `autoupdate` field (lines 134-137) |
| [ ] | `packages/core/src/flag/flag.ts` | Remove `OPENCODE_DISABLE_AUTOUPDATE` (line 35), remove `OPENCODE_ALWAYS_NOTIFY_UPDATE` (line 36) |

### Task 1.5: Remove Server Upgrade Routes

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/opencode/src/server/routes/global.ts` | Remove `/upgrade` POST route (lines 214-286) and its `Installation` import used only by this route |
| [ ] | `packages/opencode/src/server/routes/instance/httpapi/global.ts` | Remove `GlobalUpgradeInput`, `GlobalUpgradeResult` schemas, remove `upgrade` path from `GlobalPaths`, remove `upgrade` endpoint from `GlobalApi` |

### Task 1.6: Remove Tauri Desktop Updater

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/desktop/src/updater.ts` | **Delete** |
| [ ] | `packages/desktop/src/index.tsx` | Remove updater imports, `checkUpdate()`, `updateAndRestart()` platform APIs, `UPDATER_ENABLED` references |
| [ ] | `packages/desktop/src/menu.ts` | Remove macOS `Check for Updates` menu item and `UPDATER_ENABLED` import |
| [ ] | `packages/desktop/src-tauri/src/constants.rs` | Remove `UPDATER_ENABLED` constant |
| [ ] | `packages/desktop/src-tauri/src/lib.rs` | Remove conditional `tauri_plugin_updater` registration |
| [ ] | `packages/desktop/src-tauri/src/windows.rs` | Remove `updaterEnabled` webview init injection |
| [ ] | `packages/desktop/src-tauri/Cargo.toml` | Remove `tauri-plugin-updater` dependency |
| [ ] | `packages/desktop/package.json` | Remove `@tauri-apps/plugin-updater` dependency |

### Task 1.7: Remove Electron Desktop Updater

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/desktop-electron/src/main/index.ts` | Remove `electron-updater` import, `setupAutoUpdater()`, `checkUpdate()`, `installUpdate()`, `checkForUpdates()`, and all updater wiring in `Deps` |
| [ ] | `packages/desktop-electron/src/main/constants.ts` | Remove `UPDATER_ENABLED` and `CHANNEL`-related updater gating |
| [ ] | `packages/desktop-electron/src/main/ipc.ts` | Remove updater method signatures from `Deps` type and IPC handlers |
| [ ] | `packages/desktop-electron/src/preload/index.ts` | Remove updater preload bridge functions |
| [ ] | `packages/desktop-electron/src/preload/types.ts` | Remove updater type declarations |
| [ ] | `packages/desktop-electron/src/renderer/updater.ts` | **Delete** |
| [ ] | `packages/desktop-electron/src/main/menu.ts` | Remove macOS `Check for Updates...` menu item |
| [ ] | `packages/desktop-electron/electron-builder.config.ts` | Remove publish/updater config blocks |
| [ ] | `packages/desktop-electron/package.json` | Remove `electron-updater` dependency |

### Task 1.8: Remove Web App Update UI

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/app/src/pages/layout.tsx` | Remove `useUpdatePolling()` hook definition and invocation (~lines 368-402) |
| [ ] | `packages/app/src/components/settings-general.tsx` | Remove `Check for updates on startup` toggle and `settings.updates.startup()` binding (~lines 692-703) |

### Task 1.9: Remove i18n Updater Strings

| [ ] | File(s) | Change |
|-----|---------|--------|
| [ ] | `packages/desktop/src/i18n/en.ts` (lines 29-39) | Remove updater strings |
| [ ] | `packages/desktop/src/i18n/` (zh.ts, zht.ts, ru.ts, pl.ts, no.ts, ko.ts, ja.ts, fr.ts, es.ts) | Remove corresponding updater strings |
| [ ] | `packages/desktop-electron/src/renderer/i18n/en.ts` (lines 11-21) | Remove updater strings |
| [ ] | `packages/app/src/i18n/en.ts` (lines 469-470, 782-787) | Remove update-related strings |

### Task 1.10: Clean OpenAPI Schema & SDK

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/sdk/openapi.json` | Remove `autoupdate` config field description, remove `Event.installation.updated` and `Event.installation.update-available` event schemas |
| [ ] | `packages/sdk/js/src/gen/types.gen.ts`, `packages/sdk/js/src/v2/gen/types.gen.ts` | Regenerate via `bun run packages/sdk/js/script/build.ts` |

### Task 1.11: Clean Tests

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/opencode/test/config/config.test.ts` | Remove `autoupdate` test cases (lines 1460, 1468, 1476) |

### Task 1.12: Clean Documentation

| [ ] | File(s) | Change |
|-----|---------|--------|
| [ ] | `packages/web/src/content/docs/config.mdx` | Remove `autoupdate` examples and documentation |
| [ ] | `packages/web/src/content/docs/cli.mdx` | Remove `OPENCODE_DISABLE_AUTOUPDATE` flag documentation |
| [ ] | `packages/web/src/content/docs/` (all locale dirs: zh-tw, zh-cn, tr, th, ru, pt-br, pl, nb, ko, ja, it, fr, es, de, da, bs, ar) | Remove corresponding autoupdate references in config.mdx and cli.mdx |

---

## Goal 2: Remove Telemetry Entirely

**Abstract**: Remove PostHog download event tracking from the stats script and strip all OpenTelemetry export infrastructure. The local Effect logger (`EffectLogger.layer`) is preserved — only the OTLP exporter path is removed.

### Task 2.1: Remove PostHog from Stats Script

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `script/stats.ts` | Remove `sendToPostHog()` function (lines 3-29), remove two `sendToPostHog()` calls (lines 204-212). Keep stats calculation, STATS.md generation, GitHub/npm fetching. |

### Task 2.2: Strip OpenTelemetry from Observability Module

**File**: `packages/core/src/effect/observability.ts`

| [ ] | Change | Detail |
|-----|--------|--------|
| [ ] | Remove OTel imports | Lines 2-3: `FetchHttpClient`, `OtlpLogger`, `OtlpSerialization` |
| [ ] | Remove `resource()` function | Lines 24-54 — only used by OTel |
| [ ] | Remove `logs()` function | Lines 56-68 |
| [ ] | Remove `traces()` function | Lines 70-96 |
| [ ] | Remove `base`/`enabled` logic | Lines 9-10 |
| [ ] | Simplify layer export to `export const layer = EffectLogger.layer` | Remove conditional OTel branch |
| [ ] | Simplify `Observability` namespace export | `export const Observability = { layer }` |

**Post-removal the file will be approximately 10 lines:**
```ts
import { EffectLogger } from "../effect/logger"
export const layer = EffectLogger.layer
export const Observability = { layer }
```

All existing consumers (`run-service.ts`, `bootstrap-runtime.ts`, `app-runtime.ts`, `layer.ts`, `server.ts`) import `Observability.layer` — this continues to work unchanged since the module still exports `layer`.

### Task 2.3: Remove OTel from LLM & Agent

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/opencode/src/session/llm.ts` | Remove `@effect/opentelemetry/Tracer` import (line 26), remove `telemetryTracer` creation (lines 396-410), remove `experimental_telemetry` block from `streamText()` (lines 510-518). Keep all other LLM functionality. |
| [ ] | `packages/opencode/src/agent/agent.ts` | Remove `@effect/opentelemetry/Tracer` import (line 23), remove tracer creation (lines 332, 345-351). Keep all other agent functionality. |

### Task 2.4: Remove OTel Env Var Propagation

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/opencode/src/control-plane/workspace.ts` | Remove `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_RESOURCE_ATTRIBUTES` from env object (lines 124-126) |

### Task 2.5: Remove OTel Config & Flags

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/opencode/src/config/config.ts` | Remove `experimental.openTelemetry` field (lines 246-248) |
| [ ] | `packages/core/src/flag/flag.ts` | Remove `OTEL_EXPORTER_OTLP_ENDPOINT` (line 27), `OTEL_EXPORTER_OTLP_HEADERS` (line 28) |

### Task 2.6: Clean Trace Route

**File**: `packages/opencode/src/server/routes/instance/trace.ts`

This file uses `Effect.withSpan()` which is Effect's built-in tracing (not OTel-specific). It can stay but should be reviewed. The `Effect.withSpan()` calls are no-ops without a Tracer provider. **Decision: Keep the file** — it's internal Effect pattern, not external telemetry.

### Task 2.7: Remove OTel Dependencies

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/opencode/package.json` | Remove: `@effect/opentelemetry`, `@opentelemetry/api`, `@opentelemetry/context-async-hooks`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-trace-node` |
| [ ] | `packages/core/package.json` | Remove: `@effect/opentelemetry`, `@opentelemetry/api`, `@opentelemetry/context-async-hooks`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/sdk-trace-base` |
| [ ] | Root `package.json` | Remove `@effect/opentelemetry` from catalog (line 30) |

### Task 2.8: Remove OTel Tests

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/core/test/effect/observability.test.ts` | **Delete** or repurpose for the simplified logger-only module |

### Task 2.9: Verify No Broken Imports

| [ ] | Check | Detail |
|-----|-------|--------|
| [ ] | All files importing `Observability` from `@opencode-ai/core/effect/observability` still compile | The module continues to export `layer` and `Observability` |
| [ ] | `packages/opencode/src/effect/run-service.ts` | `Observability.layer` reference on line 34 unchanged |
| [ ] | `packages/opencode/src/effect/bootstrap-runtime.ts` | `Observability` import unchanged |
| [ ] | `packages/opencode/src/effect/app-runtime.ts` | `Observability` import unchanged |
| [ ] | `packages/opencode/src/cli/cmd/tui/layer.ts` | `Observability` import unchanged |
| [ ] | `packages/opencode/src/server/routes/instance/httpapi/server.ts` | `Observability.layer` reference on line 102 unchanged |

---

## Goal 3: Auth Documentation (Informational Only)

**No removal needed.** The `OPENCODE_AUTH_CONTENT` mechanism was explained to the user:

- Parent process serializes all `auth.json` credentials into `OPENCODE_AUTH_CONTENT` env var when spawning workspace child processes
- Child process's `Auth.all()` checks this env var first before falling back to disk read
- This is strictly an optimization/convenience — workspaces can function without it (they'd fall back to file read)
- No removal action required for any auth code

---

## Execution Order

1. **Phase A — Autoupdate (Goals 1.1-1.4)**: CLI/TUI removal first (least risk)
2. **Phase B — Autoupdate (Goals 1.5-1.7)**: Server routes, desktop apps
3. **Phase C — Autoupdate (Goals 1.8-1.12)**: Web app, i18n, OpenAPI, tests, docs
4. **Phase D — Telemetry (Goals 2.1-2.2)**: PostHog, OTel core
5. **Phase E — Telemetry (Goals 2.3-2.9)**: LLM/agent, config, deps, tests
6. **Phase F — Verification**: Type check, build, search for residual references

**Total files modified**: ~55+
**Total files deleted**: ~4
**Total dependencies removed**: ~10

---

## Oracle Verification

- `bun typecheck` — must pass in `packages/opencode/`
- `bun typecheck` — must pass in `packages/core/`
- `rg -n 'autoupdate|upgrade|update'` — no residual in CLI/desktop source code (excluding legitimate uses like "upgrade" in WebSocket context)
- `rg -n 'PostHog|posthog|OTEL_|opentelemetry|OpenTelemetry'` — no residual in source
- `bun run packages/sdk/js/script/build.ts` — SDK regenerates clean
