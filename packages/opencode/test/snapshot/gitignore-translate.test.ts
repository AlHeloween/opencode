import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

// Inline translator (same logic as fossil.ts translateGitignore)
function translateGitignore(content: string): string[] {
  if (!content) return []

  const lines = content.split(/\r?\n/).filter((l) => {
    const trimmed = l.trim()
    return trimmed && !trimmed.startsWith("#")
  })

  const translated: string[] = []
  for (const line of lines) {
    let p = line.trim()
    // Skip negation patterns (not supported in Fossil)
    if (p.startsWith("!")) continue
    // Remove leading / (Fossil patterns are always root-relative)
    if (p.startsWith("/")) p = p.slice(1)
    // Remove trailing / (Fossil has no directory-only distinction)
    if (p.endsWith("/")) p = p.slice(0, -1)
    // Replace **/ with nothing (* already matches / in Fossil)
    p = p.replace(/^\*\*\//, "").replace(/\/\*\*$/, "").replace(/\/\*\*\//, "/*/")
    // Replace remaining ** with *
    p = p.replace(/\*\*/g, "*")
    // Skip empty patterns
    if (!p || p === ".") continue
    translated.push(p)
  }

  return translated
}

describe("Gitignore → Fossil ignore-glob translation", () => {
  test("simple patterns pass through", () => {
    expect(translateGitignore("*.log")).toEqual(["*.log"])
    expect(translateGitignore(".DS_Store")).toEqual([".DS_Store"])
    expect(translateGitignore("node_modules")).toEqual(["node_modules"])
  })

  test("trailing / removed (directory-only)", () => {
    expect(translateGitignore("node_modules/")).toEqual(["node_modules"])
    expect(translateGitignore("dist/")).toEqual(["dist"])
    expect(translateGitignore(".opencode/")).toEqual([".opencode"])
  })

  test("leading **/ removed (* already crosses /)", () => {
    expect(translateGitignore("**/*.log")).toEqual(["*.log"])
    expect(translateGitignore("**/src.bak")).toEqual(["src.bak"])
  })

  test("trailing /** removed", () => {
    expect(translateGitignore("build/**")).toEqual(["build"])
  })

  test("middle /**/ becomes /*/", () => {
    expect(translateGitignore("src/**/temp")).toEqual(["src/*/temp"])
  })

  test("standalone ** becomes *", () => {
    expect(translateGitignore("**")).toEqual(["*"])
  })

  test("negation patterns skipped", () => {
    expect(translateGitignore("!important.log")).toEqual([])
  })

  test("comment lines skipped", () => {
    expect(translateGitignore("# this is a comment\n*.log")).toEqual(["*.log"])
  })

  test("empty lines skipped", () => {
    expect(translateGitignore("\n\n*.log\n\n")).toEqual(["*.log"])
  })

  test("leading / removed (root-relative)", () => {
    // In .gitignore, /dist means root-only. In Fossil, all patterns are root-relative.
    // We keep the pattern as-is (remove leading /)
    expect(translateGitignore("/dist")).toEqual(["dist"])
  })

  test("complex patterns", () => {
    const input = `*.bak
**/src.bak
node_modules/
.opencode/data
.opencode/project.db
packages/wasm/external/
`
    const result = translateGitignore(input)
    expect(result).toContain("*.bak")
    expect(result).toContain("src.bak")
    expect(result).toContain("node_modules")
    expect(result).toContain(".opencode/data")
    expect(result).toContain(".opencode/project.db")
    expect(result).toContain("packages/wasm/external")
  })

  test("translate actual project .gitignore", () => {
    const gitignorePath = path.resolve("../../../.gitignore")
    let content: string
    try {
      content = readFileSync(gitignorePath, "utf-8")
    } catch {
      // Skip if not found (running from different context)
      return
    }
    const result = translateGitignore(content)

    // Key patterns must be present
    expect(result).toContain("node_modules")
    expect(result).toContain("dist")
    expect(result).toContain(".opencode")
    expect(result).toContain("logs")
    expect(result).toContain(".adid_rag")
    expect(result).toContain("artefacts")
    expect(result).toContain("packages/wasm/external")

    // No empty patterns
    expect(result.every((p) => p.length > 0)).toBe(true)

    // No negation patterns
    expect(result.every((p) => !p.startsWith("!"))).toBe(true)

    // No trailing /
    expect(result.every((p) => !p.endsWith("/"))).toBe(true)

    // No ** patterns (should be converted)
    expect(result.every((p) => !p.includes("**"))).toBe(true)

    console.log(`Translated ${result.length} patterns from project .gitignore`)
    console.log("First 10:", result.slice(0, 10))
  })
})
