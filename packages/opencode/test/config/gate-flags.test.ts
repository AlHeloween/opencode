import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Flag, resetConfig } from "@opencode-ai/core/flag/flag"
import * as Config from "../../src/config/config"
import { SETTINGS_REGISTRY } from "../../src/cli/cmd/tui/settings/registry"
import { graphFirstDisabled } from "../../src/session/graph-first"
import { docReadDisabled } from "../../src/session/doc-read"
import { stopCheckDisabled } from "../../src/session/stop-check"
import { isCodegraphMcpOptOut } from "../../src/config/codegraph-mcp-auto"
import { isSelfEditEnabled } from "../../src/session/self-edit"

/**
 * t76-minimum (owner 2026-10-16): the five behavior switches that live only
 * behind env — GRAPH_FIRST, DOC_READ_GATE, STOP_CHECK, CODEGRAPH_MCP,
 * SELF_EDIT_DIRECTIVE — get real `features.*` config keys, so /config shows
 * them with a value always (including default) and they edit via /config and
 * /edit-config. Priority is env > config (named here, tested below).
 * MARKDOWN is untouched (AGENTS.md: default true, DO NOT TOUCH).
 */

const ENVS = [
  "OPENCODE_GRAPH_FIRST",
  "OPENCODE_DOC_READ_GATE",
  "OPENCODE_STOP_CHECK",
  "OPENCODE_CODEGRAPH_MCP",
  "OPENCODE_SELF_EDIT_DIRECTIVE",
] as const

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  resetConfig()
  savedEnv = {}
  for (const name of ENVS) {
    savedEnv[name] = process.env[name]
    delete process.env[name]
  }
})

afterEach(() => {
  for (const name of ENVS) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
  resetConfig()
})

function decodeFeatures(raw: unknown) {
  return Schema.decodeUnknownSync(Config.Info)({ features: raw }) as Config.Info
}

describe("t76-minimum schema: five features.* keys exist", () => {
  test("decode keeps graphFirst/docReadGate/stopCheck/codegraphMcp/selfEditDirective", () => {
    const decoded = decodeFeatures({
      graphFirst: false,
      docReadGate: false,
      stopCheck: false,
      codegraphMcp: false,
      selfEditDirective: true,
    })
    expect(decoded.features?.graphFirst).toBe(false)
    expect(decoded.features?.docReadGate).toBe(false)
    expect(decoded.features?.stopCheck).toBe(false)
    expect(decoded.features?.codegraphMcp).toBe(false)
    expect(decoded.features?.selfEditDirective).toBe(true)
  })
})

describe("t76-minimum registry: five editable boolean rows", () => {
  for (const key of ["graphFirst", "docReadGate", "stopCheck", "codegraphMcp", "selfEditDirective"]) {
    test(`config.features.${key} row exists, boolean, editable`, () => {
      const row = SETTINGS_REGISTRY.find((r) => r.schemaKey === `features.${key}`)
      expect(row).toBeDefined()
      expect(row!.kind).toBe("boolean")
      expect(row!.readOnly).not.toBe(true)
      expect(row!.layers.length).toBeGreaterThan(0)
    })
  }
})

describe("t76-minimum priority: env > config > default", () => {
  test("graph-first: env opt-out wins over config-enabled; env enabled-spelling wins over config-disabled", () => {
    Flag._setTest("OPENCODE_GRAPH_FIRST", true)
    process.env["OPENCODE_GRAPH_FIRST"] = "0"
    expect(graphFirstDisabled({ ...process.env })).toBe(true)
    Flag._setTest("OPENCODE_GRAPH_FIRST", false)
    process.env["OPENCODE_GRAPH_FIRST"] = "1"
    expect(graphFirstDisabled({ ...process.env })).toBe(false)
  })

  test("graph-first: config decides when env is unset; default is enabled", () => {
    Flag._setTest("OPENCODE_GRAPH_FIRST", false)
    expect(graphFirstDisabled({})).toBe(true)
    Flag._setTest("OPENCODE_GRAPH_FIRST", true)
    expect(graphFirstDisabled({})).toBe(false)
    resetConfig()
    expect(graphFirstDisabled({})).toBe(false)
  })

  test("doc-read/stop-check/codegraph: config-disabled holds with env unset", () => {
    Flag._setTest("OPENCODE_DOC_READ_GATE", false)
    expect(docReadDisabled({})).toBe(true)
    Flag._setTest("OPENCODE_STOP_CHECK", false)
    expect(stopCheckDisabled({})).toBe(true)
    Flag._setTest("OPENCODE_CODEGRAPH_MCP", false)
    expect(isCodegraphMcpOptOut({})).toBe(true)
  })

  test("self-edit: env wins over config; config enables with env unset; default is off", () => {
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    process.env["OPENCODE_SELF_EDIT_DIRECTIVE"] = "0"
    expect(isSelfEditEnabled({ ...process.env })).toBe(false)
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", false)
    process.env["OPENCODE_SELF_EDIT_DIRECTIVE"] = "1"
    expect(isSelfEditEnabled({ ...process.env })).toBe(true)
    delete process.env["OPENCODE_SELF_EDIT_DIRECTIVE"]
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    expect(isSelfEditEnabled({})).toBe(true)
    resetConfig()
    expect(isSelfEditEnabled({})).toBe(false)
  })

  test("Flag getters honor env > config", () => {
    Flag._setTest("OPENCODE_GRAPH_FIRST", false)
    process.env["OPENCODE_GRAPH_FIRST"] = "1"
    expect(Flag.OPENCODE_GRAPH_FIRST).toBe(true)
    Flag._setTest("OPENCODE_SELF_EDIT_DIRECTIVE", true)
    process.env["OPENCODE_SELF_EDIT_DIRECTIVE"] = "false"
    expect(Flag.OPENCODE_SELF_EDIT_DIRECTIVE).toBe(false)
  })
})
