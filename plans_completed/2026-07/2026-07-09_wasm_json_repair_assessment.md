# WASM JSON Repair Assessment

**Date:** 2026-07-09
**Status:** Complete — tests expanded, all 23 passing

## Executive Summary

The WASM JSON repair system for delegate agent error recovery is **fully implemented and functioning**. The system uses a Rust-to-WebAssembly `json-repair` crate to repair malformed JSON in LLM tool call arguments before falling back to an "invalid" tool with diagnostic hints.

## Architecture

### Three-Tier Recovery Strategy

1. **Tier 1 — Case Repair** (`llm.ts:481-491`): If the tool name has wrong casing, it's corrected via `toLowerCase()` lookup.
2. **Tier 2 — WASM JSON Repair** (`json-repair-wasm.ts:86-101`): The Rust WASM module attempts to repair malformed JSON (unclosed strings, missing commas, single quotes, truncated output, etc.).
3. **Tier 3 — Diagnostic Fallback** (`diagnose-parse-error.ts`): If repair fails, the tool call is routed to the `invalid` tool with a human-readable diagnostic hint.

### Key Files

| File | Lines | Role |
|------|-------|------|
| `packages/opencode/src/util/json-repair-wasm.ts` | 109 | WASM loader + repair function |
| `packages/opencode/src/session/llm.ts` | 475-515 | Repair callback integration |
| `packages/opencode/src/util/diagnose-parse-error.ts` | 25 | Error diagnosis with hints |
| `packages/opencode/src/tool/invalid.ts` | 21 | Fallback tool for irreparable calls |
| `packages/wasm/core/pkg/json_repair/` | — | Rust WASM module (source) |
| `packages/opencode/src/util/wasm-path.ts` | 58 | WASM asset discovery (11 path candidates) |
| `packages/opencode/src/util/wasm-embedded.ts` | 103 | Embedded WASM fallback (compile-time bundling) |
| `packages/opencode/src/util/wasm-health.ts` | 40 | Startup health check |

### WASM Loading Flow

```
repairJsonWasm(input)
  → loadRepair()
    → Check _wasm cache (singleton)
    → Check _initPromise (dedup concurrent callers)
    → readWasmAsset("json_repair/json_repair_bg.wasm")
      → Try embedded first (wasm-embedded.ts, compile-time bundled)
      → Try filesystem (11 path candidates via wasm-path.ts)
    → WebAssembly.compile + instantiate
    → Log result
  → passString → wasm.json_repair() → readString → validate JSON.parse()
  → Return repaired string or null
```

### Embedded Fallback

The WASM module is **embedded at compile time** via Bun's `with { type: "file" }` import assertion (`wasm-embedded.ts:5`). This means:
- The WASM bytes are bundled into the JavaScript bundle
- Filesystem path resolution is a **secondary fallback**, not the primary mechanism
- The system works even if `dist/wasm/` is missing, as long as the JS bundle is intact

## Current Test Coverage

**File:** `packages/opencode/test/util/json-repair-wasm.test.ts` (156 lines, 23 tests)

Tests cover:
- WASM module loading
- Malformed object syntax
- Truncated JSON (unclosed nested objects, unclosed arrays)
- Single quotes (pure and mixed)
- Missing commas (properties and arrays)
- Unclosed strings (values and keys)
- Trailing commas (objects and arrays)
- Unicode (emoji, malformed syntax)
- Large payloads (10K stress test)
- Valid JSON pass-through
- Mixed valid/invalid nesting
- Mismatched brackets
- Truncated booleans
- Null bytes
- Unrepairable input
- Empty input
- Multiple nested errors

**Result:** 23 tests, 0 failures, 47 assertions.

## Delegate Agent Error Context

When a delegate agent (via `task` tool) returns malformed JSON in tool call arguments:

1. The AI SDK's `streamText` parser fails to parse the tool call arguments
2. `experimental_repairToolCall` callback is invoked with the failed tool call
3. The callback attempts repair via `repairJsonWasm()`
4. If repair succeeds → tool call proceeds normally
5. If repair fails → routed to `invalid` tool with diagnostic message

