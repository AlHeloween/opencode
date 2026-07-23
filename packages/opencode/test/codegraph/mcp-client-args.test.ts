import { describe, expect, test } from "bun:test"
import { exploreArgsForChangedFiles, mcpTextToSymTag, modeToMcpCall } from "../../src/codegraph/mcp-client"

describe("codegraph mcp-client helpers", () => {
  test("exploreArgsForChangedFiles matches smoke query shape", () => {
    const { tool, args } = exploreArgsForChangedFiles("/proj", [
      "packages/opencode/src/session/compaction.ts",
      "packages/opencode/src/tool/bash.ts",
    ])
    expect(tool).toBe("codegraph_explore")
    expect(args.projectPath).toBe("/proj")
    expect(String(args.query)).toContain("Structural impact")
    expect(String(args.query)).toContain("compaction.ts")
    expect(String(args.query)).toContain("bash.ts")
  })

  test("mcpTextToSymTag hard-fails on empty", () => {
    expect(() => mcpTextToSymTag("   ")).toThrow(/empty/)
    expect(mcpTextToSymTag("hello world").startsWith("MCP:")).toBe(true)
  })

  test("modeToMcpCall maps impact and explore", () => {
    expect(modeToMcpCall("explore", "foo", {}).tool).toBe("codegraph_explore")
    expect(modeToMcpCall("impact", "bar", { depth: 2 }).tool).toBe("codegraph_impact")
    expect(modeToMcpCall("impact", "bar", { depth: 2 }).args.depth).toBe(2)
  })
})
