# Real Tokenizer Integration via transformers.js + src/tokenizers/

**Date:** 2026-06-15
**Status:** Completed
**Depends on:** `20260615_fix_premature_compaction_json_inflation.md` (completed)

---

## Problem

The `/4` chars-per-token heuristic has ~10-20% variance depending on language/code/content ratios. A real tokenizer gives exact counts matching what the model provider charges and what the API returns.

## Discovery

- `tokenizer.json` confirmed at `https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/raw/main/tokenizer.json`
- Uses standard HuggingFace `PreTrainedTokenizerFast` format
- `tokenizer_class: "PreTrainedTokenizerFast"` in `tokenizer_config.json`
- `model_type: "deepseek_v4"`, BOS=0, EOS=1, vocab_size=129280
- transformers.js `AutoTokenizer.from_pretrained()` can load it

## Architecture

```
src/tokenizers/
├── index.ts           — Public API: countTokens, estimateTokens, Tokenizers module
├── types.ts           — TokenizerSource, TokenizerConfig types
├── registry.ts        — Built-in model→tokenizer mappings (auto-detected from model family/id)
├── loader.ts          — transformers.js AutoTokenizer wrapper, lazy init, caching
├── chat-template.ts   — DeepSeek V4 chat template (special token wrapping, optional)
└── fallback.ts        — Chars/4 fallback (current behavior)

src/config/tokenizer.ts — ConfigTokenizer schema for opencode.jsonc overrides
```

## Model → Tokenizer Registry (built-in, no user config needed)

```typescript
// src/tokenizers/registry.ts
export const BUILTIN_TOKENIZERS: Record<string, TokenizerConfig> = {
  "deepseek-v4-pro": {
    source: "huggingface",
    repo: "deepseek-ai/DeepSeek-V4-Pro",
  },
  "deepseek-v4-flash": {
    source: "huggingface",
    repo: "deepseek-ai/DeepSeek-V4-Pro",  // shares tokenizer with Pro
  },
  // Wildcard patterns for auto-detection:
  "*deepseek-v4*": {
    source: "huggingface",
    repo: "deepseek-ai/DeepSeek-V4-Pro",
  },
}
```

## Config Override (opencode.jsonc)

```jsonc
{
  "tokenizer": {
    "my-custom-model": {
      "source": "huggingface",
      "repo": "my-org/my-model"
    },
    "deepseek-v4-pro": {
      "source": "huggingface", 
      "repo": "deepseek-ai/DeepSeek-V4-Pro",
      "offline": true  // use bundled tokenizer.json, don't download
    }
  }
}
```

## Integration Points

| Current location | Current method | New method |
|-----------------|---------------|------------|
| `overflow.ts:estimateContentTokens()` | `chars / 4` | `Tokenizers.countTokens(model, text)` |
| `llm.ts:224` | `JSON.stringify().length / 4` | `Tokenizers.countTokens(model, text)` |
| `compaction.ts:211` | `Token.estimate(text)` | `Tokenizers.estimateTokens(model, text)` |
| `compaction.ts:267` | `Token.estimate(part.state.output)` | `Tokenizers.estimateTokens(model, text)` |

## Fallback Strategy

```
countTokens(model, text)
  ├─ Find tokenizer config from registry (model ID match)
  │  └─ Override with opencode.jsonc if present
  ├─ If tokenizer available:
  │  ├─ Load (first call: download + init, ~2s)  
  │  └─ Encode → return exact count (sub-ms)
  └─ If no tokenizer / load fails:
     └─ Fallback to chars/4 heuristic (current behavior)
```

## Dependencies

| Dependency | Size | Purpose |
|-----------|------|---------|
| `@huggingface/transformers` | ~50 MB (npm) | AutoTokenizer + BPE engine |
| `tokenizer.json` (DeepSeek V4 Pro) | ~5 MB | Vocab + merges (downloaded at runtime or bundled) |
| `tokenizer_config.json` | ~1 KB | Config (downloaded with tokenizer.json) |

**Bundle strategy:** For offline/fast startup, download `tokenizer.json` once and cache in `Global.Path.cache/tokenizers/`. transformers.js handles this automatically via its cache system.

## Build Wiring

1. Add `@huggingface/transformers` to `package.json` dependencies
2. `src/tokenizers/loader.ts` calls `AutoTokenizer.from_pretrained(repo, { cache_dir })`
3. First call downloads ~5 MB from HuggingFace to local cache
4. Subsequent calls load from cache (instant)
5. Build script optionally pre-downloads tokenizer files for offline bundles

## Implementation Steps

| # | Task | File | Effort | Status |
|---|------|------|--------|--------|
| 1 | Create `src/tokenizers/types.ts` — TokenizerConfig types | New | 15 min | [x] |
| 2 | Create `src/tokenizers/registry.ts` — built-in mappings | New | 20 min | [x] |
| 3 | Create `src/tokenizers/bpe-encoder.ts` — BPE implementation | New | 30 min | [x] |
| 4 | Create `src/tokenizers/index.ts` — public API + fallback | New | 20 min | [x] |
| 5 | Create fetch scripts (deepseek + qwen3) | `scripts/` | 15 min | [x] |
| 6 | Add tiktoken adapter for GPT-5/GPT-4 | New | 15 min | [x] |
| 7 | Wire into `overflow.ts:estimateContentTokens()` | Edit | 10 min | [x] |
| 8 | Multi-field resolution: api.id → name → family | Edit | 10 min | [x] |
| 9 | Add `tiktoken` dep | `package.json` | 5 min | [x] |
| 10 | Add tests | `test/session/compaction.test.ts` | 30 min | [x] |
| 11 | Run full test suite (193 pass, 0 fail) | `bun test` | 10 min | [x] |

## Verification

- [x] `Tokenizers.countTokens(v4proModel, knownText)` matches real tokenizer (verified: 12 vs 11 heuristic)
- [x] Fallback works when no tokenizer configured (returns chars/4)
- [x] Model files bundled (deepseek-v4: 4.8 MB, qwen3: 5.4 MB)
- [x] Instant load from bundled JSON (no download at runtime)
- [x] `overflow.ts` uses real tokenizer counts via `getTokenizerSync(model)`
- [x] Multi-field resolution: api.id → name → family covers custom providers
- [x] 193 tests pass, typecheck clean
- [x] Three tokenizer families: DeepSeek V4, Qwen3/Kat-Coder, GPT-5/GPT-4

## Risk: Package Size

`@huggingface/transformers` is ~50 MB on disk (includes ONNX runtime). If this is too heavy, alternatives:

1. **Port the BPE tokenizer** — Extract `tokenizer.json`, implement BPE decoder in ~150 lines TS. Zero deps. 5 MB vocab file bundled as asset.
2. **Use `tiktoken`** — For OpenAI models only. Doesn't help with DeepSeek.
3. **Python subprocess** — Fragile, high latency. Rejected.

Recommend trying Option 1 (port BPE) if 50 MB is unacceptable. The BPE algorithm is simple and well-documented in the `tokenizer.json` spec.
