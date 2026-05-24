# DeepSeek Prompt Cache Miss — Investigation

**Created**: 2026-05-24  
**Status**: Closed — cache confirmed working, no code fix needed

## Summary

Investigated a report of "serious cache miss" on DeepSeek V4 Pro and StreamLake providers. After code audit and live testing, **cache is working correctly** at 99-100% hit rate for both providers.

## Investigation Findings

1. **`applyCaching` gate** (`transform.ts:349-361`) — does not include DeepSeek/StreamLake, but this is **correct** because DeepSeek uses automatic prefix-based caching (no `cache_control` markers needed).

2. **System prompt stability** — prompts come from static files (`anthropic.txt`, `reasoning.txt`, `default.txt`), with no per-request dynamic content. Prefix is stable across consecutive requests.

3. **Cache metrics** — both streaming and non-streaming paths correctly read `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` from DeepSeek responses. The fallback to `prompt_tokens_details.cached_tokens` is dead code for DeepSeek (OpenAI-format field) but harmless.

4. **Live test results**:

| Provider | Cache Hit | Tokens Read | Tokens Missed | Reason for miss |
|----------|-----------|-------------|---------------|-----------------|
| DeepSeek V4 Pro | 99% | 14,570 | 85 | reasoning content in history + new user msg |
| StreamLake kat-coder-pro-v2 | 100% | 14,237 | 17 | new user message only |

The 85 vs 17 miss token difference is because DeepSeek's `interleaved` reasoning injects `reasoning_content` into the message history, which sits beyond the cached prefix boundary. StreamLake has no reasoning, so only the new user message misses.

## Cache Testing Procedure

### Setup

1. Create a clean test directory (e.g. `test_deep/`)
2. Copy `bin/auth.json`, `bin/opencode.jsonc`, `dist/bin/opencode.exe`, `cmd_runner.exe`
3. Launch via cmd_runner:
   ```
   cmd_runner.exe start --cwd test_deep -- opencode.exe
   ```

### Testing

1. Send a simple query (e.g. "Hi, what is 2+2?") — this warms the cache
2. Send a second query (e.g. "Again, 2+3?") — this should show cache hits
3. Check the TUI sidebar for `Cache: XX% hit (X.XK read · XX miss)`
4. Check logs at `test_deep/.opencode/data/log/` for system prompt LLM events

### Expected results

- First request: 0% cache hit (cold start — no prefix cached yet)  
- Second request: >90% cache hit (system prompt prefix reused)
- Miss tokens on second request: only the new user message + reasoning content from history

### System prompt hash verification (for debugging prefix instability)

Add a temporary hash log in `session/llm.ts` after system prompt construction:
```typescript
const hash = Bun.SHA256.hash(system[0]).slice(0, 16)
l.info("system prompt hash (debug)", { hash, promptFile, length: system[0].length })
```
Identical hashes across consecutive requests with the same agent/model = stable prefix.

## Tasks

| # | Task | Status | Priority |
|---|------|--------|----------|
| 1 | Add debug log to capture streaming response `usage` JSON | [x] done, removed | P0 |
| 2 | Add debug log to diff two consecutive system prompts | [x] done, removed | P0 |
| 3 | Fix prefix instability based on logged diffs | [-] cancelled — no instability found | P0 |
| 4 | Remove/fix `cached_tokens` fallback for non-OpenAI providers | [-] cancelled — harmless, not worth changing | P1 |
| 5 | Handle streaming cache fields if DeepSeek omits them | [-] cancelled — cache metrics work correctly | P1 |
| 6 | Verify cache hit rate improves after fix | [x] done — 99-100% hit confirmed | P1 |

## Key Learnings

- DeepSeek uses automatic prefix caching — no `cache_control` markers needed
- Static system prompts (`reasoning.txt`, `anthropic.txt`, `default.txt`) provide stable prefixes  
- `interleaved` reasoning injects `reasoning_content` into history, causing small miss tokens on subsequent requests (expected behavior, not a bug)
- `console.error` in bundled/open code does not route to structured log files — use the Effect log system for diagnostics
