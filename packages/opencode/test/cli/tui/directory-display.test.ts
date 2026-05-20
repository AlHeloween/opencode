import { describe, expect, test } from "bun:test"
import { formatProjectDirectory } from "../../../src/cli/cmd/tui/util/directory-display"

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
