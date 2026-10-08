import { describe, expect, test } from "bun:test"
import {
  buildMcpConfig,
  parseMcpCommand,
  validateMcpName,
  validateMcpUrl,
} from "../../src/cli/cmd/tui/component/mcp-add-state"

/**
 * The add-connector wizard's rules (plan 2026-10-08_mcps-connector-manager, S4):
 * what name the config file will accept, how a typed command line becomes argv, and
 * which `oauth` key a choice writes. These are the promises the dialog makes to the
 * user before it touches their config file — so they are pinned here, not in a render
 * tree.
 */
describe("validateMcpName", () => {
  test("requires a non-empty name", () => {
    expect(validateMcpName("")).toBe("Required")
    expect(validateMcpName("   ")).toBe("Required")
  })

  test("accepts slug spellings and rejects anything else", () => {
    expect(validateMcpName("canva")).toBeUndefined()
    expect(validateMcpName("Canva-MCP_2")).toBeUndefined()
    expect(validateMcpName("canva mcp")).toBe("Use letters, digits, - and _ only")
    expect(validateMcpName("canva/mcp")).toBe("Use letters, digits, - and _ only")
  })

  test("rejects a name that already exists", () => {
    expect(validateMcpName("canva", ["canva"])).toBe('"canva" already exists')
    expect(validateMcpName(" canva ", ["canva"])).toBe('"canva" already exists')
  })
})

describe("validateMcpUrl", () => {
  test("requires a parseable URL", () => {
    expect(validateMcpUrl("")).toBe("Required")
    expect(validateMcpUrl("not a url")).toBe("Enter a valid URL (e.g. https://example.com/mcp)")
    expect(validateMcpUrl("https://api.canva.com/connect/v1/mcp")).toBeUndefined()
  })
})

describe("parseMcpCommand", () => {
  test("splits on runs of whitespace and drops empties", () => {
    expect(parseMcpCommand("npx -y @modelcontextprotocol/server-filesystem")).toEqual([
      "npx",
      "-y",
      "@modelcontextprotocol/server-filesystem",
    ])
    expect(parseMcpCommand("  bun   run   server  ")).toEqual(["bun", "run", "server"])
    expect(parseMcpCommand("   ")).toEqual([])
  })
})

describe("buildMcpConfig", () => {
  test("local → argv command", () => {
    expect(buildMcpConfig({ type: "local", command: "npx -y demo" })).toEqual({
      type: "local",
      command: ["npx", "-y", "demo"],
    })
  })

  test("remote auto → NO oauth key (the server auto-detects, incl. DCR)", () => {
    expect(buildMcpConfig({ type: "remote", url: "https://mcp.canva.com/mcp", oauth: "auto" })).toEqual({
      type: "remote",
      url: "https://mcp.canva.com/mcp",
    })
    expect(buildMcpConfig({ type: "remote", url: "https://mcp.canva.com/mcp" })).toEqual({
      type: "remote",
      url: "https://mcp.canva.com/mcp",
    })
  })

  test("remote off → oauth:false (disable auto-detection)", () => {
    expect(buildMcpConfig({ type: "remote", url: "https://x/mcp", oauth: "off" })).toEqual({
      type: "remote",
      url: "https://x/mcp",
      oauth: false,
    })
  })

  test("remote client → oauth credentials, trimmed, empties dropped", () => {
    expect(
      buildMcpConfig({
        type: "remote",
        url: "https://x/mcp",
        oauth: "client",
        clientId: " id ",
        clientSecret: " sec ",
      }),
    ).toEqual({ type: "remote", url: "https://x/mcp", oauth: { clientId: "id", clientSecret: "sec" } })
    expect(buildMcpConfig({ type: "remote", url: "https://x/mcp", oauth: "client", clientId: "id" })).toEqual({
      type: "remote",
      url: "https://x/mcp",
      oauth: { clientId: "id" },
    })
  })
})
