import { readWasmAsset } from "./wasm-path"
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
let _cachedMemory: Uint8Array | null = null

function getMemory(m: WebAssembly.Memory): Uint8Array {
  if (!_cachedMemory || _cachedMemory.byteLength === 0) {
    _cachedMemory = new Uint8Array(m.buffer)
  }
  return _cachedMemory
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
      const mod = await WebAssembly.compile(asset.bytes)
      const instance = await WebAssembly.instantiate(mod, imports)
      _wasm = instance.exports as unknown as JsonRepairExports
      _cachedMemory = null
      _wasm.__wbindgen_start()
      Log.Default.warn("json-repair: WASM loaded from " + asset.path)
      return _wasm
    } catch (err) {
      Log.Default.error("json-repair: FATAL load failed: " + (err instanceof Error ? err.message : String(err)))
      return null
    }
  })()
  return _initPromise
}

/**
 * Attempt to repair malformed JSON using json-repair crate (Rust -> WASM).
 * Returns the repaired JSON string, or null if WASM is unavailable
 * or repair fails.
 */
export async function repairJsonWasm(input: string): Promise<string | null> {
  const wasm = await loadRepair()
  if (!wasm) return null
  try {
    const [ptr, len] = passString(wasm, input)
    const ret = wasm.json_repair(ptr, len)
    const result = readString(wasm, ret[0], ret[1])
    wasm.__wbindgen_free(ret[0], ret[1], 1)
    if (!result) { Log.Default.debug("json-repair: returned empty result"); return null }
    JSON.parse(result)
    return result
  } catch (err) {
    Log.Default.debug("json-repair: repair failed: " + (err instanceof Error ? err.message : String(err)))
    return null
  }
}

/** Eager health check — call at startup. Returns true if WASM loaded successfully. */
export async function initJsonRepair(): Promise<boolean> {
  const wasm = await loadRepair()
  return wasm !== null
}

export * as JsonRepairWasmMod from "./json-repair-wasm"

