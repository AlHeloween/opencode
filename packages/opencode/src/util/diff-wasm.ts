import { readWasmAsset } from "./wasm-path"
import { wasmGate } from "./wasm-mutex"
import * as Log from "@opencode-ai/core/util/log"

export interface DiffLine {
  kind: "context" | "delete" | "insert"
  content: string
}

export interface DiffHunk {
  old_start: number
  old_count: number
  new_start: number
  new_count: number
  lines: DiffLine[]
}

interface DiffyExports {
  diff_create_patch(originalPtr: number, originalLen: number, modifiedPtr: number, modifiedLen: number): [number, number]
  diff_apply(basePtr: number, baseLen: number, patchPtr: number, patchLen: number): [number, number, number, number]
  diff_parse(patchPtr: number, patchLen: number): [number, number]
  diff_stats(originalPtr: number, originalLen: number, modifiedPtr: number, modifiedLen: number): [number, number]
  __wbindgen_malloc(size: number, align: number): number
  __wbindgen_realloc(ptr: number, oldSize: number, newSize: number, align: number): number
  __wbindgen_free(ptr: number, size: number, align: number): void
  __wbindgen_externrefs: WebAssembly.Table
  __wbindgen_start(): void
  __externref_table_dealloc(idx: number): void
  memory: WebAssembly.Memory
}

let _wasm: DiffyExports | null = null
let _initPromise: Promise<DiffyExports | null> | null = null
let _textDecoder: TextDecoder
let _textEncoder: TextEncoder
/**
 * Get a fresh Uint8Array view into WASM memory.
 * See json-repair-wasm.ts for rationale — cached views can point
 * to detached ArrayBuffers after WASM memory growth.
 */
function getMemory(m: WebAssembly.Memory): Uint8Array {
  return new Uint8Array(m.buffer)
}

function passString(wasm: DiffyExports, s: string): [number, number] {
  const buf = _textEncoder.encode(s)
  const ptr = wasm.__wbindgen_malloc(buf.length, 1) >>> 0
  getMemory(wasm.memory).subarray(ptr, ptr + buf.length).set(buf)
  return [ptr, buf.length]
}

function readString(wasm: DiffyExports, ptr: number, len: number): string {
  return _textDecoder.decode(getMemory(wasm.memory).subarray(ptr >>> 0, (ptr >>> 0) + len))
}

async function loadWasm(): Promise<DiffyExports | null> {
  if (_wasm) return _wasm
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    try {
      const asset = await readWasmAsset("diffy/diffy_wasm_bg.wasm")
if (!asset.bytes) {
  Log.Default.warn("diff-wasm: no WASM file found, tried: " + JSON.stringify(asset.tried))
  return null
}
Log.Default.info("diff-wasm: loaded WASM from " + asset.path)

      const imports = {
        "./diffy_wasm_bg.js": {
          __wbindgen_cast_0000000000000001: (arg0: number, arg1: number) => {
            return _wasm ? readString(_wasm, arg0, arg1) : ""
          },
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
      const mod = await wasmGate("diff-compile", () => WebAssembly.compile(asset.bytes!))
      const instance = await wasmGate("diff-instantiate", () => WebAssembly.instantiate(mod, imports))
      _wasm = instance.exports as unknown as DiffyExports
      _wasm.__wbindgen_start()
      Log.Default.info("diff-wasm: WASM loaded successfully")
      return _wasm
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      Log.Default.error("diff-wasm: FATAL load failed: " + msg)
      return null
    }
  })()
  return _initPromise
}

export async function initDiffy(): Promise<boolean> {
  const wasm = await loadWasm()
  return wasm !== null
}

export async function createPatch(original: string, modified: string): Promise<string | null> {
  const wasm = await loadWasm()
  if (!wasm) return null
  return wasmGate("diff-createPatch", async () => {
    try {
      const [origPtr, origLen] = passString(wasm, original)
      const [modPtr, modLen] = passString(wasm, modified)
      const ret = wasm.diff_create_patch(origPtr, origLen, modPtr, modLen)
      const result = readString(wasm, ret[0], ret[1])
      wasm.__wbindgen_free(ret[0], ret[1], 1)
      const trimmed = result
        .split("\n")
        .filter((l) => !l.startsWith("\\ No newline"))
        .join("\n")
        .trimEnd() + "\n"
      return recountHunks(trimmed)
    } catch (err) { Log.Default.warn("diff-wasm: createPatch ERROR: " + String(err)); return null }
  })
}

