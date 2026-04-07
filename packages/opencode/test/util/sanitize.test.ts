import { describe, test, expect } from "bun:test"
import { sanitizeMetadata } from "../../src/util/sanitize"

describe("sanitizeMetadata", () => {
  test("returns null for null", () => {
    expect(sanitizeMetadata(null)).toBeNull()
  })

  test("preserves primitives", () => {
    expect(sanitizeMetadata("hello")).toBe("hello")
    expect(sanitizeMetadata(42)).toBe(42)
  })

  test("strips symbols from objects", () => {
    const sym = Symbol("hidden")
    const obj = { visible: "yes", [sym]: "no" }
    const result = sanitizeMetadata(obj)
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(result).toEqual({ visible: "yes" })
  })

  test("handles nested objects", () => {
    expect(sanitizeMetadata({ outer: { inner: "value" } })).toEqual({ outer: { inner: "value" } })
  })

  test("handles arrays", () => {
    expect(sanitizeMetadata([1, "two", true])).toEqual([1, "two", true])
  })

  test("handles mixed nested structures", () => {
    const obj = { arr: [1, { nested: "value" }], sym: Symbol("x"), plain: "text" }
    const result = sanitizeMetadata(obj)
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(() => structuredClone(result)).not.toThrow()
  })
})
