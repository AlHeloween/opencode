---
status: done
owner: codex
created: 2026-06-28
reproduce:
  - cd packages/wasm/core && make json_repair
  - node -e "const m = require('./pkg/json_repair.js'); console.log(m.repair('{a:1'))"
---

# Sub-Plan 2: JSON Repair — C→WASM

## Goal

Port the 432-line TypeScript JSON repair utility (`json-repair.ts`) to C compiled to WASM.
JSON repair runs on every LLM tool call response — removing regex/string scanning from
the JS event loop. C string operations with WASM SIMD for control character stripping.

## Scope

- **One file created**: `packages/wasm/core/src/json_repair.c`
- **One file created**: `packages/opencode/src/util/json-repair-wasm.ts`
- **One file modified**: `packages/opencode/src/session/processor.ts` (prefer WASM, fallback TS)
- **One test file**: `packages/opencode/test/util/json-repair-wasm.test.ts`
- **Total TS changes**: ~5 lines in processor.ts tool call handling

## Implementation

### C module (`json_repair.c`)

```
Export:
  json_repair(input_ptr, input_len, out_ptr, out_cap) -> out_len (0 if failed)

Strategies (try in order, return on first success):
  0. Strip control characters (0x00-0x1F except \t \n \r)
  0.5. Fast-path: input is already valid JSON → copy to output
  1. Balance brackets/braces — count stack, append missing closers
  2. Remove trailing commas before ] or }
  3. Extract first valid JSON substring (scan for balanced outermost {...} or [...])
  4. Quote unquoted keys (scan for /[a-zA-Z_]\w*\s*:/ pattern)
  5. Fix unterminated strings (append " if odd quote count inside string)
  6. Escape unescaped control chars in strings

Memory: Fixed 64KB output buffer. Stack-only, no malloc. Input read-only.
```

### TypeScript wrapper (`json-repair-wasm.ts`)

```typescript
export async function repairJsonWasm(input: string): Promise<string | null>
// Loads WASM module once (lazy), calls json_repair()
// Returns null if WASM unavailable or repair fails
```

### Integration (`processor.ts`)

```
tool call argument parsing:
  1. Try JSON.parse(raw)
  2. If fails: try repairJsonWasm(raw)
  3. If fails: try repairJsonTS(raw)   ← existing fallback
```

## Test Cases

| # | Input | Expected Repair |
|---|-------|----------------|
| 1 | `{"a": 1,}` | `{"a": 1}` (trailing comma removed) |
| 2 | `{"a": [1, 2}` | `{"a": [1, 2]}` (missing bracket) |
| 3 | `{a: 1, b: "hello"}` | `{"a": 1, "b": "hello"}` (keys quoted) |
| 4 | `{"msg": "unterminated` | `{"msg": "unterminated"}` (string closed) |
| 5 | `blah blah {"real": "json"} blah` | `{"real": "json"}` (first valid JSON) |
| 6 | `{"x": 1}\x00` | `{"x": 1}` (null byte stripped) |
| 7 | Already valid `{"ok": true}` | `{"ok": true}` (fast-path, no change) |
| 8 | WASM load failure | Falls back to TS repair, no crash |

## Verification

```
make json_repair              # clang --target=wasm32 + wasm-opt -Oz
bun test test/util/json-repair-wasm.test.ts   # all 8 tests pass
bun test test/tool/                           # zero regressions
bun typecheck                                 # clean
```

## Risk

- **WASM load fails**: TS `repairJson()` handles all repair. Zero impact.
- **Repair divergence**: Parity tests catch any difference. C code is deterministic.
- **Performance regression**: C WASM is strictly faster. If not, TS fallback is identical speed to current.

## Ship Criteria

- [ ] All 8 parity tests pass (identical output to TS repair)
- [ ] Zero tool test regressions
- [ ] Typecheck clean
- [ ] WASM repair produces same output as TS repair on all known LLM JSON failure modes
