import { describe, expect, test } from "bun:test"
import path from "path"
import {
  formatPathIssues,
  initPathValidator,
  validatePathTs,
  validatePaths,
} from "../../src/util/path-validator"

const worktree = path.resolve("D:", "zPython", "opencode")

describe("path-validator TS", () => {
  test("detects double drive letter and suggests fix", () => {
    const issue = validatePathTs("D:\\D:\\zPython\\cache", { worktree })
    expect(issue?.code).toBe("double_drive")
    expect(issue?.suggestion).toContain("D:")
  })

  test("detects system directory", () => {
    expect(validatePathTs("C:\\Windows\\System32", { worktree })?.code).toBe("system")
    expect(validatePathTs("/etc/passwd", { worktree })?.code).toBe("system")
  })

  test("detects .git path", () => {
    expect(validatePathTs(path.join(worktree, ".git", "config"), { worktree })?.code).toBe("git")
  })

  test("detects outside worktree", () => {
    const issue = validatePathTs("D:\\other\\project\\file.ts", { worktree })
    expect(issue?.code).toBe("outside_worktree")
  })

  test("allows relative and worktree paths", () => {
    expect(validatePathTs("src/tool/bash.ts", { worktree })).toBeNull()
    expect(validatePathTs(path.join(worktree, "src"), { worktree })).toBeNull()
  })

  test("respects sandbox.rules.blocked", () => {
    const issue = validatePathTs(path.join(worktree, "secrets", "key"), {
      worktree,
      rules: { blocked: [path.join(worktree, "secrets")] },
    })
    expect(issue?.code).toBe("blocked")
  })

  test("disabled rules skip checks", () => {
    expect(
      validatePathTs("C:\\Windows\\System32", {
        worktree,
        rules: { system: false, outside: false },
      }),
    ).toBeNull()
  })

  test("formatPathIssues includes suggestion", () => {
    const report = formatPathIssues([
      {
        path: "D:\\D:\\x",
        code: "double_drive",
        message: '"D:\\D:\\x" — invalid: double drive letter',
        suggestion: "use D:\\x",
      },
    ])
    expect(report).toContain("Path issues detected")
    expect(report).toContain("Suggested fix")
  })
})

describe("path-validator WASM", () => {
  test("loads wasm and matches TS for double drive", async () => {
    const ok = await initPathValidator()
    expect(ok).toBe(true)

    const issues = await validatePaths(["D:\\D:\\zPython\\cache"], {
      worktree,
      rules: { missing: false },
    })
    expect(issues.some((i) => i.code === "double_drive")).toBe(true)
  })

  test("wasm detects system and git", async () => {
    const issues = await validatePaths(
      ["C:\\Windows\\System32", path.join(worktree, ".git", "HEAD")],
      { worktree, rules: { missing: false, outside: false } },
    )
    const codes = new Set(issues.map((i) => i.code))
    expect(codes.has("system")).toBe(true)
    expect(codes.has("git")).toBe(true)
  })

  test("wasm outside worktree", async () => {
    const issues = await validatePaths(["D:\\outside\\file"], {
      worktree,
      rules: { missing: false },
    })
    expect(issues.some((i) => i.code === "outside_worktree")).toBe(true)
  })
})
