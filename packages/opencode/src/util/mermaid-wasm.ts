import * as Log from "@opencode-ai/core/util/log"

import { readWasmAsset } from "./wasm-path"

interface MermaidWasmExports {
  registerFont(ptr: number, len: number): void
  renderSvg(ptr: number, len: number): [number, number, number, number]
  renderSvgWithConfig(
    sourcePtr: number,
    sourceLen: number,
    configPtr: number,
    configLen: number,
    themePtr: number,
    themeLen: number,
  ): [number, number, number, number]
  __wbindgen_malloc(size: number, align: number): number
  __wbindgen_realloc(ptr: number, oldSize: number, newSize: number, align: number): number
  __wbindgen_free(ptr: number, size: number, align: number): void
  __wbindgen_externrefs: WebAssembly.Table
  __externref_table_dealloc(index: number): void
  __wbindgen_start(): void
  memory: WebAssembly.Memory
}

export type MermaidWasmRenderer = {
  registerFont(data: Uint8Array): void
  renderSvg(source: string): string
  renderSvgWithConfig(source: string, config?: string | null, theme?: string | null): string
}

let wasm: MermaidWasmExports | null = null
let loading: Promise<MermaidWasmRenderer | null> | null = null
const decoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true })
const encoder = new TextEncoder()

function memory() {
  if (!wasm) throw new Error("mermaid WASM is not initialized")
  return new Uint8Array(wasm.memory.buffer)
}

function readString(ptr: number, len: number) {
  return decoder.decode(memory().subarray(ptr >>> 0, (ptr >>> 0) + len))
}

function passString(value: string) {
  if (!wasm) throw new Error("mermaid WASM is not initialized")
  const bytes = encoder.encode(value)
  const ptr = wasm.__wbindgen_malloc(bytes.length, 1) >>> 0
  memory().subarray(ptr, ptr + bytes.length).set(bytes)
  return [ptr, bytes.length] as const
}

function takeExternref(index: number) {
  if (!wasm) throw new Error("mermaid WASM is not initialized")
  const value = wasm.__wbindgen_externrefs.get(index)
  wasm.__externref_table_dealloc(index)
  return value
}

function renderer(): MermaidWasmRenderer {
  return {
    registerFont(data) {
      if (!wasm) throw new Error("mermaid WASM is not initialized")
      const ptr = wasm.__wbindgen_malloc(data.length, 1) >>> 0
      memory().set(data, ptr)
      wasm.registerFont(ptr, data.length)
    },
    renderSvg(source) {
      if (!wasm) throw new Error("mermaid WASM is not initialized")
      const [sourcePtr, sourceLen] = passString(source)
      const [ptr, len, error, failed] = wasm.renderSvg(sourcePtr, sourceLen)
      if (failed) throw takeExternref(error)
      try {
        return readString(ptr, len)
      } finally {
        wasm.__wbindgen_free(ptr, len, 1)
      }
    },
    renderSvgWithConfig(source, config, theme) {
      if (!wasm) throw new Error("mermaid WASM is not initialized")
      const [sourcePtr, sourceLen] = passString(source)
      const [configPtr, configLen] = config == null ? [0, 0] : passString(config)
      const [themePtr, themeLen] = theme == null ? [0, 0] : passString(theme)
      const [ptr, len, error, failed] = wasm.renderSvgWithConfig(
        sourcePtr,
        sourceLen,
        configPtr,
        configLen,
        themePtr,
        themeLen,
      )
      if (failed) throw takeExternref(error)
      try {
        return readString(ptr, len)
      } finally {
        wasm.__wbindgen_free(ptr, len, 1)
      }
    },
  }
}

export async function getMermaidWasmRenderer(): Promise<MermaidWasmRenderer | null> {
  if (wasm) return renderer()
  if (loading) return loading
  loading = (async () => {
    try {
      const asset = await readWasmAsset("mermaid/mermaid_wasm_renderer_bg.wasm")
      if (!asset.bytes) {
        Log.Default.error("mermaid: WASM file not found, tried: " + JSON.stringify(asset.tried))
        return null
      }
      const module = await WebAssembly.compile(asset.bytes)
      const instance = await WebAssembly.instantiate(module, {
        "./mermaid_wasm_renderer_bg.js": {
          __wbg_Error_92b29b0548f8b746(ptr: number, len: number) {
            return new Error(readString(ptr, len))
          },
          __wbindgen_init_externref_table() {
            if (!wasm) return
            const table = wasm.__wbindgen_externrefs
            const offset = table.grow(4)
            table.set(0, undefined)
            table.set(offset, undefined)
            table.set(offset + 1, null)
            table.set(offset + 2, true)
            table.set(offset + 3, false)
          },
        },
      })
      wasm = instance.exports as unknown as MermaidWasmExports
      wasm.__wbindgen_start()
      Log.Default.info("mermaid: WASM loaded from " + asset.path)
      return renderer()
    } catch (error) {
      Log.Default.error("mermaid: WASM load failed: " + (error instanceof Error ? error.message : String(error)))
      return null
    } finally {
      loading = null
    }
  })()
  return loading
}

export function resetMermaidWasmRenderer() {
  wasm = null
  loading = null
}
