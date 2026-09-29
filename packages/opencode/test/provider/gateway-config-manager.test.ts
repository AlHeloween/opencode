import { expect, test } from "bun:test"
import { mergeConfigs, type GatewayConfig } from "../../src/provider/gateway/config-manager"

/**
 * Residual B of `plans/2026-09-29_agents-protocol-and-cursor.md`, found by that plan's live smoke:
 * a local `.opencode/gateway.jsonc` that exists WITHOUT a `providers` key made `mergeConfigs` throw
 * `Object.entries requires that input parameter not be null or undefined` → `instance boot failed`
 * → TUI bootstrap timeout. A parsed hand-made file is not a validated `GatewayConfig`, so the key
 * can be absent.
 */

// A hand-made local file is parsed, not validated — the absent key is the subject of this pin.
const handMadeLocal = { gateway: { enabled: false } } as unknown as GatewayConfig

test("mergeConfigs tolerates a local config without a providers key", async () => {
  const merged = await mergeConfigs(null, handMadeLocal)
  expect(merged.providers).toEqual({})
  expect(merged.gateway?.enabled).toBe(false)
})

test("mergeConfigs still merges local providers over the global ones", async () => {
  const globalConfig = {
    $schema: "https://opencode.ai/config.json",
    providers: { deepseek: { name: "global-name", api: "https://api.deepseek.com" } },
    gateway: { enabled: true, logging: { enabled: false, format: "json" as const } },
  } as unknown as GatewayConfig
  const localConfig = {
    providers: { deepseek: { name: "local-name" } },
  } as unknown as GatewayConfig

  const merged = await mergeConfigs(globalConfig, localConfig)
  expect(merged.providers.deepseek?.name).toBe("local-name")
  expect(merged.providers.deepseek?.api).toBe("https://api.deepseek.com")
})
