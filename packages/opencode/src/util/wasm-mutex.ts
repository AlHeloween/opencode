/**
 * WASM operation mutex — serializes async WebAssembly memory access across
 * the process as a potential mitigation for JSC JIT region faults.
 *
 * ## Why this exists
 *
 * Bun 1.4.0 crashes (SIGSEGV at address 0xE4163AA2) correlate with periods
 * of concurrent async WASM operations (xxhash, diff, json-repair,
 * tree-sitter, markdownify, mermaid). A plausible mechanism is WASM memory
 * growth invalidating backing ArrayBuffers while JIT-compiled code holds
 * stale references. This mutex serializes WASM memory-touching async
 * operations as a potential mitigation. It has NOT been proven to prevent
 * the crash.
 *
 * Synchronous WASM calls (wasmGateSync, used by BPE tokenizers) do NOT
 * participate in the lock. Sync calls are sub-millisecond and cannot
 * deadlock with the async Promise chain. JS is single-threaded — a sync
 * spin-wait on the async lock would block the event loop, preventing the
 * async operation from ever releasing.
 *
 * ## Usage
 *
 * ```ts
 * import { wasmGate, wasmGateSync } from "./wasm-mutex"
 * const result = await wasmGate("json-repair", () => repairJsonWasm(input))
 * const count = wasmGateSync("bpe-count", () => tokenizer.countTokens(text))
 * ```
 */

let _asyncLock: Promise<void> = Promise.resolve()

/** Async gate — serializes via Promise chain. */
export async function wasmGate<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  const prev = _asyncLock
  let release: () => void
  _asyncLock = new Promise<void>((r) => { release = r })
  await prev
  try {
    return await fn()
  } finally {
    release!()
  }
}

/**
 * Sync gate — runs immediately. Does NOT participate in the async lock.
 * Sync WASM calls are sub-millisecond; spinning on the async lock would
 * deadlock the JS event loop.
 */
export function wasmGateSync<T>(_tag: string, fn: () => T): T {
  return fn()
}

export * as WasmMutex from "./wasm-mutex"
