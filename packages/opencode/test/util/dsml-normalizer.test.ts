import { describe, expect, test } from "bun:test"
import {
  normalizeDsmlTokens,
  extractInlineToolCalls,
  detectDisguisedToolCalls,
} from "../../src/util/dsml-normalizer"

describe("dsml-normalizer", () => {
  // ── Level 1: DSML token normalization ───────────────────────────────
  test("normalizes degraded || pipes to full-width ｜", () => {
    const input = "<||DSML||tool_calls>"
    const result = normalizeDsmlTokens(input)
    expect(result).toBe("<｜DSML｜tool_calls>")
  })

  test("normalizes closing tag with degraded pipes", () => {
    const input = "</||DSML||tool_calls>"
    const result = normalizeDsmlTokens(input)
    expect(result).toBe("</｜DSML｜tool_calls>")
  })

  test("handles mixed spaces in degraded tokens", () => {
    const input = "< | | DSML | | tool_calls>"
    const result = normalizeDsmlTokens(input)
    expect(result).toBe("<｜DSML｜tool_calls>")
  })

  test("passes through canonical DSML unchanged", () => {
    const input = "<｜DSML｜tool_calls>"
    const result = normalizeDsmlTokens(input)
    expect(result).toBe(input)
  })

  test("does not touch unrelated text", () => {
    const input = "Here is some regular || text || with pipes"
    const result = normalizeDsmlTokens(input)
    expect(result).toBe(input)
  })

  // ── Level 2: Inline tool-call extraction ─────────────────────────────
  test("extracts single inline tool call", () => {
    const input = 'write{"filePath": "/tmp/test.txt", "content": "hello"}'
    const result = extractInlineToolCalls(input)
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("write")
    expect(result![0]!.input).toContain('"filePath"')
  })

  test("extracts multiple inline tool calls", () => {
    const input = `First: read{"filePath": "/a.txt"}
Then: write{"filePath": "/b.txt", "content": "ok"}`
    const result = extractInlineToolCalls(input)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(2)
    expect(result![0]!.name).toBe("read")
    expect(result![1]!.name).toBe("write")
  })

  test("returns null when no tool calls present", () => {
    const input = "Just some regular text without any tool calls"
    const result = extractInlineToolCalls(input)
    expect(result).toBeNull()
  })

  test("skips non-JSON patterns that look like tool calls", () => {
    const input = "user{this is not json}"
    const result = extractInlineToolCalls(input)
    // The braces contain non-JSON — should not be extracted
    expect(result).toBeNull()
  })

  // ── Level 3: Disguised tool call detection ───────────────────────────
  test("detects disguised tool calls with finish_reason=stop", () => {
    const result = detectDisguisedToolCalls(
      "stop",
      'write{"filePath": "/f.py", "content": "print(1)"}',
    )
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("write")
  })

  test("ignores content when finish_reason is tool-calls", () => {
    const result = detectDisguisedToolCalls(
      "tool-calls",
      'write{"filePath": "/f.py", "content": "x"}',
    )
    expect(result).toBeNull() // only triggers on "stop"
  })

  test("ignores empty content", () => {
    const result = detectDisguisedToolCalls("stop", "")
    expect(result).toBeNull()
  })

  test("handles DeepSeek-pro hybrid case — reasoning then inline tool", () => {
    const input = `Я создам файл:
write{"filePath": "/tmp/test.py", "content": "print('hello')"}`
    const result = detectDisguisedToolCalls("stop", input)
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("write")
  })
})
