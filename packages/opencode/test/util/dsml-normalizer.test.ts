import { describe, expect, test } from "bun:test"
import {
  normalizeDsmlTokens,
  extractInlineToolCalls,
  detectDisguisedToolCalls,
  DEFAULT_KNOWN_TOOL_IDS,
  knownToolIdsForTurn,
} from "../../src/util/dsml-normalizer"

describe("dsml-normalizer", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Level 1: DSML token normalization
  // ═══════════════════════════════════════════════════════════════════════

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

  // ── V4-specific: compact DSML without newlines ─────────────────────────
  test("normalizes compact DSML — invoke with attributes", () => {
    const input = '<||DSML||invoke name="web_search">'
    const result = normalizeDsmlTokens(input)
    expect(result).toBe('<｜DSML｜invoke name="web_search">')
  })

  test("normalizes compact DSML — parameter with string=true", () => {
    const input = '<||DSML||parameter name="query" string="true">capital of France</||DSML||parameter>'
    const result = normalizeDsmlTokens(input)
    expect(result).toBe('<｜DSML｜parameter name="query" string="true">capital of France</｜DSML｜parameter>')
  })

  test("normalizes full DSML block — multi-tool real-world example from HF#209", () => {
    const input = [
      'I will search several relevant directions first.',
      '<||DSML||tool_calls>',
      '<||DSML||invoke name="doc_knowlegebase">',
      '<||DSML||parameter name="query" string="true">bond detail fields display</||DSML||parameter>',
      '</||DSML||invoke>',
      '<||DSML||invoke name="web_search">',
      '<||DSML||parameter name="query" string="true">latest AI news</||DSML||parameter>',
      '</||DSML||invoke>',
      '</||DSML||tool_calls>',
    ].join("")
    const result = normalizeDsmlTokens(input)
    expect(result).toContain("｜DSML｜tool_calls")
    expect(result).toContain("｜DSML｜invoke")
    expect(result).toContain("｜DSML｜parameter")
    expect(result).not.toContain("||DSML||")
  })

  test("normalizes self-closing DSML tag", () => {
    const input = '<||DSML||web_search/>'
    const result = normalizeDsmlTokens(input)
    expect(result).toBe('<｜DSML｜web_search/>')
  })

  test("normalizes mixed full-width || in degraded tokens", () => {
    // DeepSeek sometimes emits ｜｜ (full-width double pipes) instead of ||
    const input = "<｜｜DSML｜｜tool_calls>"
    const result = normalizeDsmlTokens(input)
    expect(result).toBe("<｜DSML｜tool_calls>")
  })

  test("normalizes DSML with Chinese text prefix — exact DeepSeek V4 pattern", () => {
    const input = '我先并行搜索几个关键方向：<||DSML||tool_calls><||DSML||invoke name="search"><||DSML||parameter name="q" string="true">test</||DSML||parameter></||DSML||invoke></||DSML||tool_calls>'
    const result = normalizeDsmlTokens(input)
    expect(result).toContain("我先并行搜索几个关键方向：")
    expect(result).toContain("｜DSML｜tool_calls")
    expect(result).not.toContain("||DSML||")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Level 2: Inline tool-call extraction
  // ═══════════════════════════════════════════════════════════════════════

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
    expect(result).toBeNull()
  })

  // ── V4-specific: real production patterns ──────────────────────────────
  test("extracts DeepSeek bug #1244 pattern — Chinese text + inline tool", () => {
    const input = '数据还不够完整，让我继续获取更详细的指标。\nbatch_crawl_url_and_answer{"jobs": [{"url": "https://example.com", "questions_to_answer": ["All benchmark scores"]}]}'
    // Custom tool not in default allowlist — pass null to accept any name
    const result = extractInlineToolCalls(input, null)
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("batch_crawl_url_and_answer")
    expect(result![0]!.input).toContain('"url"')
  })

  test("extracts tool call with nested JSON object", () => {
    const input = 'edit{"filePath": "/src/foo.ts", "oldString": "const x = 1;", "newString": "const x = 2;"}'
    const result = extractInlineToolCalls(input)
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("edit")
    const args = JSON.parse(result![0]!.input)
    expect(args.filePath).toBe("/src/foo.ts")
    expect(args.oldString).toBe("const x = 1;")
    expect(args.newString).toBe("const x = 2;")
  })

  test("extracts tool call with array argument", () => {
    const input = 'multiedit{"filePath": "/x.ts", "edits": [{"old": "a", "new": "b"}, {"old": "c", "new": "d"}]}'
    const result = extractInlineToolCalls(input)
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("multiedit")
    const args = JSON.parse(result![0]!.input)
    expect(args.edits).toHaveLength(2)
  })

  test("extracts tool call preceded by reasoning text", () => {
    const input = 'I should write a file now.\nwrite{"filePath": "out.txt", "content": "done"}'
    const result = extractInlineToolCalls(input)
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("write")
  })

  test("duplicate tool calls are deduplicated", () => {
    const input = 'write{"filePath": "a.txt", "content": "x"}\nwrite{"filePath": "a.txt", "content": "x"}'
    const result = extractInlineToolCalls(input)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1) // deduplicated
  })

  test("extracts tool calls mixed with unknown function names", () => {
    // Default allowlist: only known wire tools (processor uses this).
    const input = 'unknown_tool{"arg": 1}\nwrite{"filePath": "f.txt", "content": "hi"}'
    const result = extractInlineToolCalls(input)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1)
    expect(result![0]!.name).toBe("write")
  })

  test("allowlist rejects prose config{...} false positive", () => {
    const input = 'Use config{ "a": 1 } in the file and call write{"filePath":"x","content":"y"}'
    const result = extractInlineToolCalls(input, DEFAULT_KNOWN_TOOL_IDS)
    expect(result).not.toBeNull()
    expect(result!.map((t) => t.name)).toEqual(["write"])
  })

  test("null allowlist keeps unknown tool names (legacy)", () => {
    const input = 'unknown_tool{"arg": 1}\nwrite{"filePath": "f.txt", "content": "hi"}'
    const result = extractInlineToolCalls(input, null)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(2)
  })

  test("detectDisguised ignores non-tool prose JSON with allowlist", () => {
    const result = detectDisguisedToolCalls(
      "stop",
      'Here is config{"timeout": 30} for the server settings.',
      DEFAULT_KNOWN_TOOL_IDS,
    )
    expect(result).toBeNull()
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Level 3: Disguised tool call detection
  // ═══════════════════════════════════════════════════════════════════════

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
    expect(result).toBeNull()
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

  test("detects disguised tool calls with finish_reason=length (truncation)", () => {
    const input = 'bash{"command": "npm install", "description": "Install deps"}'
    const result = detectDisguisedToolCalls("length", input)
    // "length" also triggers detection — truncated responses may contain inline calls
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("bash")
  })

  test("ignores very short content (<10 chars)", () => {
    const result = detectDisguisedToolCalls("stop", "short")
    expect(result).toBeNull()
  })

  test("detects non-English inline tool calls (Russian)", () => {
    const input = 'Понял, пробую:\nwrite{"filePath": "D:\\\\test.txt", "content": "hello"}'
    const result = detectDisguisedToolCalls("stop", input)
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("write")
  })

  test("detects multi-line content with inline tool call at end", () => {
    const input = `Let me analyze the code first.
The issue is in the auth module.
I'll fix it now.
edit{"filePath": "/src/auth.ts", "oldString": "return null", "newString": "return user"}`
    const result = detectDisguisedToolCalls("stop", input)
    expect(result).not.toBeNull()
    expect(result![0]!.name).toBe("edit")
  })

  test("knownToolIdsForTurn: empty → default; custom id accepted only when live", () => {
    expect(knownToolIdsForTurn(undefined)).toBe(DEFAULT_KNOWN_TOOL_IDS)
    expect(knownToolIdsForTurn({})).toBe(DEFAULT_KNOWN_TOOL_IDS)

    const live = knownToolIdsForTurn({ my_plugin_tool: {} as any, Write: {} as any })
    expect(live.has("myplugintool")).toBe(true)
    expect(live.has("write")).toBe(true)

    const customOnly = 'my_plugin_tool{"x": 1}'
    expect(detectDisguisedToolCalls("stop", customOnly, DEFAULT_KNOWN_TOOL_IDS)).toBeNull()
    expect(detectDisguisedToolCalls("stop", customOnly, live)).not.toBeNull()
    expect(detectDisguisedToolCalls("stop", customOnly, live)![0]!.name).toBe("my_plugin_tool")
  })
})