/** Recalculate hunk header line counts after post-processing may have
 *  added or removed lines from the hunk body (e.g. \\ No newline stripping).
 *  Prevents "Hunk at line N contained invalid line" from npm diff parser. */
function recountHunks(patchText: string): string {
  const lines = patchText.split("\n")
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const headerMatch = line.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@(.*)$/)
    if (!headerMatch) {
      out.push(line)
      i++
      continue
    }
    const oldStart = parseInt(headerMatch[1]!, 10)
    const newStart = parseInt(headerMatch[3]!, 10)
    const trailer = headerMatch[5]!
    // Count actual body lines and collect them for re-emission
    const bodyLines: string[] = []
    i++
    while (i < lines.length) {
      const bodyLine = lines[i]!
      if (bodyLine === "") { i++; continue }
      if (bodyLine.startsWith("@@") || bodyLine.startsWith("---") || bodyLine.startsWith("+++")) break
      bodyLines.push(bodyLine)
      i++
    }
    let oldCount = 0
    let newCount = 0
    for (const bl of bodyLines) {
      const prefix = bl[0]!
      if (prefix === " " || prefix === "-") oldCount++
      if (prefix === " " || prefix === "+") newCount++
    }
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${trailer}`)
    for (const bl of bodyLines) out.push(bl)
  }
  return out.join("\n")
}

export async function applyPatch(base: string, patchText: string): Promise<string | null> {
  const wasm = await loadWasm()
  if (!wasm) return null
  try {
    const [basePtr, baseLen] = passString(wasm, base)
    const [patchPtr, patchLen] = passString(wasm, patchText)
    const ret = wasm.diff_apply(basePtr, baseLen, patchPtr, patchLen)
    if (ret[3]) { Log.Default.warn("diff-wasm: applyPatch: error from WASM"); return null }
    const result = readString(wasm, ret[0], ret[1])
    wasm.__wbindgen_free(ret[0], ret[1], 1)
    return result
  } catch (err) { Log.Default.warn("diff-wasm: applyPatch ERROR: " + String(err)); return null }
}

export async function parsePatch(patchText: string): Promise<string | null> {
  const wasm = await loadWasm()
  if (!wasm) return null
  try {
    const [ptr, len] = passString(wasm, patchText)
    const ret = wasm.diff_parse(ptr, len)
    const json = readString(wasm, ret[0], ret[1])
    wasm.__wbindgen_free(ret[0], ret[1], 1)
    return json === "[]" ? null : json
  } catch { return null }
}

export async function diffStats(original: string, modified: string): Promise<{ additions: number; deletions: number } | null> {
  const wasm = await loadWasm()
  if (!wasm) return null
  return wasmGate("diff-stats", async () => {
    try {
      const [origPtr, origLen] = passString(wasm, original)
      const [modPtr, modLen] = passString(wasm, modified)
      const ret = wasm.diff_stats(origPtr, origLen, modPtr, modLen)
      const json = readString(wasm, ret[0], ret[1])
      wasm.__wbindgen_free(ret[0], ret[1], 1)
      const result = JSON.parse(json) as { additions: number; deletions: number }
      return result
    } catch (err) { Log.Default.warn("diff-wasm: diffStats ERROR: " + String(err)); return null }
  })
}

export async function computeDiffWasm(oldText: string, newText: string): Promise<DiffHunk[] | null> {
  const wasm = await loadWasm()
  if (!wasm) return null
  return wasmGate("diff-computeDiff", async () => {
    try {
      const [origPtr, origLen] = passString(wasm, oldText)
      const [modPtr, modLen] = passString(wasm, newText)
      const ret = wasm.diff_create_patch(origPtr, origLen, modPtr, modLen)
      const patch = readString(wasm, ret[0], ret[1])
      wasm.__wbindgen_free(ret[0], ret[1], 1)
      const [parsePtr, parseLen] = passString(wasm, patch)
      const parseRet = wasm.diff_parse(parsePtr, parseLen)
      const json = readString(wasm, parseRet[0], parseRet[1])
      wasm.__wbindgen_free(parseRet[0], parseRet[1], 1)
      if (!json || json === "[]") return []
      return JSON.parse(json) as DiffHunk[]
    } catch { return null }
  })
}

export * as DiffWasmMod from "./diff-wasm"
