import { describe, expect, test } from "bun:test"
import { invalidatePermissionCache } from "../../src/tool/bash"
import {
  invalidatePermissionCache as invalidateFromModule,
  permissionCacheHit,
  permissionCacheKey,
  permissionCacheSet,
} from "../../src/tool/permission-cache"

describe("BashTool permission cache", () => {
  test("shared cache hit/miss and clear", () => {
    const key = permissionCacheKey("bash", ["ls", "pwd"])
    invalidateFromModule()
    expect(permissionCacheHit(key)).toBe(false)
    permissionCacheSet(key)
    expect(permissionCacheHit(key)).toBe(true)
    invalidatePermissionCache()
    expect(permissionCacheHit(key)).toBe(false)
  })

  test("bash re-exports the shared invalidate helper", () => {
    expect(invalidatePermissionCache).toBe(invalidateFromModule)
  })

  test("invalidatePermissionCache is callable multiple times", () => {
    invalidatePermissionCache()
    invalidatePermissionCache()
    expect(typeof invalidatePermissionCache).toBe("function")
  })
})
