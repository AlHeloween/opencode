import { describe, expect, test } from "bun:test"
import {
  composeIgnoreGlob,
  DEFAULT_IGNORE_PATTERNS,
  PROJECT_GITIGNORE_HEADER,
} from "@/snapshot/ignore-glob"

describe("snapshot ignore-glob defaults", () => {
  test("never track executables, dlls, secrets", () => {
    for (const p of ["*.exe", "*.dll", "config.json", "gateway.jsonc", "auth.json", "*.enc", "*.key"]) {
      expect(DEFAULT_IGNORE_PATTERNS).toContain(p)
    }
  })

  test("build/release dirs and vendored deps ignored", () => {
    for (const p of ["bin", "dist", "build", "Release", "Win64", "external", "vendor", "node_modules", "config"]) {
      expect(DEFAULT_IGNORE_PATTERNS).toContain(p)
    }
  })

  test("ML weights and vector stores ignored", () => {
    for (const p of ["*.gguf", "*.safetensors", "*.onnx", "models", "vectorstore", "chroma", "qdrant"]) {
      expect(DEFAULT_IGNORE_PATTERNS).toContain(p)
    }
  })

  test("tools/ directory itself is NOT ignored (project sources)", () => {
    expect(DEFAULT_IGNORE_PATTERNS).not.toContain("tools")
  })
})

describe("composeIgnoreGlob", () => {
  test("defaults expand twins for bare names (nested path coverage)", () => {
    const out = composeIgnoreGlob([], [])
    expect(out).toContain("node_modules")
    expect(out).toContain("*node_modules") // twin covers packages/x/node_modules
    expect(out).toContain("*.exe") // wildcard patterns are not twinned
  })

  test("gitignore lines pass through and dedup", () => {
    const out = composeIgnoreGlob(["node_modules", "my-special-dir", "*.map"], [])
    expect(out).toContain("my-special-dir")
    expect(out).toContain("*.map")
    // first occurrence wins: default twin stays, gitignore dup dropped
    expect(out.filter((p) => p === "node_modules").length).toBe(1)
  })

  test("manual existing lines survive regeneration (union, no overwrite)", () => {
    const manual = ["my-manual-glob", "/specific/path.txt"]
    const out = composeIgnoreGlob(["fresh-gitignore-line"], manual)
    expect(out).toContain("my-manual-glob")
    expect(out).toContain("/specific/path.txt")
    expect(out).toContain("fresh-gitignore-line")
  })

  test("blank lines and whitespace are dropped", () => {
    const out = composeIgnoreGlob(["  spaced  ", ""], ["\t tabbed "])
    expect(out).not.toContain("")
    expect(out).toContain("spaced")
    expect(out).toContain("tabbed")
  })
})

describe("PROJECT_GITIGNORE_HEADER", () => {
  test("same defaults, no fossil twins, has explanation header", () => {
    expect(PROJECT_GITIGNORE_HEADER.length).toBeGreaterThan(2)
    expect(PROJECT_GITIGNORE_HEADER[0]).toContain("opencode")
    // git syntax: bare name matches at any depth — no *name twins
    expect(PROJECT_GITIGNORE_HEADER).not.toContain("*node_modules")
    expect(PROJECT_GITIGNORE_HEADER).toContain("node_modules")
  })
})
