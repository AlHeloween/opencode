/**
 * WASM operation mutex — serializes all WebAssembly memory access across
 * the process to prevent concurrent WASM Module memory growth from
 * invalidating JSC JIT-compiled code pages.
 *
 * ## Why this exists
 *
 * The crash at address 0xE4163AA2 is a JSC JIT region access violation
 * triggered by concurrent WASM operations (xxhash, diff, json-repair,
 * tree-sitter, markdownify, mermaid) competing for virtual address space
 * with JIT-compiled code. When one WASM module grows its memory
 * (__wbindgen_realloc), the old backing ArrayBuffer is invalidated.
 * Any in-flight operation on another WASM module that holds a stale
 * pointer can cause JSC to access freed/corrupted memory in the JIT
 * region, resulting in SIGSEGV.
 *
 * This mutex ensures only one WASM memory-touching operation is active
 * at any time, eliminating the concurrent-memory-corruption window.
 *
 * ## Usage
 *
 * ```ts
 * import { wasmGate } from "./wasm-mutex"
 *
 * const result = await wasmGate("json-repair", () => repairJsonWasm(input))
 * ```
 *
 * The `wasmGate` function returns the result of the closure once the
 * mutex is acquired. If the closure throws, the mutex is released and
 * the error propagates.
 */

let _lock: Promise<void> = Promise.resolve()

/**
 * Acquire the WASM mutex, run the closure, then release.
 *
 * @param tag - Diagnostic label for the operation (logged on contention)
 * @param fn  - Async closure that performs WASM memory-touching work
 * @returns The closure's return value
 */
export async function wasmGate<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  const prev = _lock
  let release: () => void
  _lock = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  try {
    return await fn()
  } finally {
    release!()
  }
}

export * as WasmMutex from "./wasm-mutex"
