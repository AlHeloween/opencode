import type { TokenizerInstance, TokenizerModel } from "./types"

// The WASM module's global data (vocab, merges, cache) occupies addresses
// 0 through ~264 MB. I/O buffers use the last page of memory to avoid
// corrupting the module's internal state.
const IO_PAGE_OFFSET = 65536  // use last 64KB page of allocated memory

let _wasmModule: WebAssembly.Module | null = null
let _initPromise: Promise<WebAssembly.Module | null> | null = null

/**
 * Lazily load and compile the WASM module.
 * Tries multiple paths; returns null if none succeed.
 */
async function loadWasm(): Promise<WebAssembly.Module | null> {
  if (_wasmModule) return _wasmModule
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    try {
      // Try relative path first (from packages/opencode/src/tokenizers/)
      const paths = [
        new URL("../../wasm/core/pkg/tokenizer.wasm", import.meta.url),
        new URL("../../../wasm/core/pkg/tokenizer.wasm", import.meta.url),
      ]
      for (const url of paths) {
        try {
          let bytes: ArrayBuffer
          try {
            const file = Bun.file(url)
            bytes = await file.arrayBuffer()
          } catch {
            const resp = await fetch(url)
            if (!resp.ok) continue
            bytes = await resp.arrayBuffer()
          }
          _wasmModule = await WebAssembly.compile(bytes)
          return _wasmModule
        } catch {
          // Try next path
        }
      }
      return null
    } catch {
      return null
    }
  })()
  return _initPromise
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

  private constructor(
    model: TokenizerModel,
    handle: number,
    instance: WebAssembly.Instance,
    memory: WebAssembly.Memory,
  ) {
    this.model = model
    this.handle = handle
    this.wasmInstance = instance
    this.memory = memory
  }

  /**
   * Load and initialize a WASM tokenizer.
   * Returns null if WASM is unavailable or initialization fails.
   */
  static async load(model: TokenizerModel): Promise<BpeWasmTokenizer | null> {
    const mod = await loadWasm()
    if (!mod) return null

    try {
      const vocabJson = JSON.stringify(model.vocab)
      const mergesJson = JSON.stringify(model.merges)

      const vocabBytes = new TextEncoder().encode(vocabJson)
      const mergesBytes = new TextEncoder().encode(mergesJson)

      // Allocate WASM memory: vocab + merges + work buffer
      // NOTE: WASM module requires minimum 4230 pages (~264 MB) for static data
      const totalSize = vocabBytes.length + mergesBytes.length + 4096
      const neededPages = Math.ceil(totalSize / 65536)
      const minModulePages = 4230  // from WASM module import minimum
      const initialPages = Math.max(minModulePages, neededPages)
      const memory = new WebAssembly.Memory({ initial: initialPages, maximum: 8192 })
      const instance = await WebAssembly.instantiate(mod, {
        env: { memory },
      })

      const exports = instance.exports as {
        bpe_init: (vp: number, vl: number, mp: number, ml: number) => number
        bpe_free: (h: number) => void
        memory: WebAssembly.Memory
      }

      const ioBase = memory.buffer.byteLength - IO_PAGE_OFFSET
      const memView = new Uint8Array(memory.buffer)

      // Write vocab JSON at safe high address (past module globals)
      const vocabPtr = ioBase
      memView.set(vocabBytes, vocabPtr)

      // Write merges JSON
      const mergesPtr = ioBase + vocabBytes.length + 64
      memView.set(mergesBytes, mergesPtr)

      const handle = exports.bpe_init(vocabPtr, vocabBytes.length, mergesPtr, mergesBytes.length)
      if (handle < 0) return null

      return new BpeWasmTokenizer(model, handle, instance, memory)
    } catch {
      return null
    }
  }

  countTokens(text: string): number {
    if (!text) return 0
    const textBytes = new TextEncoder().encode(text)
    const memView = new Uint8Array(this.memory.buffer)

    // Write text to the safe I/O page (past module globals)
    const ioBase = this.memory.buffer.byteLength - IO_PAGE_OFFSET
    const textPtr = ioBase
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

    const ioBase = this.memory.buffer.byteLength - IO_PAGE_OFFSET
    const textPtr = ioBase
    const outIdsPtr = ioBase + textBytes.length + 64
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
    const ioBase = this.memory.buffer.byteLength - IO_PAGE_OFFSET
    const outTextPtr = ioBase
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
