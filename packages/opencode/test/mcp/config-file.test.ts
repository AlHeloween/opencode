import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { addMcpToConfig, resolveConfigPath } from "../../src/mcp/config-file"

/**
 * The shared MCP config writer (plan 2026-10-08_mcps-connector-manager, S4). It was moved
 * out of `cli/cmd/mcp.ts` so the TUI wizard and `opencode mcp add` write through ONE path —
 * these cases read the ARTIFACT back, because a write path is proven by what landed on disk,
 * not by the call returning.
 */
async function tempDir() {
  return mkdtemp(path.join(tmpdir(), "opencode-mcp-config-"))
}

describe("addMcpToConfig", () => {
  test("merges mcp.<name> and preserves hand-written comments", async () => {
    const dir = await tempDir()
    try {
      const file = path.join(dir, "opencode.json")
      await writeFile(file, `{\n  // keep me\n  "theme": "dark"\n}\n`)

      const used = await addMcpToConfig("canva", { type: "remote", url: "https://api.canva.com/connect/v1/mcp" }, file)

      expect(used).toBe(file)
      const text = await readFile(file, "utf8")
      // jsonc-parser rewrites only the addressed subtree, so the comment and the sibling key survive
      expect(text).toContain("// keep me")
      expect(text).toContain('"theme": "dark"')
      expect(text).toContain('"canva"')
      expect(text).toContain("https://api.canva.com/connect/v1/mcp")
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 })
    }
  })

  test("creates a valid file when none existed", async () => {
    const dir = await tempDir()
    try {
      const file = path.join(dir, "opencode.json")
      await addMcpToConfig("demo", { type: "local", command: ["echo", "demo"] }, file)

      const parsed = JSON.parse(await readFile(file, "utf8"))
      expect(parsed.mcp.demo).toEqual({ type: "local", command: ["echo", "demo"] })
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 })
    }
  })
})

describe("resolveConfigPath", () => {
  test("prefers an existing file, otherwise defaults to opencode.json", async () => {
    const dir = await tempDir()
    try {
      expect(await resolveConfigPath(dir)).toBe(path.join(dir, "opencode.json"))
      await writeFile(path.join(dir, "opencode.jsonc"), "{}\n")
      expect(await resolveConfigPath(dir)).toBe(path.join(dir, "opencode.jsonc"))
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 })
    }
  })
})
