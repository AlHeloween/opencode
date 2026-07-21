import { readWasmAsset } from "./wasm-path"
import * as Log from "@opencode-ai/core/util/log"

interface AnyrepairExports {
  repair(retptr: number, ptr: number, len: number): void
  repair_with(retptr: number, ptr: number, len: number, fmt_ptr: number, fmt_len: number): void
  repair_json(retptr: number, ptr: number, len: number): void
  repair_xml(retptr: number, ptr: number, len: number): void
  repair_yaml(retptr: number, ptr: number, len: number): void
  repair_toml(retptr: number, ptr: number, len: number): void
  repair_csv(retptr: number, ptr: number, len: number): void
  repair_markdown(retptr: number, ptr: number, len: number): void
  repair_ini(retptr: number, ptr: number, len: number): void
  repair_diff(retptr: number, ptr: number, len: number): void
  repair_properties(retptr: number, ptr: number, len: number): void
  repair_env(retptr: number, ptr: number, len: number): void
  detect(retptr: number, ptr: number, len: number): void
  __wbindgen_add_to_stack_pointer(delta: number): number
  __wbindgen_export(ptr: number, len: number): number       // malloc
  __wbindgen_export2(ptr: number, old_len: number, new_len: number, align: number): number // realloc
  __wbindgen_export3(ptr: number, len: number, align: number): void  // free
  memory: WebAssembly.Memory
}

let _wasm: AnyrepairExports | null = null
let _initPromise: Promise<AnyrepairExports | null> | null = null
let _textDecoder: TextDecoder
let _textEncoder: TextEncoder

function getDataView(m: WebAssembly.Memory): DataView {
  return new DataView(m.buffer)
}

function getUint8Array(m: WebAssembly.Memory): Uint8Array {
  return new Uint8Array(m.buffer)
}

async function loadAnyrepair(): Promise<AnyrepairExports | null> {
  if (_wasm) return _wasm
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    try {
      const asset = await readWasmAsset("anyrepair/anyrepair_wasm_bg.wasm")
      if (!asset.bytes) {
        Log.Default.error("anyrepair: FATAL - WASM file not found, tried: " + JSON.stringify(asset.tried))
        return null
      }
      const imports = { "./anyrepair_wasm_bg.js": {} }
      _textDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true })
      _textEncoder = new TextEncoder()
      const mod = await WebAssembly.compile(asset.bytes!)
      const instance = await WebAssembly.instantiate(mod, imports)
      _wasm = instance.exports as unknown as AnyrepairExports
      Log.Default.info("anyrepair: WASM loaded from " + asset.path)
      return _wasm
    } catch (err) {
      Log.Default.error("anyrepair: FATAL load failed: " + (err instanceof Error ? err.message : String(err)))
      return null
    }
  })()
  return _initPromise
}

// ── String ↔ WASM helpers ────────────────────────────────────────────────

function passString(wasm: AnyrepairExports, s: string): [number, number] {
  let len = s.length
  let ptr = wasm.__wbindgen_export(len, 1) >>> 0
  const mem = getUint8Array(wasm.memory)
  let offset = 0
  for (; offset < len; offset++) {
    const code = s.charCodeAt(offset)
    if (code > 0x7f) break
    mem[ptr + offset] = code
  }
  if (offset !== len) {
    if (offset !== 0) s = s.slice(offset)
    ptr = wasm.__wbindgen_export2(ptr, len, len = offset + s.length * 3, 1) >>> 0
    const view = getUint8Array(wasm.memory).subarray(ptr + offset, ptr + len)
    const ret = _textEncoder.encodeInto(s, view)
    offset += ret.written!
    ptr = wasm.__wbindgen_export2(ptr, len, offset, 1) >>> 0
  }
  return [ptr, offset]
}

function readString(wasm: AnyrepairExports, ptr: number, len: number): string {
  return _textDecoder.decode(getUint8Array(wasm.memory).subarray(ptr >>> 0, (ptr >>> 0) + len))
}

/**
 * Call a 1-arg repair function: func(retptr, ptr, len).
 */
