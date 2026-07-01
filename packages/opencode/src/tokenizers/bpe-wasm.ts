import { readWasmAsset } from "@/util/wasm-path"
import * as Log from "@opencode-ai/core/util/log"
import type { TokenizerInstance, TokenizerModel } from "./types"

// The WASM module's global data (vocab, merges, cache) occupies addresses
// 0 through ~264 MB. I/O buffers use the last page of memory to avoid
// corrupting the module's internal state.
const IO_PAGE_OFFSET = 65536  // use last 64KB page of allocated memory
const MODEL_SCRATCH_OFFSET = 8 * 1024 * 1024
const STACK_GUARD_BYTES = 1024 * 1024
const MAX_TOKEN_BYTES = 255
const MAX_MERGE_KEY_BYTES = 513
const MAX_MERGES = 131072
const MODULE_MIN_PAGES = 4230
const MODULE_MAX_PAGES = 8192
const modelEncoder = new TextEncoder()

let _wasmModule: WebAssembly.Module | null = null
let _initPromise: Promise<WebAssembly.Module | null> | null = null

function prepareModel(model: TokenizerModel) {
  const vocabEntries = Object.entries(model.vocab).filter(([key]) => modelEncoder.encode(key).length <= MAX_TOKEN_BYTES)
  const mergeEntries = Object.entries(model.merges)
    .filter(([key]) => modelEncoder.encode(key).length <= MAX_MERGE_KEY_BYTES)
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_MERGES)
  const omittedVocab = Object.keys(model.vocab).length - vocabEntries.length
  const omittedMerges = Object.keys(model.merges).length - mergeEntries.length

  if (omittedVocab > 0 || omittedMerges > 0) {
    Log.Default.warn("bpe-wasm: model exceeds wasm parser limits", { omittedVocab, omittedMerges })
  }

  return {
    vocabBytes: modelEncoder.encode(JSON.stringify(Object.fromEntries(vocabEntries))),
    mergesBytes: modelEncoder.encode(JSON.stringify(Object.fromEntries(mergeEntries))),
  }
}

/**
 * Lazily load and compile the WASM module.
 * Tries multiple paths; returns null if none succeed.
 */
async function loadWasm(): Promise<WebAssembly.Module | null> {
  if (_wasmModule) return _wasmModule
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const asset = await readWasmAsset("tokenizer.wasm")
    if (!asset.bytes) {
      Log.Default.warn("bpe-wasm: no WASM file found, tried: " + JSON.stringify(asset.tried))
      return null
    }

    try {
      _wasmModule = await WebAssembly.compile(asset.bytes)
      Log.Default.info("bpe-wasm: loaded WASM from " + asset.path)
      return _wasmModule
    } catch (err) {
      Log.Default.error("bpe-wasm: load failed: " + (err instanceof Error ? err.message : String(err)))
      return null
    }
  })()
  return _initPromise
}

/** Eager health check — call at startup. */
export async function initTokenizer(): Promise<boolean> {
  const mod = await loadWasm()
  return mod !== null
}

/**
 * WASM-backed BPE tokenizer. Falls back to TS implementation if WASM fails to load.
 * Implements the TokenizerInstance interface.
 */
export class BpeWasmTokenizer implements TokenizerInstance {
  readonly model: TokenizerModel
  private handle: number
private wasmInstance: WebAssembly.Instance
private memory: WebAssembly.Memory
private ioBase: number

  private constructor(
    model: TokenizerModel,
      handle: number,
  instance: WebAssembly.Instance,
  memory: WebAssembly.Memory,
  ioBase: number,
) {
  this.model = model
  this.handle = handle
  this.wasmInstance = instance
  this.memory = memory
  this.ioBase = ioBase
}

