import { describe, expect, test } from "bun:test"
import { resolveDebugConfig } from "@/provider/gateway/debug-config"

describe("gateway debug configuration", () => {
  test("keeps diagnostic logging opt-in when configuration is absent", () => {
    expect(resolveDebugConfig(null, null)).toEqual({
      debug: false,
      logBodies: false,
      logResponseBodies: false,
      perRequest: false,
    })
  })
})
