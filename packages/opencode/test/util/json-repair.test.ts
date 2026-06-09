import { describe, expect, test } from "bun:test"
import { repairJson } from "../../src/util/json-repair"

describe("repairJson", () => {
  test("returns valid JSON as-is (fast path)", () => {
    const input = '{"question":"test","options":[{"label":"A","description":"desc"}],"header":"Test"}'
    const result = repairJson(input)
    expect(result).toBe(input)
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  test("repairs extra closing square bracket (exact reported bug)", () => {
    // The exact error pattern: "}]}]}" instead of "}]}"
    const input =
      '{"questions":[{"question":"test","options":[{"label":"A","description":"desc"}],"header":"Test"}]}]}'
    const expected =
      '{"questions":[{"question":"test","options":[{"label":"A","description":"desc"}],"header":"Test"}]}'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual(JSON.parse(expected))
  })

  test("repairs extra closing curly bracket", () => {
    const input = '{"key":"value"}}'
    const expected = '{"key":"value"}'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual(JSON.parse(expected))
  })

  test("repairs trailing comma before closing bracket", () => {
    const input = '["a","b",]'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual(["a", "b"])
  })

  test("repairs trailing comma before closing brace", () => {
    const input = '{"a":1,"b":2,}'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ a: 1, b: 2 })
  })

  test("extracts valid JSON prefix from garbage suffix", () => {
    const input = '{"a":1} trailing garbage text'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ a: 1 })
  })

  test("repairs trailing comma + extra bracket combined", () => {
    const input = '{"items":[1,2,]}]'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ items: [1, 2] })
  })

  test("returns null for irreparably broken JSON", () => {
    expect(repairJson("not json at all")).toBeNull()
    expect(repairJson('{missing-quotes: true}')).toBeNull()
    expect(repairJson("")).toBeNull()
    expect(repairJson("[unclosed")).toBeNull()
  })

  test("handles nested objects with bracket repair", () => {
    const input =
      '{"outer":{"inner":{"key":"val"}}}}'
    const expected = '{"outer":{"inner":{"key":"val"}}}'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual(JSON.parse(expected))
  })

  test("preserves array content during bracket repair", () => {
    const input = '[1,2,{"a":[3,4]}]]'
    const expected = '[1,2,{"a":[3,4]}]'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual(JSON.parse(expected))
  })
})