The `task` tool (`packages/opencode/src/tool/task.ts`) itself does not directly handle JSON repair — it delegates to the LLM stream's repair callback.

## Potential Issues Identified

### 1. Memory Cache Invalidation (Low Risk)

**Location:** `json-repair-wasm.ts:18-24`

```typescript
let _cachedMemory: Uint8Array | null = null

function getMemory(m: WebAssembly.Memory): Uint8Array {
  if (!_cachedMemory || _cachedMemory.byteLength === 0) {
    _cachedMemory = new Uint8Array(m.buffer)
  }
  return _cachedMemory
}
```

If WebAssembly memory grows (via `memory.grow()`), the cached `Uint8Array` view becomes stale. However, the `json-repair` Rust crate uses a fixed memory model, so this is unlikely. **No action needed** unless memory growth is observed.

### 2. Null Byte Stripping Order (Correct)

**Location:** `llm.ts:496`

```typescript
const rawInput = String(failed.toolCall.input).replace(/\x00/g, "")
const repaired = await repairJsonWasm(rawInput)
```

Null bytes are stripped **before** passing to WASM repair. This is correct — null bytes would corrupt the WASM memory write (`passString` uses `subarray.set()`).

### 3. No Timeout on WASM Repair (Acceptable)

The `repairJsonWasm()` function has no timeout. For extremely large tool call inputs, the Rust WASM could block the event loop. However, tool call arguments are typically small (<10KB), so this is not a practical concern.

### 4. Test Coverage Gap ✅ FIXED

Previously the test file had only 2 tests. Expanded to 23 tests covering all common LLM malformation patterns.

## Recommendations

### 1. Expand Test Coverage ✅ DONE

Added 21 new test cases covering:
- Truncated JSON (unclosed nested objects, unclosed arrays)
- Single quotes (pure single-quote, mixed single/double)
- Missing commas (between properties, in arrays)
- Unclosed strings (values and keys)
- Trailing commas (objects and arrays)
- Unicode edge cases (emoji, unicode with malformed syntax)
- Large payloads (10K string stress test)
- Valid JSON pass-through
- Mixed valid/invalid nesting
- Mismatched brackets
- Truncated booleans
- Null bytes
- Unrepairable input
- Empty input
- Multiple errors in nested structure

**Result:** 23 tests, 0 failures, 47 assertions.

### 2. Add Integration Test (Priority: Low)

Test the full `experimental_repairToolCall` → `repairJsonWasm` → `invalid` tool flow using a mock LLM provider. This would verify end-to-end behavior but requires significant test infrastructure.

### 3. Add WASM Health Check to TUI (Priority: Low)

Currently, WASM health check logs to file only. If `json_repair` fails to load, users would not know until they encounter a malformed tool call. A startup indicator in the TUI would improve observability.

## Verification

### Manual Verification Steps

1. **Check WASM health at startup:**
   ```bash
   rg "wasm-health" .opencode/data/log/$(ls .opencode/data/log/*.jsonl | sort | tail -1)
   ```
   Expected: `"wasm-health: all N modules loaded"` or `"wasm-health: FATAL - ..."`

2. **Check JSON repair usage:**
   ```bash
   rg "repaired malformed JSON" .opencode/data/log/
   ```
   Expected: Entries when LLM produces malformed tool calls

3. **Check bug reports:**
   ```bash
   cat .opencode/data/bugs/messages.json 2>/dev/null
   ```
   Expected: No `json-repair` related bugs

4. **Run existing tests:**
   ```bash
   cd packages/opencode && bun test test/util/json-repair-wasm.test.ts
   ```
   Expected: All 23 tests pass

## Conclusion

The WASM JSON repair system is **working correctly**. The architecture is sound:
- Embedded WASM provides reliable loading
- Three-tier recovery handles common malformations
- Fallback to `invalid` tool ensures graceful degradation
- Health check catches startup failures

Test coverage expanded from 2 to 23 tests. No bugs or broken behavior were identified.
