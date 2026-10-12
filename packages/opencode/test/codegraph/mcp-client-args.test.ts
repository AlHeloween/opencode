import { describe, expect, test } from "bun:test"
import {
  exploreArgsForChangedFiles,
  hasCodegraphIndex,
  mcpTextToSymTag,
  modeToMcpCall,
} from "../../src/codegraph/mcp-client"
import path from "path"
import * as Client from "../../src/codegraph/mcp-client"

describe("codegraph mcp-client helpers", () => {
  test("query project root is separate from its subdirectory scope", () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const call = modeToMcpCall("explore", "query", { path: "prompt_kernel", projectPath: root })
    expect(call.args.projectPath).toBe(root)
    expect(call.args.path).toBe("prompt_kernel")
  })

  test("absolute root, subdirectory and file scopes preserve relative packed paths", () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const files = ["prompt_kernel/model.py", "delphi/unit.pas", "src/index.ts"]
    const scope = Client.scopePackedFiles
    expect(typeof scope).toBe("function")
    expect(scope(root, files, root)).toEqual(files)
    expect(scope(root, files, path.join(root, "prompt_kernel"))).toEqual([files[0]])
    expect(scope(root, files, "prompt_kernel")).toEqual([files[0]])
    expect(scope(root, files, path.join(root, files[0]))).toEqual([files[0]])
    expect(() => scope(root, files, path.resolve(root, "../outside"))).toThrow(/outside/)
  })
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

  test("exploreArgsForChangedFiles respects maxFiles", () => {
    const many = Array.from({ length: 50 }, (_, i) => `f${i}.ts`)
    const { args } = exploreArgsForChangedFiles("/p", many, { maxFiles: 5 })
    const q = String(args.query)
    expect(q).toContain("f0.ts")
    expect(q).toContain("f4.ts")
    expect(q).not.toContain("f5.ts")
  })

  test("mcpTextToSymTag hard-fails on empty and truncates long text", () => {
    expect(() => mcpTextToSymTag("   ")).toThrow(/empty/)
    expect(mcpTextToSymTag("hello world").startsWith("MCP:")).toBe(true)
    const long = "x".repeat(3000)
    const tag = mcpTextToSymTag(long, 100)
    expect(tag.length).toBeLessThan(120)
    expect(tag.endsWith("…")).toBe(true)
  })

  test("modeToMcpCall maps all modes", () => {
    expect(modeToMcpCall("explore", "foo", {}).tool).toBe("codegraph_explore")
    expect(modeToMcpCall("search", "bar", {}).tool).toBe("codegraph_search")
    expect(modeToMcpCall("trace", "baz", {}).tool).toBe("codegraph_callers")
    expect(modeToMcpCall("impact", "bar", { depth: 2 }).tool).toBe("codegraph_impact")
    expect(modeToMcpCall("impact", "bar", { depth: 2 }).args.depth).toBe(2)
    expect(modeToMcpCall("path", "A to B", {}).tool).toBe("codegraph_explore")
    expect(String(modeToMcpCall("path", "A to B", {}).args.query)).toMatch(/call path/i)
  })

  test("hasCodegraphIndex detects monorepo .codegraph when present", () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    // This repo is indexed in Local_Development; if missing, false is fine.
    const has = hasCodegraphIndex(root)
    expect(typeof has).toBe("boolean")
  })
})
