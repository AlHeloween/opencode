import * as Log from "@opencode-ai/core/util/log"
import type { Parser as TreeSitterParser } from "web-tree-sitter"
import { repairJsonWasm } from "@/util/json-repair-wasm"
import { readWasmAsset } from "@/util/wasm-path"

/**
 * Tool-call repair — the policy a malformed tool call meets before it reaches a tool.
 *
 * Extracted from `llm.ts` so the test drives THIS function instead of a mirror of it: a mirror is
 * a second description of one rule, and the measured drift was silent — the mirror still told the
 * pre-2026-09-29 story (any parseable repair is used) while the bridge had already grown the
 * syntax-only gate.
 *
 *   1. tool name, lower-cased, when the SDK knows that name
 *   2. null bytes stripped — they break `JSON.parse`
 *   3. `JSON.parse` passes → the input is used as-is (identity: valid JSON is never modified)
 *   4. `repairJsonWasm` → a repair that parses AND left every string value intact is used
 *      SILENTLY; the bridge refuses a content-changing repair (`json-repair-wasm.ts`)
 *   5. otherwise THROW the ORIGINAL parse error with its line/column; the AI SDK hands it to the
 *      model, which regenerates the call
 */
export interface ToolCallRepairLog {
  info(message: string, data?: Record<string, unknown>): void
}

// ── Tree-sitter JSON parser (lazy) ───────────────────────────────────────────

let _jsonParserPromise: Promise<TreeSitterParser> | undefined

async function getJsonParser(): Promise<TreeSitterParser> {
  if (_jsonParserPromise) return _jsonParserPromise
  _jsonParserPromise = (async () => {
    const [{ Parser }, { Language }, jsonWasm, runtimeWasm] = await Promise.all([
      import("web-tree-sitter"),
      import("web-tree-sitter"),
      readWasmAsset("grammars/tree-sitter-json.wasm"),
      readWasmAsset("web-tree-sitter.wasm"),
    ])
    if (!jsonWasm.bytes) throw new Error("tree-sitter-json grammar unavailable")
    if (!runtimeWasm.bytes) throw new Error("tree-sitter runtime unavailable")
    await (Parser.init as any)({ wasmBinary: runtimeWasm.bytes })
    const language = await Language.load(new Uint8Array(jsonWasm.bytes))
    const parser = new Parser()
    parser.setLanguage(language)
    return parser
  })()
  return _jsonParserPromise
}

/**
 * @returns the tool call to use — the same call with `toolName` normalized, or with `input`
 * replaced by the repair. `T` keeps the SDK's own call shape; only those two fields can change.
 * @throws the ORIGINAL `JSON.parse` error (with line/column when tree-sitter finds one) — step 5.
 */
export async function repairToolCall<T extends { toolName: string; input: unknown }>(
  toolCall: T,
  error: Error,
  tools: Record<string, unknown>,
  log: ToolCallRepairLog = Log.Default,
): Promise<T> {
  log.info("repair callback invoked", {
    tool: toolCall.toolName,
    inputLen: String(toolCall.input).length,
    error: error.message,
  })
  // Case-insensitive tool name fix (e.g. "Bash" → "bash")
  const lower = toolCall.toolName.toLowerCase()
  if (lower !== toolCall.toolName && tools[lower]) {
    log.info("repairing tool call", { tool: toolCall.toolName, repaired: lower })
    return { ...toolCall, toolName: lower } as T
  }
  // Strip null bytes — they break JSON.parse.
  const rawInput = String(toolCall.input).replace(/\x00/g, "")

  // Step 1: try JSON.parse — the authoritative validity check.
  try {
    JSON.parse(rawInput)
    return { ...toolCall, input: rawInput } as T
  } catch (originalError) {
    const originalMessage = (originalError as Error).message

    // Step 2: lightweight JSON repair (json-repair WASM, not anyrepair).
    // If repair fixes it — use silently, model doesn't need to know. The bridge owns the
    // re-validation: non-null means it parsed AND every string value survived.
    const repaired = await repairJsonWasm(rawInput)
    if (repaired !== null) {
      log.info("repaired malformed JSON in tool call (json-repair)", {
        tool: toolCall.toolName,
      })
      return { ...toolCall, input: repaired } as T
    }

    // Step 3: repair failed. Tell model the ORIGINAL error + position
    // so it can correct and retry the tool call.
    // Throw (don't return "invalid") — the AI SDK surfaces this
    // error to the model, which then regenerates the tool call.
    // tree-sitter JSON is a system dependency — always available.
    const jsonParser = await getJsonParser()
    const tree = jsonParser.parse(rawInput)
    let message = `Invalid JSON: ${originalMessage}`
    if (tree) {
      const errors = tree.rootNode.descendantsOfType("ERROR")
      if (errors.length > 0) {
        const first = errors[0]!
        const lines = rawInput.slice(0, first.startIndex).split("\n")
        message = `JSON error at line ${lines.length}, column ${(lines[lines.length - 1]?.length ?? 0) + 1}: ${originalMessage}`
      }
    }
    log.info("tool call JSON parse error — throwing for model retry", {
      tool: toolCall.toolName,
      error: message,
    })
    throw new Error(message)
  }
}
