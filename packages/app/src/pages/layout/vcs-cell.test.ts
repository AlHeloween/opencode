import { describe, expect, test } from "bun:test"
import { describeVcs } from "./vcs-cell"

describe("describeVcs", () => {
  test("names backend and branch", () => {
    expect(describeVcs({ backend: "git", branch: "Local_Development" }).label).toBe("git · Local_Development")
  })
  test("backend alone when no branch", () => {
    expect(describeVcs({ backend: "git" }).label).toBe("git")
  })
  test("no source reads unknown, never blank", () => {
    expect(describeVcs({}).label).toBe("unknown")
    expect(describeVcs({}).label.length).toBeGreaterThan(0)
  })
})
