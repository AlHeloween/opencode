# Cache Hash Stability — Debug & Fix

## Goal
Identify and eliminate the root cause of system prompt hash changes between turns that cause sequential KV cache breaks (DeepSeek ephemeral cache misses), burning 1.56M tokens across 36 cold turns in a single session with clusters of 5–9 consecutive misses.

## Evidence (from DB analysis, session `ses_0feb35c70ffe45p1tdT8K93Ekm`)
- **36 cold turns** (input > 5K), **1,558,781 tokens burned**
- **Clusters**: 5, 6, 5, 9, 4 consecutive cold turns
- **Last 2 hours**: 16 cold turns, 662K tokens, 6 cache-break events
- **Worst streak**: 11 of 14 turns cold at 16:55–17:06 (523K tokens)
- Same agent (`build`), same model (`deepseek-v4-pro`), short inter-turn gaps (seconds)
- `checkSystemStability()` confirms hash changes (prevHash ≠ newHash)

## Recent Modifications (diagnostic groundwork)

### [x] 1. Fix SV `md5: <system-computed>` placeholder lie
- **File**: `packages/opencode/src/session/prompt/reasoning.txt`
- **Change**: Removed `md5: <system-computed>` / `prev-md5: <previous-turn>` from Rule 5 SV format
- **Why**: Prompt told model to output placeholders that no backend ever processes. Model faithfully output literal `<system-computed>` text. Hash chain was non-functional.
- **Commit**: `130883fd3c`

### [x] 2. Add content-diff logging to `checkSystemStability()`
- **File**: `packages/opencode/src/session/llm.ts:58-100`
- **Change**: Added `systemContentPrev` map to store previous content. On hash change, computes line-level diff and logs `diffLine`, `oldLine` (first 200 chars), `newLine` (first 200 chars), `oldLen`, `newLen`.
- **Why**: Original code only logged numeric hashes — impossible to determine WHAT changed.
- **Commit**: `130883fd3c`

### [x] 3. Fix `providerCacheKey` to include agent identity
- **File**: `packages/opencode/src/session/llm.ts:225`
- **Change**: When `providerCacheKey` is provided as override, append agent name: `[providerCacheKey, agent.name].join(":")`
- **Why**: Title agent and build agent shared the same cache key, causing false hash change detection when agent switches. Caught by content-diff instrumentation: `diffLine: 11`, session banner shifted.
- **Commit**: `ccc2112d14`

### [x] 4. Sandbox environment
- **Dir**: `experiments/20260626_cache_break_debug/`
- **Files**: `_run.cmd` (isolated DB, cleared API keys), `AGENTS.md`, `.opencode/rules/`
- **Why**: Reproduce cache breaks in isolation without polluting production DB.
- **Commit**: `130883fd3c`

## Test Plan

### Test 1: Sandbox baseline — does the cache work at all?
- [x] Start sandbox with Big Pickle (free), send 2 messages
- [x] DB: `tokens_input: 33039`, `tokens_cache_read: 0` (cache not supported by free opencode proxy)
- [x] **Zero `checkSystemStability` warnings** — fix verified: no false positive from agent switch
- **Note**: Big Pickle uses opencode proxy which doesn't support ephemeral KV caching. Cache read will always be 0 for free models. Direct provider (DeepSeek with API key) needed for cache hit verification.

### Test 2: Checkpoint save/load cycle stability
- [ ] Send 2 messages → checkpoint saved
- [ ] Send 3rd message → checkpoint loaded
- [ ] Verify system hash identical between turns 2 and 3
- [ ] Query `cache_fingerprints.db`: same `system_md5` on consecutive turns
- **Oracle**: `checkSystemStability` log (should be silent), fingerprint DB
- **Pass**: No hash changes, fingerprint stable
- **Blocked**: Requires direct provider with API key for meaningful cache verification

### Test 3: Binary restart — does checkpoint survive restart?
- [ ] Send 2 messages → checkpoint saved
- [ ] Terminate TUI, restart with SAME binary
- [ ] Send 3rd message
- [ ] Verify no `checkSystemStability` warning
- **Oracle**: Log output, fingerprint DB
- **Pass**: Cache hit on restart, no hash change

### Test 4: Rule file change mid-session — does it poison cache?
- [ ] Start session, send 1 message
- [ ] Modify `.opencode/rules/semantic-coding-agent-drop-in.mdc` (or create one)
- [ ] Send 2nd message
- [ ] Check if `instructionCache` reloads or stays stale
- **Oracle**: `checkSystemStability` log with diff
- **Pass**: Identify whether instruction cache is truly static or reloads

### Test 4b: Agent switch (title→build) hash change [NEW]
- [x] Start session, observe title agent runs first, then build agent
- [x] `checkSystemStability` fired: `diffLine: 11`, `oldLine: "[session: ses_...]"`, `newLine: ""`
- [x] **Root cause confirmed**: `providerCacheKey` didn't include agent name when overridden. Title and build agents shared the same cache key but had different system prompts.
- [x] **Fix applied** (`llm.ts:225`): always include `input.agent.name` in `providerCacheKey`
- [x] **Committed**: `ccc2112d14`

### Test 5: Working directory change — does `Instance.directory` leak?
- [ ] Start session, send 1 message
- [ ] Agent uses bash tool to `cd` somewhere else
- [ ] Send 2nd message
- [ ] Check if `sys.environment()` includes new cwd
- **Oracle**: `checkSystemStability` log — look for `Working directory:` line change
- **Pass**: Confirm/deny cwd leak hypothesis

### Test 6: Compaction → cache reset pattern
- [ ] Run session long enough to trigger compaction
- [ ] Observe cache behavior before/after compaction
- [ ] Check if checkpoint invalidation on compaction (line 1600) causes cold rebuild with different hash
- **Oracle**: DB cold turn pattern around compaction events
- **Pass**: Confirm whether compaction is a cache-break trigger

### Test 7: Full reproduction — 5+ consecutive cold turns
- [ ] Run extended session in sandbox
- [ ] Monitor logs for `checkSystemStability` warnings
- [ ] Capture the exact `oldLine` / `newLine` diff when it breaks
- [ ] Identify the system prompt component that changed
- **Oracle**: Diff log from instrumentation
- **Pass**: Root cause identified with line-level evidence

## Findings (from instrumentation)

### Confirmed: `providerCacheKey` shared across agents
The `providerCacheKey` does NOT include the agent name, causing `checkSystemStability` to detect false hash changes when the agent switches (title→build). Both agents share the same `cacheKeyHash`, but their system prompts differ (title uses `agent:title` prompt, build uses `default.txt`).

**Evidence from sandbox test:**
```
diffLine: 11
oldLine: "[session: ses_0face8478ffeTK6LIJFEuiOQO4]"
newLine: ""  ← empty, session banner shifted
oldLen: 4797, newLen: 4798
cacheKeyHash: 4270833847253046300 (same for both agents)
```

### Impact
- Every time the agent changes (title→build, build→compaction, etc.), the system hash changes → KV cache miss
- This explains the "sequential" cold turns: if compaction or summary agents run between build turns, the cache resets

### Next: Fix providerCacheKey to include agent identity
The fix should add agent name to `providerCacheKey` so that different agents have separate cache namespaces. This prevents false hash change detection when agents switch.

## Deliverables
1. Root cause identified (specific line/component that changes between turns)
2. Fix implemented
3. All tests pass (no spurious hash changes)
4. Plan moved to `plans_completed/`