  /**
   * Load and initialize a WASM tokenizer.
   * Returns null if WASM is unavailable or initialization fails.
   */
  static async load(model: TokenizerModel): Promise<BpeWasmTokenizer | null> {
    const mod = await loadWasm()
    if (!mod) return null

    try {
      const { vocabBytes, mergesBytes } = prepareModel(model)
      const modelSize = vocabBytes.length + mergesBytes.length + 128
      const initialPages = Math.max(
        MODULE_MIN_PAGES,
        Math.ceil((MODEL_SCRATCH_OFFSET + modelSize + IO_PAGE_OFFSET) / 65536),
      )
      const memory = new WebAssembly.Memory({ initial: initialPages, maximum: Math.max(MODULE_MAX_PAGES, initialPages) })
      const instance = await WebAssembly.instantiate(mod, {
        env: { memory },
      })

      const exports = instance.exports as {
  __stack_pointer: WebAssembly.Global
  bpe_init: (vp: number, vl: number, mp: number, ml: number) => number
  bpe_free: (h: number) => void
  memory: WebAssembly.Memory
}

const ioBase = MODEL_SCRATCH_OFFSET + modelSize
if (ioBase + IO_PAGE_OFFSET > memory.buffer.byteLength) {
  Log.Default.warn("bpe-wasm: insufficient memory for tokenizer model JSON")
  return null
}
const memView = new Uint8Array(memory.buffer)
const vocabPtr = MODEL_SCRATCH_OFFSET
memView.set(vocabBytes, vocabPtr)
const mergesPtr = MODEL_SCRATCH_OFFSET + vocabBytes.length + 64
memView.set(mergesBytes, mergesPtr)

const handle = exports.bpe_init(vocabPtr, vocabBytes.length, mergesPtr, mergesBytes.length)
if (handle < 0) {
  Log.Default.warn("bpe-wasm: tokenizer initialization rejected model")
  return null
}
exports.__stack_pointer.value = memory.buffer.byteLength - STACK_GUARD_BYTES

return new BpeWasmTokenizer(model, handle, instance, memory, ioBase)
    } catch (err) {
      Log.Default.warn("bpe-wasm: tokenizer initialization failed: " + (err instanceof Error ? err.message : String(err)))
      return null
    }
  }

  countTokens(text: string): number {
    if (!text) return 0
    const textBytes = new TextEncoder().encode(text)
    const memView = new Uint8Array(this.memory.buffer)

    const textPtr = this.ioBase
    if (textPtr + textBytes.length > this.memory.buffer.byteLength) {
      return 0
    }
    memView.set(textBytes, textPtr)

    const exports = this.wasmInstance.exports as {
      bpe_count: (h: number, tp: number, tl: number) => number
    }
    return exports.bpe_count(this.handle, textPtr, textBytes.length)
  }

  encode(text: string): number[] {
    if (!text) return []
    const textBytes = new TextEncoder().encode(text)
    const memView = new Uint8Array(this.memory.buffer)

    const textPtr = this.ioBase
const outIdsPtr = Math.ceil((this.ioBase + textBytes.length + 64) / 4) * 4
const maxIds = Math.floor((this.memory.buffer.byteLength - outIdsPtr - 4) / 4)

    if (outIdsPtr + textBytes.length >= this.memory.buffer.byteLength) {
      return []
    }

    memView.set(textBytes, textPtr)

    const exports = this.wasmInstance.exports as {
      bpe_encode: (h: number, tp: number, tl: number, op: number, oc: number) => number
    }

    const idsWritten = exports.bpe_encode(
      this.handle,
      textPtr,
      textBytes.length,
      outIdsPtr,
      maxIds,
    )

    // Read back the IDs
    const idsView = new Int32Array(this.memory.buffer)
    const outOffset = outIdsPtr / 4
    const result: number[] = []
    for (let i = 0; i < idsWritten && i < maxIds; i++) {
      result.push(idsView[outOffset + i])
    }
    return result
  }

  decode(ids: number[]): string {
    if (!ids.length) return ""
    const memView = new Uint8Array(this.memory.buffer)
    const outTextPtr = this.ioBase
    const maxOut = this.memory.buffer.byteLength - outTextPtr - 1

    const exports = this.wasmInstance.exports as {
      bpe_decode: (h: number, id: number, op: number, oc: number) => number
    }

    const parts: string[] = []
    for (const id of ids) {
      const len = exports.bpe_decode(this.handle, id, outTextPtr, maxOut)
      if (len > 0) {
        const bytes = memView.slice(outTextPtr, outTextPtr + len)
        parts.push(new TextDecoder().decode(bytes))
      }
    }
    return parts.join("")
  }
}

export * as BpeWasmTokenizerMod from "./bpe-wasm"
