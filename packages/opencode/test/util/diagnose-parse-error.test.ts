import { describe, expect, test } from "bun:test"
import { diagnoseParseError } from "../../src/util/diagnose-parse-error"

describe("diagnoseParseError", () => {
  test("unterminated string", () => {
    const result = diagnoseParseError("JSON Parse error: Unterminated string")
    expect(result).toContain("Unterminated string")
    expect(result).toContain("Hint:")
    expect(result).toContain("closing")
    expect(result).toContain('"')
  })

  test("unexpected token", () => {
    const result = diagnoseParseError("JSON Parse error: Unexpected token '}'")
    expect(result).toContain("Hint:")
    expect(result).toContain("syntax error")
  })

  test("unexpected end", () => {
    const result = diagnoseParseError("JSON Parse error: Unexpected end of JSON input")
    expect(result).toContain("Hint:")
    expect(result).toContain("truncated")
  })

  test("generic fallback", () => {
    const result = diagnoseParseError("some unknown error")
    expect(result).toContain("Hint:")
    expect(result).toContain("malformed")
  })
})
