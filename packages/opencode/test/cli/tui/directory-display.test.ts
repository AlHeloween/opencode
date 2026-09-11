import { describe, expect, test } from "bun:test"
import { formatProjectDirectory, isSameDirectory } from "../../../src/cli/cmd/tui/util/directory-display"

describe("formatProjectDirectory", () => {
  test("keeps the project folder visible at the worktree root", () => {
    expect(
      formatProjectDirectory({
        directory: "D:\\zPython\\opencode",
        worktree: "D:\\zPython\\opencode",
        branch: "Local_Development",
      }),
    ).toBe("~/opencode:Local_Development")
  })

  test("keeps the project folder visible for worktree subdirectories", () => {
    expect(
      formatProjectDirectory({
        directory: "D:\\zPython\\opencode\\packages\\opencode",
        worktree: "D:\\zPython\\opencode",
        branch: "Local_Development",
      }),
    ).toBe("~/opencode/packages/opencode:Local_Development")
  })

  test("leaves directories outside the worktree as normalized paths", () => {
    expect(
      formatProjectDirectory({
        directory: "D:\\zPython\\other",
        worktree: "D:\\zPython\\opencode",
      }),
    ).toBe("D:/zPython/other")
  })
})

describe("isSameDirectory", () => {
  test("equal paths match regardless of separator, case, and trailing slash", () => {
    expect(isSameDirectory("D:\\zPython\\opencode", "d:/zPython/opencode/")).toBe(true)
  })

  test("different paths do not match", () => {
    expect(isSameDirectory("D:\\zPython\\opencode", "D:\\zPython\\other")).toBe(false)
  })

  test("undefined never matches", () => {
    expect(isSameDirectory(undefined, "D:\\zPython\\opencode")).toBe(false)
    expect(isSameDirectory("D:\\zPython\\opencode", undefined)).toBe(false)
  })
})
