import { describe, expect, test } from "bun:test"
import { repairJson, diagnoseParseError } from "../../src/util/json-repair"

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

  // --- control character escaping tests ---

  test("escapes literal newline inside JSON string", () => {
    // Build a JSON string with a literal LF byte (0x0A) inside the string value.
    // In JS, "\n" in a regular string literal produces a literal newline byte —
    // NOT the two characters backslash+n. So this creates invalid JSON that
    // needs repair.
    const input = '{"prompt":"' + "line1\nline2" + '"}'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ prompt: "line1\nline2" })
  })

  test("escapes literal tab inside JSON string", () => {
    const input = `{"prompt":"col1\tcol2"}`
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ prompt: "col1\tcol2" })
  })

  test("preserves already-escaped sequences unchanged", () => {
    // already-escaped \\n should pass through without double-escaping
    const input = '{"prompt":"line1\\\\nline2"}'
    const result = repairJson(input)
    expect(result).toBe(input) // fast path: already valid JSON
    expect(JSON.parse(result!)).toEqual({ prompt: "line1\\nline2" })
  })

  test("escapes literal newline + repairs trailing comma", () => {
    // Literal newline inside string AND trailing comma before }
    const input = `{"prompt":"line1\nline2",}`
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ prompt: "line1\nline2" })
  })

  test("escapes literal newline + repairs extra bracket", () => {
    // Literal newline inside string AND extra closing bracket
    const input = `{"prompt":"line1\nline2"}}`
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ prompt: "line1\nline2" })
  })

  test("escapes multiple control chars in multi-line prompt (task tool scenario)", () => {
    // Simulates a task/explore tool call with multi-line prompt
    const input =
      '{"description":"analyze bugs","prompt":"Research task.\n\n1. Find all callers.\n2. Check tests.","subagent_type":"explore"}'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    const parsed = JSON.parse(result!)
    expect(parsed.description).toBe("analyze bugs")
    expect(parsed.subagent_type).toBe("explore")
    expect(parsed.prompt).toContain("Research task.")
    expect(parsed.prompt).toContain("1. Find all callers.")
  })

  test("handles control chars outside strings (edge case)", () => {
    // Control chars outside JSON strings are unusual but should pass through
    // (or at least not corrupt the repair)
    const result = repairJson(" \t\n\r ") // whitespace-only, not valid JSON
    expect(result).toBeNull()
  })

  // --- unterminated string repair (Strategy 3.5) ---

  test("closes unterminated string + missing closing brace", () => {
    const input = '{"description":"test","prompt":"hello'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    const parsed = JSON.parse(result!)
    expect(parsed.description).toBe("test")
    expect(parsed.prompt).toBe("hello")
  })

  test("closes unterminated string in nested object", () => {
    const input = '{"outer":{"inner":"val'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ outer: { inner: "val" } })
  })

  test("closes unterminated string in array context", () => {
    const input = '[{"a":"b","c":"hello'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual([{ a: "b", c: "hello" }])
  })

  test("closes unterminated string with literal newline (combo with Strategy 1)", () => {
    const input = '{"prompt":"line1\nline2'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    const parsed = JSON.parse(result!)
    expect(parsed.prompt).toBe("line1\nline2")
  })

  test("handles unterminated string with escaped quote inside", () => {
    // Escaped quote \" should not toggle inString, so we correctly detect untermination
    const input = '{"a":"b\\"c'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    const parsed = JSON.parse(result!)
    expect(parsed.a).toBe('b"c')
  })

  test("closes multiple unterminated levels (string + array + object)", () => {
    // Deeply nested: object contains array contains unterminated string
    const input = '{"items":[{"key":"val'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ items: [{ key: "val" }] })
  })

  // --- diagnoseParseError tests ---

  test("diagnoseParseError: unterminated string", () => {
    const result = diagnoseParseError("JSON Parse error: Unterminated string")
    expect(result).toContain("Unterminated string")
    expect(result).toContain("Hint:")
    expect(result).toContain("closing")
    expect(result).toContain('"')
  })

  test("diagnoseParseError: unexpected token", () => {
    const result = diagnoseParseError("JSON Parse error: Unexpected token '}'")
    expect(result).toContain("Hint:")
    expect(result).toContain("syntax error")
  })

  test("diagnoseParseError: unexpected end", () => {
    const result = diagnoseParseError("JSON Parse error: Unexpected end of JSON input")
    expect(result).toContain("Hint:")
    expect(result).toContain("truncated")
  })

  test("diagnoseParseError: generic fallback", () => {
    const result = diagnoseParseError("some unknown error")
    expect(result).toContain("Hint:")
    expect(result).toContain("malformed")
  })

  // --- single-quote to double-quote conversion tests ---

  test("converts single-quoted JSON to double-quoted", () => {
    const input = "{'prompt':'hello','subagent_type':'explore'}"
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ prompt: "hello", subagent_type: "explore" })
  })

  test("converts single-quoted JSON with nested objects", () => {
    const input = "{'key':'value','nested':{'a':'b'}}"
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ key: "value", nested: { a: "b" } })
  })

  test("converts single-quoted JSON with arrays", () => {
    const input = "{'items':['a','b','c']}"
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ items: ["a", "b", "c"] })
  })

  test("handles escaped single quotes inside single-quoted strings", () => {
    const input = `{'prompt':'it\\'s a test'}`
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!).prompt).toBe("it's a test")
  })

  test("handles double quotes inside single-quoted strings", () => {
    const input = `{'prompt':'he said "hello"'}`
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!).prompt).toBe('he said "hello"')
  })

  test("handles double quotes inside single-quoted strings", () => {
    const input = `{'prompt':'he said "hello"'}`
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!).prompt).toBe('he said "hello"')
  })

  test("preserves apostrophes in English text", () => {
    // he's, don't — these are NOT delimiters
    const input = '{"prompt":"he\'s a developer who doesn\'t write python"}'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!).prompt).toBe("he's a developer who doesn't write python")
  })

  test("converts single-quoted JSON with trailing comma", () => {
    const input = "{'prompt':'hello','subagent_type':'explore',}"
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ prompt: "hello", subagent_type: "explore" })
  })
})
