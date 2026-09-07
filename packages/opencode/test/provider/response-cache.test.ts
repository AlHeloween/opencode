import { describe, expect, test } from "bun:test"
import { responseCacheHeaders } from "@/provider/response-cache"

describe("responseCacheHeaders (OpenRouter response caching opt-in)", () => {
  test("non-openrouter providers never get cache headers", () => {
    expect(responseCacheHeaders("opencode-go", { responseCache: true })).toEqual({})
    expect(responseCacheHeaders("anthropic", { responseCache: true, responseCacheTtl: 86400 })).toEqual({})
  })

  test("openrouter without opt-in returns empty (default behavior unchanged)", () => {
    expect(responseCacheHeaders("openrouter", {})).toEqual({})
    expect(responseCacheHeaders("openrouter", { responseCache: false })).toEqual({})
    expect(responseCacheHeaders("openrouter", undefined)).toEqual({})
  })

  test("openrouter opt-in emits enable header", () => {
    expect(responseCacheHeaders("openrouter", { responseCache: true })).toEqual({
      "X-OpenRouter-Cache": "true",
    })
  })

  test("ttl clamps to documented 1-86400 range and truncates", () => {
    expect(responseCacheHeaders("openrouter", { responseCache: true, responseCacheTtl: 86400 })).toEqual({
      "X-OpenRouter-Cache": "true",
      "X-OpenRouter-Cache-TTL": "86400",
    })
    expect(responseCacheHeaders("openrouter", { responseCache: true, responseCacheTtl: 100000 })["X-OpenRouter-Cache-TTL"]).toBe(
      "86400",
    )
    expect(responseCacheHeaders("openrouter", { responseCache: true, responseCacheTtl: 0 })["X-OpenRouter-Cache-TTL"]).toBe(
      "1",
    )
    expect(responseCacheHeaders("openrouter", { responseCache: true, responseCacheTtl: 1.9 })["X-OpenRouter-Cache-TTL"]).toBe(
      "1",
    )
  })

  test("invalid ttl omitted, valid enable header still present", () => {
    const out = responseCacheHeaders("openrouter", { responseCache: true, responseCacheTtl: "abc" })
    expect(out["X-OpenRouter-Cache"]).toBe("true")
    expect(out["X-OpenRouter-Cache-TTL"]).toBeUndefined()
  })
})
