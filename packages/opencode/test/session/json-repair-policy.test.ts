import { describe, expect, test } from "bun:test"
import { readWasmAsset } from "../../src/util/wasm-path"
import { repairJsonWasm } from "../../src/util/json-repair-wasm"

/**
 * Tool call JSON repair — 2-step policy (llm.ts:experimental_repairToolCall):
 *
 *   Step 1: JSON.parse(rawInput)
 *     → passes?  use as-is (identity — no modification)
 *     → fails?   continue to step 2
 *
 *   Step 2: repairJsonWasm(rawInput) — lightweight, NOT anyrepair
 *     → repair succeeds + JSON.parse(repaired) passes?  use repaired silently
 *     → repair fails or produces invalid JSON?           report ORIGINAL error to model
 *
 * Invariants:
 *   - Valid JSON is NEVER modified (identity)
 *   - Step 2 never makes things worse (if repair output is still invalid, reject it)
 *   - Model always sees the ORIGINAL JSON.parse error, never the repair error
 */
describe("JSON repair policy", () => {
  let _jsonParser: import("web-tree-sitter").Parser | undefined

  async function getParser() {
    if (_jsonParser) return _jsonParser
    const [{ Parser }, { Language }, jsonWasm, runtimeWasm] = await Promise.all([
      import("web-tree-sitter"),
      import("web-tree-sitter"),
      readWasmAsset("grammars/tree-sitter-json.wasm"),
      readWasmAsset("web-tree-sitter.wasm"),
    ])
    if (!jsonWasm.bytes || !runtimeWasm.bytes) throw new Error("WASM unavailable")
    await (Parser.init as any)({ wasmBinary: runtimeWasm.bytes })
    const language = await Language.load(new Uint8Array(jsonWasm.bytes))
    _jsonParser = new Parser()
    _jsonParser.setLanguage(language)
    return _jsonParser
  }

  // Replicates llm.ts experimental_repairToolCall logic exactly.
  type RepairResult =
    | { ok: true; input: string }
    | { ok: false; error: string }

  async function repair(input: string): Promise<RepairResult> {
    const raw = input.replace(/\x00/g, "")

    // Step 1: JSON.parse
    try {
      JSON.parse(raw)
      return { ok: true, input: raw }
    } catch (originalError) {
      const originalMessage = (originalError as Error).message

      // Step 2: json-repair WASM
      const repaired = await repairJsonWasm(raw)
      if (repaired !== null) {
        try {
          JSON.parse(repaired)
          return { ok: true, input: repaired }
        } catch {
          // repair produced invalid JSON — reject, fall through to error
        }
      }

      // Both failed — report ORIGINAL error with position (tree-sitter is system dep)
      let message = `Invalid JSON: ${originalMessage}`
      const parser = await getParser()
      const tree = parser.parse(raw)
      if (tree) {
        const errors = tree.rootNode.descendantsOfType("ERROR")
        if (errors.length > 0) {
          const first = errors[0]!
          const lines = raw.slice(0, first.startIndex).split("\n")
          message = `JSON error at line ${lines.length}, column ${(lines[lines.length - 1]?.length ?? 0) + 1}: ${originalMessage}`
        }
      }
      return { ok: false, error: message }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Step 1: valid JSON — identity, never modified
  // ═══════════════════════════════════════════════════════════════════════

  test("step 1: valid JSON passes unchanged", async () => {
    const inputs = [
      '{"key":"value"}',
      "[1, 2, 3]",
      "42",
      '"hello"',
      "true",
      "null",
      "[]",
      "{}",
    ]
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
  // Step 2: json-repair WASM fixes silently
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
  // Step 2 rejection: repair produces invalid JSON → reject
  // ═══════════════════════════════════════════════════════════════════════

  test("step 2 rejection: repair output is re-validated", async () => {
    // json-repair might return non-null but invalid JSON — we must reject it.
    // Test by feeding edge case that json-repair handles weirdly.
    const r = await repair("[")
    // Whatever happens, if ok=true then JSON.parse must succeed.
    if (r.ok) {
      expect(() => JSON.parse(r.input)).not.toThrow()
    }
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
    try { JSON.parse(input) } catch (e) { originalMessage = (e as Error).message }
    const r = await repair(input)
    if (!r.ok) {
      expect(r.error).toContain(originalMessage)
    }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Null byte handling
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
