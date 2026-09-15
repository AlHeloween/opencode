/**
 * Grounding test: Windows path split bug fix in ls.ts and ripgrep.ts
 *
 * Verifies that:
 * 1. `.replace(/\\/g, "/").split("/")` correctly splits both Unix and Windows paths
 * 2. Tree rendering produces correct hierarchy for backslash paths
 * 3. Directory comparison works after normalization
 */
import { describe, expect, test } from "bun:test"
import path from "path"

describe("Windows path normalization grounding", () => {
  // Simulates the fix pattern: normalize backslashes before splitting on "/"

  function splitPath(filepath: string): string[] {
    const normalized = filepath.replace(/\\/g, "/")
    return normalized.split("/")
  }

  function normalizeForComparison(filepath: string): string {
    return filepath.replace(/\\/g, "/")
  }

  test("Unix forward-slash paths split correctly (no regression)", () => {
    const unixPaths = [
      "src/tool/ls.ts",
      "packages/opencode/src/index.ts",
      "README.md",
      "src/",
    ]

    for (const p of unixPaths) {
      const parts = splitPath(p)
      // Should produce expected segment count
      const expectedCount = p.split("/").length
      expect(parts.length).toBe(expectedCount)
    }

    // Deep path
    const parts = splitPath("a/b/c/d/e.ts")
    expect(parts).toEqual(["a", "b", "c", "d", "e.ts"])
  })

  test("Windows backslash paths split correctly (the bug fix)", () => {
    const winPaths = [
      { input: "src\\tool\\ls.ts", expected: ["src", "tool", "ls.ts"] },
      { input: "packages\\opencode\\src\\index.ts", expected: ["packages", "opencode", "src", "index.ts"] },
      { input: "D:\\dev\\project\\file.ts", expected: ["D:", "dev", "project", "file.ts"] },
      { input: ".", expected: ["."] },
      { input: "single.ts", expected: ["single.ts"] },
    ]

    for (const { input, expected } of winPaths) {
      const parts = splitPath(input)
      expect(parts).toEqual(expected)
    }
  })

  test("mixed slash paths handle correctly", () => {
    const parts = splitPath("src/tool\\helper.ts")
    expect(parts).toEqual(["src", "tool", "helper.ts"])
  })

  test("tree rendering: directory extraction works for both separators", () => {
    // Simulates the tree algorithm from ls.ts and ripgrep.ts
    const files = [
      "src/tool/ls.ts",
      "src\\tool\\bash.ts", // Windows path
      "src/tool/edit.ts",
      "src\\session\\prompt.ts", // Windows path
      "tests/ls.test.ts",
    ]

    const dirs = new Set<string>()
    const filesByDir = new Map<string, [string, string][]>()

    for (const file of files) {
      const dir = path.dirname(file)
      const normalizedDir = normalizeForComparison(dir)
      // This is what was broken: dir.split("/") on Windows backslash paths
      const parts = normalizedDir === "." ? [] : normalizedDir.split("/")

      for (let i = 0; i <= parts.length; i++) {
        const dirPath = i === 0 ? "." : parts.slice(0, i).join("/")
        dirs.add(dirPath)
      }

      const key = normalizedDir
      if (!filesByDir.has(key)) filesByDir.set(key, [])
      filesByDir.get(key)!.push([file, path.basename(file)])
    }

    // Verify all directories were extracted
    expect(dirs.has(".")).toBe(true)
    expect(dirs.has("src")).toBe(true)
    expect(dirs.has("src/tool")).toBe(true)
    expect(dirs.has("src/session")).toBe(true)
    expect(dirs.has("tests")).toBe(true)

    // Verify files grouped by normalized directory
    const toolFiles = filesByDir.get("src/tool")
    expect(toolFiles).toBeDefined()
    expect(toolFiles!.length).toBe(3) // ls.ts, bash.ts, edit.ts
  })

  test("line 112 comparison: path.dirname vs normalized dirPath", () => {
    // The old code: path.dirname(d) === dirPath
    // On Windows: path.dirname("src\\tool") → "src" (backslash)
    // But dirPath from split+join is "src/tool" (forward slash)
    // → comparison always fails

    const dirs = new Set(["src/tool", "src/session"])
    const dirPath = "src/tool" // from join("/") on split parts

    // OLD (broken on Windows): path.dirname uses OS separator
    const winDir = "src\\tool"
    const oldComparison = path.dirname(winDir) === dirPath
    expect(oldComparison).toBe(false) // BUG: fails on Windows

    // NEW (fixed): normalize before comparison
    const newComparison = normalizeForComparison(winDir) === dirPath
    expect(newComparison).toBe(true) // FIXED
  })

  test("ripgrep.ts tree(): file paths split correctly", () => {
    // The old code: file.split("/")
    // On Windows, ripgrep outputs backslash paths from path.normalize()
    const rgOutput = [
      "src\\tool\\ls.ts",
      "src\\tool\\bash.ts",
      "src\\index.ts",
      "README.md",
    ]

    const root = new Map<string, Map<string, any>>()
    root.set("", new Map())

    for (const file of rgOutput) {
      if (file.includes(".opencode")) continue
      const normalized = normalizeForComparison(file)
      const parts = normalized.split("/")
      if (parts.length < 2) continue

      let node = root
      for (const part of parts.slice(0, -1)) {
        if (!node.has(part)) node.set(part, new Map())
        const child = node.get(part)!
        node = child as any
      }
    }

    // Verify tree structure
    expect(root.has("src")).toBe(true)
    expect(root.has("README.md")).toBe(false) // no dir
  })
})
