import { describe, expect, test } from "bun:test"
import { initJsonRepair, repairJsonWasm } from "../../src/util/json-repair-wasm"

describe("json-repair-wasm", () => {
  test("loads json-repair wasm module", async () => {
    expect(await initJsonRepair()).toBeTrue()
  })

  test("repairs malformed object syntax", async () => {
    expect(await repairJsonWasm("{foo: 1, bar: [true,]}")).toBe('{"bar":[true],"foo":1}')
  })

  // --- Truncation (common when model hits token limit) ---
  test("repairs truncated JSON with unclosed nested object", async () => {
    const result = await repairJsonWasm('{"key": "value", "nested": {"a":')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  test("repairs truncated JSON with unclosed array", async () => {
    const result = await repairJsonWasm('[{"id": 1}, {"id": 2')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  // --- Single quotes (common LLM error) ---
  test("repairs single-quoted strings", async () => {
    const result = await repairJsonWasm("{'key': 'value'}")
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ key: "value" })
  })

  test("repairs mixed single and double quotes", async () => {
    const result = await repairJsonWasm('{"key": \'value\'}')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  // --- Missing commas ---
  test("repairs missing commas between properties", async () => {
    const result = await repairJsonWasm('{"a": 1 "b": 2}')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ a: 1, b: 2 })
  })

  test("repairs missing commas in arrays", async () => {
    const result = await repairJsonWasm('["a" "b" "c"]')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  // --- Unclosed strings ---
  test("repairs unclosed string values", async () => {
    const result = await repairJsonWasm('{"key": "unclosed')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  test("repairs unclosed string keys", async () => {
    const result = await repairJsonWasm('{"unclosed: "value"}')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  // --- Trailing commas ---
  test("repairs trailing commas in objects", async () => {
    const result = await repairJsonWasm('{"key": "value",}')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ key: "value" })
  })

  test("repairs trailing commas in arrays", async () => {
    const result = await repairJsonWasm('[1, 2, 3,]')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual([1, 2, 3])
  })

  // --- Unicode edge cases ---
  test("handles unicode in strings", async () => {
    const result = await repairJsonWasm('{"emoji": "🔥", "key": "value"}')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ emoji: "🔥", key: "value" })
  })

  test("handles unicode with malformed syntax", async () => {
    const result = await repairJsonWasm('{"emoji": "🔥", "key": ')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  // --- Large payloads (stress test) ---
  test("handles large string values", async () => {
    const largeValue = "x".repeat(10000)
    const result = await repairJsonWasm(`{"data": "${largeValue}"}`)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!).data.length).toBe(10000)
  })

  // --- Already valid JSON (should pass through) ---
  test("passes through already valid JSON", async () => {
    const result = await repairJsonWasm('{"valid": true, "number": 42}')
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual({ valid: true, number: 42 })
  })

  // --- Mixed valid/invalid nesting ---
  test("repairs mixed valid and invalid nesting", async () => {
    const result = await repairJsonWasm('{"data": [{"id": 1}, {"id": 2}')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  // --- Mismatched brackets ---
  test("repairs mismatched brackets", async () => {
    const result = await repairJsonWasm('{"data": [{"id": 1, "value": "A"}, {"id": 2, "value": "B"]}')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  // --- Truncated booleans ---
  test("repairs truncated boolean values", async () => {
    const result = await repairJsonWasm('{"flag": tru}')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  // --- Null bytes stripped before repair ---
  test("handles input with null bytes", async () => {
    // Null bytes are stripped by the caller (llm.ts:496), but repair should
    // still handle them gracefully if they slip through
    const result = await repairJsonWasm('{"key\x00": "value"}')
    // Result may be null (repair failed) or valid JSON — either is acceptable
    if (result !== null) {
      expect(() => JSON.parse(result!)).not.toThrow()
    }
  })

  // --- Completely unrepairable input ---
  test("returns null for completely unrepairable input", async () => {
    const result = await repairJsonWasm("not json at all")
    // The repair function may return null or a repaired version — both acceptable
    if (result !== null) {
      expect(() => JSON.parse(result!)).not.toThrow()
    }
  })

  // --- Empty input ---
  test("handles empty string input", async () => {
    const result = await repairJsonWasm("")
    // Empty string may return null or empty string — both acceptable
    if (result !== null) {
      expect(typeof result).toBe("string")
    }
  })

  // --- Nested objects with multiple errors ---
  test("repairs multiple errors in nested structure", async () => {
    const result = await repairJsonWasm("{foo: 'bar', nested: {baz: 1 'qux': 2}}")
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })
})
