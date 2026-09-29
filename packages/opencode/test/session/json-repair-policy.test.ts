import { describe, expect, test } from "bun:test"
import { repairToolCall } from "../../src/session/tool-call-repair"

/**
 * Tool call JSON repair — the policy `llm.ts` applies to a malformed tool call.
 *
 * These tests drive the REAL `repairToolCall`. The mirror that used to live here was a second
 * description of one rule and had already drifted: it still accepted any parseable repair while
 * the bridge had grown the syntax-only gate (2026-09-29).
 *
 *   Step 1: JSON.parse(rawInput) passes → identity, the input is never modified
 *   Step 2: repairJsonWasm → parses AND every string value intact → used silently
 *   Step 3: otherwise the ORIGINAL parse error is thrown, with line/column when tree-sitter
 *           finds an ERROR node — the AI SDK hands that error to the model
 */
type RepairResult = { ok: true; input: string } | { ok: false; error: string }

const call = (input: string, toolName = "bash") => ({
  type: "tool-call" as const,
  toolCallId: "call-1",
  toolName,
  input,
})

async function repair(input: string): Promise<RepairResult> {
  try {
    const fixed = await repairToolCall(call(input), new Error("Invalid JSON"), { bash: {} })
    return { ok: true, input: String(fixed.input) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

describe("JSON repair policy", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Step 1: valid JSON — identity, never modified
  // ═══════════════════════════════════════════════════════════════════════

  test("step 1: valid JSON passes unchanged", async () => {
    const inputs = ['{"key":"value"}', "[1, 2, 3]", "42", '"hello"', "true", "null", "[]", "{}"]
    for (const input of inputs) {
      const r = await repair(input)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.input).toBe(input)
    }
  })

  test("step 1: complex valid JSON passes unchanged", async () => {
    const input = JSON.stringify({
      tool: "read",
      params: { filePath: "/tmp/test.txt", offset: 1, limit: 100 },
    })
    const r = await repair(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.input).toBe(input)
  })

  test("step 1: JSON with whitespace preserved", async () => {
    const input = '{\n  "a": 1,\n  "b": 2\n}'
    const r = await repair(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.input).toBe(input)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Step 2: json-repair WASM fixes silently — syntax only
  // ═══════════════════════════════════════════════════════════════════════

  test("step 2: trailing comma in array repaired", async () => {
    const r = await repair("[1, 2, 3,]")
    expect(r.ok).toBe(true)
    if (r.ok) {
      JSON.parse(r.input) // must be valid
      expect(JSON.parse(r.input)).toEqual([1, 2, 3])
    }
  })

  test("step 2: trailing comma in object repaired", async () => {
    const r = await repair('{"a": 1, "b": 2,}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      JSON.parse(r.input)
      expect(JSON.parse(r.input)).toEqual({ a: 1, b: 2 })
    }
  })

  test("step 2: single-quoted strings repaired", async () => {
    const r = await repair("{'key': 'value'}")
    expect(r.ok).toBe(true)
    if (r.ok) {
      JSON.parse(r.input)
      expect(JSON.parse(r.input)).toEqual({ key: "value" })
    }
  })

  test("step 2: unclosed string repaired", async () => {
    const r = await repair('{"key": "value}')
    expect(r.ok).toBe(true)
    if (r.ok) JSON.parse(r.input)
  })

  test("step 2: unclosed brace repaired", async () => {
    const r = await repair('{"key": "value"')
    expect(r.ok).toBe(true)
    if (r.ok) JSON.parse(r.input)
  })

  test("step 2: missing colon repaired", async () => {
    const r = await repair('{"key" "value"}')
    expect(r.ok).toBe(true)
    if (r.ok) JSON.parse(r.input)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Step 2 rejection: a repair that changes content is NOT a repair
  // ═══════════════════════════════════════════════════════════════════════

  test("step 2 rejection: repair output is re-validated", async () => {
    // json-repair might return non-null but invalid JSON — we must reject it.
    const r = await repair("[")
    // Whatever happens, if ok=true then JSON.parse must succeed.
    if (r.ok) {
      expect(() => JSON.parse(r.input)).not.toThrow()
    }
  })

  test("step 2 rejection: a repair that eats quotes or backslashes is refused (windows shapes)", async () => {
    // Measured 2026-09-29: on malformed input the crate returned
    //   cmd /c cd /d D:dir && .un.exe
    // for the model's `cmd /c "cd /d D:\dir && .\run.exe"` — parseable, silently different, RUN.
    // The bridge refuses it, so the model gets its own error back and fixes the escaping.
    const r = await repair(`{"command":"cmd /c "cd /d D:\\dir && .\\run.exe""}`)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("JSON")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Step 3: both fail → original error reported
  // ═══════════════════════════════════════════════════════════════════════

  test("step 3: error message contains 'JSON'", async () => {
    const r = await repair("{")
    if (!r.ok) {
      expect(r.error).toContain("JSON")
    }
  })

  test("step 3: error shows ORIGINAL error, not repair error", async () => {
    // The model must see why JSON.parse failed, not why repair failed.
    const input = "definitely not json"
    let originalMessage = ""
    try {
      JSON.parse(input)
    } catch (e) {
      originalMessage = (e as Error).message
    }
    const r = await repair(input)
    if (!r.ok) {
      expect(r.error).toContain(originalMessage)
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Null bytes and tool-name normalization
  // ═══════════════════════════════════════════════════════════════════════

  test("null bytes stripped before parse", async () => {
    const r = await repair('{"key":\x00 "value"}')
    // null byte stripped → "{'key': "value"}" which json-repair should fix
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.input).not.toContain("\x00")
      JSON.parse(r.input)
    }
  })

  test("tool name is lower-cased when the SDK knows that name", async () => {
    const fixed = await repairToolCall(call('{"command":"echo hi"}', "Bash"), new Error("nope"), {
      bash: {},
    })
    expect(fixed.toolName).toBe("bash")
    expect(fixed.input).toBe('{"command":"echo hi"}')
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Identity: repair must be idempotent
  // ═══════════════════════════════════════════════════════════════════════

  test("identity: repair is idempotent for valid JSON", async () => {
    const input = '{"a": 1, "b": [2, 3]}'
    const r1 = await repair(input)
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      // Running repair again on the output should be a no-op
      const r2 = await repair(r1.input)
      expect(r2.ok).toBe(true)
      if (r2.ok) expect(r2.input).toBe(r1.input)
    }
  })

  test("identity: repair is idempotent for repaired JSON", async () => {
    const input = "[1, 2, 3,]"
    const r1 = await repair(input)
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      const r2 = await repair(r1.input)
      expect(r2.ok).toBe(true)
      if (r2.ok) expect(r2.input).toBe(r1.input)
    }
  })
})
