# System Prompt Date Kills Provider Cache — Investigation

Date: 2026-06-09  
Status: Plan

## Discovery

The dynamic `"Today's date: {date}"` in the system prompt creates a token divergence point that **invalidates provider-level prefix caching** for the entire conversation that follows it.

## Mechanism

DeepSeek's prefix cache matches token-by-token from the start of the request. The system messages are sent as 3 sequential `<system>` blocks:

```
system[0] = reasoningPrefix + agent/provider prompt    ← token 0..N   (stable)
system[1] = rules + instructions + env + capabilities   ← token N..M   (stable)
system[2] = "Today's date: {date}"                      ← token M..P   (CHANGES)
user[0]   = conversation message 1                      ← token P..Q   (never cached)
user[1]   = conversation message 2                      ← token Q..R
...
```

DeepSeek matches tokens from position 0 forward. It matches all of system[0] + system[1] (cache hit). Then it reaches system[2] and matches "Today's date: " (hit), then reaches the digit(s) — `"9"` vs `"10"` — divergence. **Everything from token P (the first diverging byte) onward is a cache miss.** This means all user messages, all conversation history — zero cache hits despite being unchanged from yesterday.

## Scope

Affects ALL requests (not just compaction):
- Chat turn 1 (date X) → chat turn 2 (date Y) — cache miss for conversation
- Chat turn (date X) → compaction (date X, same day) — cache hit IF all else equal
- Chat turn (date X, 23:59) → chat turn (date Y, 00:01, next day) — cache miss

## Fix Options

### Option A: Remove date from system prompt entirely

Replace `environmentDate()` output with nothing, or a non-date string.

**Pro**: Simplest. Eliminates the problem completely.  
**Con**: LLM loses date awareness. May produce incorrect `Date.now()` references in code, or mention wrong dates.

### Option B: Move date to last user message (not system)

Inject `"Today's date is {date}"` at the START of the first user message instead of in the system prompt.

**Pro**: Date doesn't break system prefix. User messages are usually unique per-turn anyway, so the date diverging there has no additional cost (it diverges at the user question regardless).  
**Con**: Date injection into user messages may confuse some prompt structures.

### Option C: Use stable date token, inject real date separately

Replace `"Today's date: June 9, 2026"` with `"Use current_date for today's date."`. Then inject the actual date via a small non-cached metadata field or a separate short system message at the very end (after stable content).

**Pro**: Preserves date accuracy without breaking prefix cache.  
**Con**: Adds complexity; some LLMs may not reliably use metadata fields.

### Option D: Put date at very end, after user messages

Not possible — system messages must precede user messages in the API format.

## Files Involved

| File | Line | What |
|------|------|------|
| `prompt.ts` | 1314 | `sys.environmentDate()` called |
| `prompt.ts` | 1319 | `envDate` appended to system array |
| `llm.ts` | 152 | `findIndex("Today's date:")` splits stable/dynamic |
| `llm.ts` | 168 | `dynamicSystem` pushed as system[2] |
| `system.ts` | 104-106 | `environmentDate()` returns `["Today's date: {date}"]` |

## Experiment Needed

Phase 5 of the cache experiment (`provider_cache_test.ts`) should include a test that:
1. Sends same conversation with dates 24h apart
2. Measures `prompt_cache_hit_tokens` for both
3. Confirms: date change → zero cache hits for conversation tokens
4. Tests each fix option (remove date, move to user message, etc.)
