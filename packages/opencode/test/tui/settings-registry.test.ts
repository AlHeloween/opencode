import { expect, test } from "bun:test"
import * as Config from "../../src/config/config"
import { MODEL_STATE_KEYS, SESSION_SETTINGS_KEYS } from "../../src/session/session-settings"
import { ENV_VARS, SETTINGS_REGISTRY, type SettingRow } from "../../src/cli/cmd/tui/settings/registry"

/**
 * Subplan 03 POLICY TEST (Alexander, 2026-08-31): a setting that exists in the
 * product but is absent from the settings registry/dialog is a BUG. The
 * registry must cover the union of:
 *   - Config.Info schema top-level fields
 *   - session-settings keys (SessionSettings)
 *   - model.json (worktree state) keys
 * plus the documented env-var inventory (master.md group B, read-only rows).
 */

function schemaKeys(): string[] {
  const shape = (Config.Info as unknown as { zod?: { shape?: Record<string, unknown> } }).zod?.shape
  if (!shape) throw new Error("Config.Info.zod.shape is not enumerable — registry coverage cannot be asserted")
  return Object.keys(shape)
}

function configRows(): SettingRow[] {
  return SETTINGS_REGISTRY.filter((row) => row.source === "config")
}

test("registry covers every Config.Info schema top-level field — zero diff", () => {
  const keys = schemaKeys()
  expect(keys.length).toBeGreaterThan(0)
  const covered = new Set(configRows().map((row) => row.schemaKey))
  const missing = keys.filter((key) => !covered.has(key))
  expect(missing).toEqual([])
})

test("registry config rows never reference unknown schema keys", () => {
  const keys = new Set(schemaKeys())
  const unknown = configRows().filter((row) => row.schemaKey && !keys.has(row.schemaKey!))
  expect(unknown.map((row) => row.id)).toEqual([])
})

test("registry covers session-settings keys", () => {
  const covered = new Set(SETTINGS_REGISTRY.filter((row) => row.source === "session").map((row) => row.schemaKey))
  const missing = SESSION_SETTINGS_KEYS.filter((key) => !covered.has(key))
  expect(missing).toEqual([])
})

test("registry covers model.json (worktree state) keys", () => {
  const covered = new Set(SETTINGS_REGISTRY.filter((row) => row.source === "model-state").map((row) => row.schemaKey))
  const missing = MODEL_STATE_KEYS.filter((key) => !covered.has(key))
  expect(missing).toEqual([])
})

test("registry covers the documented env-var inventory (master group B)", () => {
  const documented = ENV_VARS.map((row) => row.name)
  expect(documented).toContain("OPENCODE_CONFIG_CONTENT")
  expect(documented).toContain("OPENCODE_AUTH_CONTENT")
  expect(documented).toContain("OPENCODE_SERVER_PASSWORD")
  expect(documented).toContain("OPENCODE_SERVER_USERNAME")
  expect(documented).toContain("OPENCODE_GATEWAY_LOG_DIR")
  expect(documented).toContain("OPENCODE_PURE")
  expect(documented).toContain("OPENCODE_WASM_ROOT")
  expect(documented).toContain("OPENCODE_SKIP_MIGRATIONS")
  expect(documented).toContain("OPENCODE_ZED_DB")
  expect(documented).toContain("OPENCODE_EDITOR_SSE_PORT")
  // every env row is read-only (runtime env is not writable in-place)
  for (const row of SETTINGS_REGISTRY.filter((r) => r.source === "env")) {
    expect(row.readOnly).toBe(true)
  }
})

test("every registry row has group, title, kind and at least one layer", () => {
  for (const row of SETTINGS_REGISTRY) {
    expect(row.id).toBeTruthy()
    expect(row.group).toBeTruthy()
    expect(row.title).toBeTruthy()
    expect(row.kind).toBeTruthy()
    expect(row.layers.length).toBeGreaterThan(0)
  }
})
