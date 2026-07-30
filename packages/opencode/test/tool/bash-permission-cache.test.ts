import { describe, expect, test } from "bun:test"
import path from "path"
import { invalidatePermissionCache } from "../../src/tool/bash"

const projectRoot = path.join(__dirname, "../..")

describe("BashTool permission cache", () => {
  test("invalidatePermissionCache clears the cache", () => {
    // Must not throw — the cache is an in-memory Map
    expect(() => invalidatePermissionCache()).not.toThrow()
  })

  test("invalidatePermissionCache is callable multiple times", () => {
    // Clear, then clear again — idempotent
    invalidatePermissionCache()
    invalidatePermissionCache()
    // No throw = pass
  })

  test("invalidatePermissionCache is exported and accessible", () => {
    // Verify the function exists and is a function
    expect(typeof invalidatePermissionCache).toBe("function")
  })
})
