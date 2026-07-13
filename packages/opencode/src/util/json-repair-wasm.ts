import { readWasmAsset } from "./wasm-path"
import { wasmGate } from "./wasm-mutex"
import * as Log from "@opencode-ai/core/util/log"

interface JsonRepairExports {
  json_repair(ptr: number, len: number): [number, number]
  __wbindgen_malloc(size: number, align: number): number
  __wbindgen_realloc(ptr: number, oldSize: number, newSize: number, align: number): number
  __wbindgen_free(ptr: number, size: number, align: number): void
  __wbindgen_externrefs: WebAssembly.Table
  __wbindgen_start(): void
  memory: WebAssembly.Memory
}

let _wasm: JsonRepairExports | null = null
let _initPromise: Promise<JsonRepairExports | null> | null = null
let _textDecoder: TextDecoder
let _textEncoder: TextEncoder
/**
 * Get a fresh Uint8Array view into WASM memory.
 *
 * DO NOT cache views — WebAssembly.Memory can grow (__wbindgen_realloc),
 * which detaches the underlying ArrayBuffer. A cached Uint8Array pointing
 * to a detached buffer has byteLength === 0 on the *next* check, but any
 * in-flight operation holding the old view will access freed memory.
 * Always create a fresh view to guarantee we're pointing at the current
 * (non-detached) ArrayBuffer.
 */
function getMemory(m: WebAssembly.Memory): Uint8Array {
  return new Uint8Array(m.buffer)
}

function passString(wasm: JsonRepairExports, s: string): [number, number] {
  const buf = _textEncoder.encode(s)
  const ptr = wasm.__wbindgen_malloc(buf.length, 1) >>> 0
  getMemory(wasm.memory).subarray(ptr, ptr + buf.length).set(buf)
  return [ptr, buf.length]
}

function readString(wasm: JsonRepairExports, ptr: number, len: number): string {
  return _textDecoder.decode(getMemory(wasm.memory).subarray(ptr >>> 0, (ptr >>> 0) + len))
}

async function loadRepair(): Promise<JsonRepairExports | null> {
  if (_wasm) return _wasm
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    try {
      const asset = await readWasmAsset("json_repair/json_repair_bg.wasm")
if (!asset.bytes) {
  Log.Default.error("json-repair: FATAL - WASM file not found, tried: " + JSON.stringify(asset.tried))
  return null
}

      const imports = {
        "./json_repair_bg.js": {
          __wbindgen_init_externref_table: () => {
            if (!_wasm) return
            const table = _wasm.__wbindgen_externrefs
            const offset = table.grow(4)
            table.set(0, undefined)
            table.set(offset + 0, undefined)
            table.set(offset + 1, null)
            table.set(offset + 2, true)
            table.set(offset + 3, false)
          },
        },
      }

      _textDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true })
      _textEncoder = new TextEncoder()
      const mod = await wasmGate("json-repair-compile", () => WebAssembly.compile(asset.bytes!))
      const instance = await wasmGate("json-repair-instantiate", () => WebAssembly.instantiate(mod, imports))
      _wasm = instance.exports as unknown as JsonRepairExports
      _wasm.__wbindgen_start()
      Log.Default.info("json-repair: WASM loaded from " + asset.path)
      return _wasm
    } catch (err) {
      Log.Default.error("json-repair: FATAL load failed: " + (err instanceof Error ? err.message : String(err)))
      return null
    }
  })()
  return _initPromise
}

/**
 * Replace ASCII single quotes used as JSON string delimiters with double quotes.
 *
 * This is the most common LLM JSON error — models emit
 *   {'key': 'value', 'nested': {'inner': 'val'}}
 * instead of valid JSON
 *   {"key": "value", "nested": {"inner": "val"}}
 *
 * Strategy:
 * 1. If NO double quotes exist in the input → blanket replace all ' with "
 *    (covers >99% of LLM cases: the entire payload uses single-quote delimiters)
 * 2. If mixed quotes → char-by-char parser that only converts ' outside "..."
 *    strings, leaving apostrophes inside double-quoted strings untouched.
 */
function repairSingleQuotes(input: string): string {
  if (!input.includes("'")) return input

  // Case 1: no double quotes at all → safe blanket replacement.
  // Every ' must be a JSON delimiter since valid JSON uses " for strings.
  if (!input.includes('"')) {
    return input.replace(/'/g, '"')
  }

  // Case 2: mixed single and double quotes → parse char by char.
  let result = ""
  let inString = false   // inside a "..." double-quoted string
  let escaped = false

  for (const ch of input) {
    if (escaped) {
      result += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      result += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }
    if (ch === "'" && !inString) {
      // This ' is a JSON delimiter (not inside a "..." string) → replace with "
      result += '"'
      continue
    }
    result += ch
  }

  return result
}

/**
 * Normalize Unicode smart/curly quotes, dashes, and other common LLM
 * Unicode artefacts to their ASCII equivalents before JSON repair.
 * JSON.parse does not accept U+201C/U+201D (curly double quotes) or
 * U+2018/U+2019 (curly single quotes), and the WASM json-repair crate
 * only handles ASCII single quotes, not Unicode variants.
 */
function normalizeUnicode(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // single smart quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // double smart quotes
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-") // dashes
    .replace(/\u00A0/g, " ") // non-breaking space
}

/**
 * Attempt to repair malformed JSON using json-repair crate (Rust -> WASM).
 * Returns the repaired JSON string, or null if WASM is unavailable
 * or repair fails.
 *
 * Automatically normalizes Unicode smart quotes and dashes before
 * passing to WASM, since the Rust crate only handles ASCII quotes.
 */
export async function repairJsonWasm(input: string): Promise<string | null> {
  const wasm = await loadRepair()
  if (!wasm) return null
  return wasmGate("json-repair", async () => {
    try {
      // Step 1: repair ASCII single-quote delimiters BEFORE Unicode normalization.
      const withDoubleQuotes = repairSingleQuotes(input)

      // Step 2: normalize Unicode smart quotes, dashes, etc. to ASCII.
      const normalized = normalizeUnicode(withDoubleQuotes)

      const [ptr, len] = passString(wasm, normalized)
      const ret = wasm.json_repair(ptr, len)
      const result = readString(wasm, ret[0], ret[1])
      wasm.__wbindgen_free(ret[0], ret[1], 1)
      if (!result) { Log.Default.debug("json-repair: returned empty result"); return null }
      JSON.parse(result)
      return result
    } catch (err) {
      // Pure-JS fallback: try the single-quote fix as a last resort.
      try {
        const asciiRepaired = repairSingleQuotes(input)
        if (asciiRepaired !== input) {
          JSON.parse(asciiRepaired)
          Log.Default.debug("json-repair: pure-js fallback succeeded after WASM failed")
          return asciiRepaired
        }
      } catch { /* fallback also failed, continue to return null */ }

      Log.Default.debug("json-repair: repair failed: " + (err instanceof Error ? err.message : String(err)))
      return null
    }
  })
}

/** Eager health check — call at startup. Returns true if WASM loaded successfully. */
export async function initJsonRepair(): Promise<boolean> {
  const wasm = await loadRepair()
  return wasm !== null
}

export * as JsonRepairWasmMod from "./json-repair-wasm"
