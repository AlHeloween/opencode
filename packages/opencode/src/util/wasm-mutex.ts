/**
 * WASM operation mutex — serializes all WebAssembly memory access across
 * the process as a potential mitigation for JSC JIT region faults.
 *
 * ## Why this exists
 *
 * Bun 1.4.0 crashes (SIGSEGV at address 0xE4163AA2) correlate with periods
 * of concurrent WASM operations (xxhash, diff, json-repair, tree-sitter,
 * markdownify, mermaid). A plausible mechanism is WASM memory growth
 * invalidating backing ArrayBuffers while JIT-compiled code holds stale
 * references. This mutex serializes WASM memory-touching operations as a
 * potential mitigation. It has NOT been proven to prevent the crash.
 *
 * ## Usage
 *
 * ```ts
 * import { wasmGate, wasmGateSync } from "./wasm-mutex"
 *
 * // Async gate:
 * const result = await wasmGate("json-repair", () => repairJsonWasm(input))
 *
 * // Sync gate (for sub-ms tokenizer calls):
 * const count = wasmGateSync("bpe-count", () => tokenizer.countTokens(text))
 * ```
 *
 * Both gates share a single boolean lock. Async callers additionally
 * maintain a Promise chain so multiple async callers queue in order;
 * sync callers spin-wait on the boolean. JS is single-threaded, so
 * only one caller (sync or async) can be in the critical section.
 */

let _locked = false
let _asyncQueue: Promise<void> = Promise.resolve()

function _spinWait(): void {
  while (_locked) { /* spin */ }
  _locked = true
}

/** Async gate — serializes via Promise chain + boolean lock. */
export async function wasmGate<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  const prev = _asyncQueue
  let release: () => void
  _asyncQueue = new Promise<void>((r) => { release = r })
  await prev
  _spinWait()
  try {
    return await fn()
  } finally {
    _locked = false
    release!()
  }
}

/** Sync gate — spin-waits on boolean lock, runs fn synchronously. */
export function wasmGateSync<T>(tag: string, fn: () => T): T {
  _spinWait()
  try {
    return fn()
  } finally {
    _locked = false
  }
}

export * as WasmMutex from "./wasm-mutex"
