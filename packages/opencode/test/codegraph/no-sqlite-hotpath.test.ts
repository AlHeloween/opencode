/**
 * Guard: live CodeGraph surfaces must not pull in SQLite reader queries.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const src = path.join(import.meta.dir, "../../src")

function read(rel: string) {
  return readFileSync(path.join(src, rel), "utf-8")
}

describe("codegraph hot paths are MCP-only (no SQLite queries)", () => {
  test("tool/codegraph.ts does not import reader SQL helpers", () => {
    const t = read("tool/codegraph.ts")
    expect(t).toContain("mcp-client")
    expect(t).not.toMatch(/from ["']@\/codegraph\/reader["']/)
    expect(t).not.toContain("bun:sqlite")
    expect(t).not.toContain("symbolsInFilePaths")
    expect(t).not.toContain("callersOf")
  })

  test("snapshot/fossil.ts uses hybrid MCP→SQLite pack not raw reader SQL", () => {
    const t = read("snapshot/fossil.ts")
    expect(t).toContain("mcpTouchThenSqlitePack")
    expect(t).not.toMatch(/symbolsInFilePaths|callersOf/)
    expect(t).not.toContain("bun:sqlite")
    expect(t).toMatch(/from ["']@\/codegraph\/mcp-client["']/)
  })

  test("tool/codegraph uses hybrid pack not MCP prose return", () => {
    const t = read("tool/codegraph.ts")
    expect(t).toContain("mcpTouchQueryThenSqlitePack")
    expect(t).toContain("hybrid.markdown")
    expect(t).toContain("mcp+sqlite")
  })

  test("mcp-client does not open Database (pack is in sqlite-pack.ts)", () => {
    const t = read("codegraph/mcp-client.ts")
    expect(t).not.toContain("bun:sqlite")
    expect(t).not.toContain("new Database")
    expect(t).toContain("callTool")
    expect(t).toContain("mcpTouchThenSqlitePack")
  })
})