function callRepair1(wasm: AnyrepairExports, func: (retptr: number, ptr: number, len: number) => void, input: string): string | null {
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16)
  let resultPtr = 0
  let resultLen = 0
  try {
    const [ptr, len] = passString(wasm, input)
    func.call(wasm, retptr, ptr, len)
    const dv = getDataView(wasm.memory)
    resultPtr = dv.getInt32(retptr + 0, true)
    resultLen = dv.getInt32(retptr + 4, true)
    if (!resultPtr || !resultLen) return null
    return readString(wasm, resultPtr, resultLen)
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16)
    if (resultPtr) wasm.__wbindgen_export3(resultPtr, resultLen, 1)
  }
}

/**
 * Call a 2-arg repair function: func(retptr, ptr, len, fmt_ptr, fmt_len).
 */
function callRepair2(wasm: AnyrepairExports, func: (retptr: number, ptr: number, len: number, fmt_ptr: number, fmt_len: number) => void, input: string, format: string): string | null {
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16)
  let resultPtr = 0
  let resultLen = 0
  try {
    const [ptr, len] = passString(wasm, input)
    const [fmtPtr, fmtLen] = passString(wasm, format)
    func.call(wasm, retptr, ptr, len, fmtPtr, fmtLen)
    const dv = getDataView(wasm.memory)
    resultPtr = dv.getInt32(retptr + 0, true)
    resultLen = dv.getInt32(retptr + 4, true)
    if (!resultPtr || !resultLen) return null
    return readString(wasm, resultPtr, resultLen)
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16)
    if (resultPtr) wasm.__wbindgen_export3(resultPtr, resultLen, 1)
  }
}

// ── Supported formats ────────────────────────────────────────────────────

/** All format identifiers supported by anyrepair. */
export const FORMATS = [
  "json",
  "xml",
  "yaml",
  "toml",
  "csv",
  "markdown",
  "ini",
  "diff",
  "properties",
  "env",
] as const

export type SupportedFormat = (typeof FORMATS)[number]

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Repair content with an explicit format.
 * Returns the repaired string, or null on failure.
 */
export async function repairWith(input: string, format: SupportedFormat): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try {
    const result = callRepair2(wasm, wasm.repair_with, input, format)
    return result || null
  } catch (err) {
    Log.Default.debug("anyrepair: repair_with failed: " + (err instanceof Error ? err.message : String(err)))
    return null
  }
}

/**
 * Repair any supported format with auto-detection.
 * Returns the repaired string, or null on failure.
 */
export async function repairAny(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try {
    const result = callRepair1(wasm, wasm.repair, input)
    return result || null
  } catch (err) {
    Log.Default.debug("anyrepair: auto-detect repair failed: " + (err instanceof Error ? err.message : String(err)))
    return null
  }
}

// ── Format-specific convenience exports ───────────────────────────────────

export async function repairJson(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try {
    const result = callRepair1(wasm, wasm.repair_json, input)
    if (!result) return null
    JSON.parse(result) // validate
    return result
  } catch {
    return null
  }
}

export async function repairXml(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.repair_xml, input) || null } catch { return null }
}

export async function repairYaml(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.repair_yaml, input) || null } catch { return null }
}

export async function repairToml(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.repair_toml, input) || null } catch { return null }
}

export async function repairCsv(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.repair_csv, input) || null } catch { return null }
}

export async function repairMarkdown(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.repair_markdown, input) || null } catch { return null }
}

export async function repairIni(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.repair_ini, input) || null } catch { return null }
}

export async function repairDiff(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.repair_diff, input) || null } catch { return null }
}

export async function repairProperties(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.repair_properties, input) || null } catch { return null }
}

export async function repairEnv(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.repair_env, input) || null } catch { return null }
}

export async function detectFormat(input: string): Promise<string | null> {
  const wasm = await loadAnyrepair()
  if (!wasm) return null
  try { return callRepair1(wasm, wasm.detect, input) || null } catch { return null }
}

export async function initAnyrepair(): Promise<boolean> {
  const wasm = await loadAnyrepair()
  return wasm !== null
}

export * as AnyrepairWasm from "./anyrepair-wasm"
