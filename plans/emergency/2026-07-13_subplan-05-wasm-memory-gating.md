# Subplan 05: Gate WASM Memory Allocation and JSC Page Pressure

## Objective

Investigate and mitigate potential concurrent `WebAssembly.Memory` growth/load pressure without asserting that it causes the JSC access violation.

## Current Status — 2026-07-14

`wasmGate` is implemented and wraps diff patch/stat/diff operations plus JSON repair. Cache hashing, BPE tokenizer lifecycle, parser/grammar loading, Markdownify, and Mermaid have not been shown to use it; telemetry and stress evidence are also absent. The gate is therefore partial and does not establish the cause of the native crash.

## Known Direct WASM Areas

- `packages/opencode/src/util/diff-wasm.ts`
- `packages/opencode/src/util/json-repair-wasm.ts`
- `packages/opencode/src/session/cache-control.ts`
- `packages/opencode/src/tokenizers/bpe-wasm.ts`
- tree-sitter/parser WASM loader paths
- markdownify and Mermaid WASM entrypoints
- `packages/opencode/src/util/wasm-mutex.ts`

## Steps

1. Audit every `WebAssembly.compile`, `WebAssembly.instantiate`, `WebAssembly.Memory`, and `memory.buffer` use.
2. Define the mutex scope precisely: serialize only operations that instantiate, grow, or touch mutable WASM memory; do not serialize unrelated pure JS work.
3. Extend `wasmGate` to cache fingerprint hashing, BPE tokenizer lifecycle/encode/decode, parser grammar instantiation, and other direct WASM allocation paths.
4. Keep fresh typed-array views after memory growth; forbid retained views over growable WASM buffers.
5. Add telemetry: gate tag, queue wait, runtime duration, peak queue depth, and memory allocation context to diagnostic logs.
6. Ensure cancellation/error paths release the gate through `finally`; add deadlock and exception tests.

## Acceptance Tests

- Concurrent callers preserve correct diff, JSON repair, tokenizer, parser, and hash results.
- Gate release occurs after success, throw, timeout, and cancellation.
- Stress logging proves no overlapping gated WASM-memory operation.
- No JSC panic during sustained parallel operation.
