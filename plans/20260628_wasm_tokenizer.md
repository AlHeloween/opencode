---
status: done
owner: codex
created: 2026-06-28
reproduce:
  - cd packages/wasm/core && make tokenizer
  - node -e "const m = require('./pkg/tokenizer.js'); console.log(m.count_tokens('hello world'))"
---

# Sub-Plan 1: BPE Tokenizer — C→WASM

## Goal

Port the 187-line TypeScript BPE encoder (`bpe-encoder.ts`) to C compiled to WASM.
The C module loads alongside the existing TS encoder behind a shared `TokenizerInstance`
interface. If WASM fails, TS fallback handles it — zero risk.

## Scope

- **One file created**: `packages/wasm/core/src/tokenizer.c`
- **One file created**: `packages/opencode/src/tokenizers/bpe-wasm.ts`
- **One file modified**: `packages/opencode/src/tokenizers/index.ts` (prefer WASM, fallback TS)
- **One test file**: `packages/opencode/test/tokenizers/bpe-wasm.test.ts`
- **Total TS changes**: ~30 lines in index.ts, everything else is additive

## Implementation

### C module (`tokenizer.c`)

```
Exports:
  bpe_init(vocab_json_ptr, vocab_len, merges_json_ptr, merges_len) -> handle (i32)
  bpe_count(handle, text_ptr, text_len) -> count (u32)
  bpe_encode(handle, text_ptr, text_len, out_ids_ptr, out_cap) -> ids_written (u32)
  bpe_decode(handle, id, out_text_ptr, out_cap) -> text_len (u32)
  bpe_free(handle)

Algorithm:
  1. Parse vocab JSON → hash table (string → id)
  2. Parse merges JSON → priority queue (pair → rank)
  3. Pre-tokenize: GPT-2 regex pattern → word list
  4. Per word: byte-level encode → apply BPE merges → lookup vocab
  5. LRU cache (fixed-size ring buffer, 4096 entries)
  
Memory: Stack-allocated where possible. Fixed 64KB work buffer. No malloc in encode path.
```

### TypeScript wrapper (`bpe-wasm.ts`)

```typescript
export class BpeWasmTokenizer implements TokenizerInstance {
  static async load(model: TokenizerModel): Promise<BpeWasmTokenizer | null>
  countTokens(text: string): number
  encode(text: string): number[]
  decode(ids: number[]): string
}
```

### Integration (`index.ts`)

```
loadTokenizer(model):
  1. Try BpeWasmTokenizer.load(model)    ← WASM
  2. If null or error → new BPETokenizer(model)  ← TS fallback
```

## Test Cases

| # | Input | Expected |
|---|-------|----------|
| 1 | `"hello world"` | TS count == WASM count |
| 2 | `"Hello World! 123"` (mixed case, numbers) | TS tokens == WASM tokens (exact IDs) |
| 3 | `"привет мир"` (Cyrillic) | TS count == WASM count |
| 4 | `"a".repeat(10000)` (long input) | TS count == WASM count |
| 5 | `""` (empty string) | 0 tokens from both |
| 6 | Special tokens (`<|endoftext|>`) | Correct single-token handling |
| 7 | WASM load failure | Falls back to TS, no crash |

## Verification

```
make tokenizer              # clang --target=wasm32 + wasm-opt -Oz → pkg/tokenizer.wasm
bun test test/tokenizers/bpe-wasm.test.ts   # all 7 tests pass
bun test test/tokenizers/                   # zero regressions
bun typecheck                               # clean
```

## Risk

- **WASM load fails**: TS fallback handles all tokenizer calls. Zero impact on functionality.
- **Token mismatch**: Parity tests catch any divergence. Fix C code, rebuild, retest.
- **Memory leak**: `bpe_free(handle)` called on instance disposal. Fixed buffer sizes prevent runaway growth.

## Ship Criteria

- [ ] All 7 parity tests pass
- [ ] Zero tokenizer test regressions
- [ ] Typecheck clean
- [ ] WASM loads correctly in Node.js (Bun) test environment
