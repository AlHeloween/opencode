# Performance Optimization Implementation Plan

## Overview

This plan addresses performance bottlenecks and correctness issues identified in the opencode codebase. Phase 1 (4 items) has been implemented. Phase 2.1 was attempted but reverted due to retry interaction. Phase 2.2 is implemented. Phase 3.1 was skipped. Phase 4 (gateway, runtime, and tooling optimizations) is implemented. Phase 5 (research report fixes) is implemented.

---

## Phase 1: Implemented

### 1.1 String Accumulation Optimization ✅

**Files:** `packages/opencode/src/util/string-builder.ts` (new), `packages/opencode/src/session/processor.ts`
**Problem:** O(n²) string concatenation for streaming text/reasoning deltas
**Solution:** `StringBuilder` class accumulates chunks in an array, joins once at end
**Impact:** Eliminates quadratic string allocation during streaming

### 1.2 MCP Concurrency Limiting ✅

**File:** `packages/opencode/src/mcp/index.ts`
**Problem:** `{ concurrency: "unbounded" }` for MCP server initialization
**Solution:** Changed to `{ concurrency: 4 }` for all MCP forEach operations
**Impact:** Prevents resource exhaustion when many MCP servers are configured

### 1.3 Doom Loop Detection - Cache Parts ✅

**File:** `packages/opencode/src/session/processor.ts`
**Problem:** `MessageV2.parts(ctx.assistantMessage.id)` called on every tool-call event (full DB query)
**Solution:** Added `partsCache: MessageV2.Part[]` to `ProcessorContext`, populated on tool creation
**Impact:** Eliminates DB query on every tool invocation

### 1.4 Message Loading - Enforce Limits ✅

**File:** `packages/opencode/src/session/index.ts`
**Problem:** `Array.from(MessageV2.stream(input.sessionID)).reverse()` loads entire session history
**Solution:** Default limit of 500 messages via `MessageV2.page()` pagination
**Impact:** Prevents OOM on very long sessions

---

## Phase 2: Partial

### 2.1 Delta Event Coalescing ❌ (Reverted)

**Status:** Attempted but reverted due to retry interaction
**Issue:** Accumulated deltas from failed retry attempts would leak into subsequent retry attempts, causing test timeouts. The retry mechanism re-runs the same `process` function, and stale deltas in the closure variable were flushed during cleanup.
**Alternative:** Could be revisited with a per-attempt scoped delta queue that's explicitly cleared on retry.

### 2.2 Compaction - Avoid Full structuredClone ✅

**File:** `packages/opencode/src/session/compaction.ts`
**Problem:** `structuredClone(messages)` deep-clones entire message history before plugin trigger
**Solution:** Replaced with shallow clone: `messages.map((m) => ({ info: { ...m.info }, parts: [...m.parts] }))`
**Impact:** Reduces memory allocation and CPU time for large sessions during compaction

---

## Phase 3: Skipped

### 3.1 Snapshot Patch Debouncing ⏭️

**Status:** Skipped
**Rationale:** Per-step patches provide valuable granularity for revert functionality. The current code already only creates one patch per step (not per event), which is reasonable. The complexity of debouncing outweighs the benefit.

---

## Phase 4: Gateway, Runtime, and Tooling Optimizations ✅

### 4.1 Health Window - Circular Buffer ✅

**File:** `packages/opencode/src/provider/gateway/health-window.ts`
**Problem:** `pushSample()` used `[...samples, value]` + `.slice()` creating 2 new arrays per call
**Solution:** Replaced with `CircularBuffer` class using fixed-size array with head pointer (O(1) push, zero allocation)
**Impact:** Eliminates GC pressure from health sampling (100 samples per route, called per request)

### 4.2 Health Score Normalization Bug ✅

**File:** `packages/opencode/src/provider/gateway/health-window.ts`
**Problem:** Dead variable `sampleCount = 1` used as normalization divisor, making a single error saturate the penalty to 1.0
**Solution:** Changed to `Math.max(1, recent429 + recent5xx)` with max=10 normalization
**Impact:** Fixes overly punitive health scoring that could prematurely deprioritize routes

### 4.3 Async Logger - Bulk Trim ✅

**File:** `packages/opencode/src/provider/gateway/async-logger.ts`
**Problem:** `queue.shift()` is O(n) on large arrays
**Solution:** Replaced with `queue.splice(0, excess)` to trim in bulk
**Impact:** Eliminates O(n) operation on every overflow

### 4.4 H2 Transport - LRU Eviction ✅

**File:** `packages/opencode/src/provider/gateway/h2-transport.ts`
**Problem:** `Array.from(sessions).sort(...)` on every session creation when pool is full (O(n log n))
**Solution:** Replaced with O(n) linear scan for oldest session
**Impact:** Reduces GC pressure and CPU during connection pool management

### 4.5 Gateway Store - Unbounded Maps ✅

**File:** `packages/opencode/src/provider/gateway/store.ts`
**Problem:** `healthWindows`, `circuitBreakers`, `retryBudgets` Maps grow without bound
**Solution:** Added 500-entry limits with `evictStaleEntries()` function called during persist and route creation
**Impact:** Prevents unbounded memory growth in long-running processes

### 4.6 Gateway Store - JSON.stringify Off Main Thread ✅

**File:** `packages/opencode/src/provider/gateway/store.ts`
**Problem:** `JSON.stringify()` in `persist()` blocks event loop every 30 seconds
**Solution:** Offloaded to `setImmediate` callback to yield back to event loop
**Impact:** Prevents periodic event loop stalls during persistence

### 4.7 Effect Runtime - Hot Path Exception Elimination ✅

**Files:** `packages/opencode/src/effect/run-service.ts`, `packages/opencode/src/util/context.ts`, `packages/opencode/src/project/instance.ts`
**Problem:** `attach()` function calls `Instance.current` (which throws `Context.NotFound`) on every Effect execution app-wide, using try/catch as control flow
**Solution:** Added `context.getStore()` (non-throwing) and `Instance.currentMaybe` that returns `undefined` instead of throwing
**Impact:** Eliminates exception overhead on the hottest path in the codebase (every Effect execution)

### 4.8 Projectors - Remove Duplicate Init ✅

**File:** `packages/opencode/src/server/projectors.ts`
**Problem:** `initProjectors()` called 3 times (server.ts:26, projectors.ts:8, projectors.ts:28), potentially registering duplicate event handlers
**Solution:** Removed module-level call at line 28, keeping only the call from server.ts
**Impact:** Prevents duplicate event handler registration

### 4.9 AsyncQueue - Linked List Deque ✅

**File:** `packages/opencode/src/util/queue.ts`
**Problem:** `Array.shift()` is O(n) for every event dequeue
**Solution:** Replaced array-based queue with linked-list implementation (O(1) push and O(1) shift)
**Impact:** Eliminates O(n) dequeue in SSE event path

### 4.10 Message Stream - Larger Page Size ✅

**File:** `packages/opencode/src/session/message-v2.ts`
**Problem:** `stream()` paginates in chunks of 50, causing N/50 DB round-trips for full-session reads
**Solution:** Increased page size from 50 to 500
**Impact:** 10x fewer DB round-trips for session history loading

### 4.11 Part Update - Shallow Clone ✅

**File:** `packages/opencode/src/session/index.ts`
**Problem:** `structuredClone(part)` deep-clones entire part object on every update delta (including streaming text)
**Solution:** Replaced with shallow spread `{ ...part }`
**Impact:** Reduces CPU and memory for streaming updates

### 4.12 Bash Tool - Array Accumulation ✅

**File:** `packages/opencode/src/tool/bash.ts`
**Problem:** `output += chunk` in streaming loop is O(n²) string concatenation
**Solution:** Replaced with `outputChunks.push(chunk)` array, final `join("")`
**Impact:** Eliminates quadratic memory allocation for large command outputs

### 4.13 Grep Tool - Batched Stat ✅

**File:** `packages/opencode/src/tool/grep.ts`
**Problem:** `Filesystem.stat()` (sync) called per match in sequential loop, blocking event loop
**Solution:** Replaced with batched `Promise.all(statPaths.map(statAsync))` for all matches
**Impact:** Parallel stat calls instead of sequential blocking calls

### 4.14 Build Version - Use Package Version ✅

**File:** `packages/script/src/index.ts`
**Problem:** Preview builds generated `0.0.0-{channel}-{timestamp}` instead of using actual package version
**Solution:** Read version from `packages/opencode/package.json` and use as base: `${pkgVersion}-${channel}-${timestamp}`
**Impact:** opencode.exe shows correct version (e.g., `1.3.17-dev-...`) instead of `0.0.0-local_development`

---

## Phase 6: Agent Tool Wiring ✅

### 6.1 Message Search Tool ✅

**Files:** `packages/opencode/src/tool/messagesearch.ts` (new), `packages/opencode/src/tool/messagesearch.txt` (new), `packages/opencode/src/tool/registry.ts`, `packages/opencode/src/cli/cmd/run.ts`, `packages/ui/src/i18n/en.ts`
**Problem:** FTS5 full-text search was implemented at the data/API layer but not exposed as an agent tool — agents could not search conversation history
**Solution:** Created `MessageSearchTool` ("messagesearch") that calls `Session.search()` and formats BM25-ranked results with highlighted snippets. Registered in tool registry and added CLI display handler.
**Impact:** Agents can now search across all sessions in a project for relevant message content, useful for referencing earlier context without re-reading entire session history

### 6.2 Agent Rules - Prioritize Message Search ✅

**Files:** `packages/opencode/src/agent/agent.ts`, `packages/opencode/src/session/prompt/default.txt`, `packages/opencode/src/session/prompt/plan-reminder-anthropic.txt`, `.opencode/rules/semantic-coding-agent-drop-in.mdc`, `.cursor/rules/semantic-coding-agent-drop-in.mdc`
**Problem:** Agents had no guidance to search conversation history before planning or execution, leading to re-treading ground and missing prior decisions
**Solution:**

- Added `messagesearch` to `explore` agent's allowed tools (was in deny-all pattern)
- Added "Search conversation history first" as step 1 in `default.txt` task instructions
- Added `messagesearch` step to Phase 1 of planning workflow (`plan-reminder-anthropic.txt`)
- Added "Search conversation history" to the "Before any project activity" checklist in semantic coding rules
  **Impact:** Agents now check prior discussions before planning or implementing, preventing redundant work and preserving continuity with earlier decisions

---

## Phase 5: Research Report Fixes ✅

### 5.1 CLI Lifecycle - Await Event Loop ✅

**File:** `packages/opencode/src/cli/cmd/run.ts`
**Problem:** `loop().catch(...)` started without `await`; `index.ts` calls `process.exit()` in `finally` block, which could kill streaming before completion
**Solution:** Store loop promise, `await` it after `sdk.session.prompt()`/`sdk.session.command()` completes
**Impact:** Prevents premature process termination during streaming

### 5.2 ResolveMessage Guard ✅

**File:** `packages/opencode/src/index.ts`
**Problem:** `e instanceof ResolveMessage` without import/guard — can throw ReferenceError under Node runtime
**Solution:** Added `typeof ResolveMessage !== "undefined"` guard before instanceof check
**Impact:** Prevents error-reporting code from crashing on non-Bun runtimes

### 5.3 Log.write Async Mismatch ✅

**File:** `packages/opencode/src/util/log.ts`
**Problem:** `write` was async (returned Promise) but callers never awaited it — fire-and-forget promises risking unhandled rejections
**Solution:** Made `write` synchronous; errors go to stderr instead of unhandled rejections
**Impact:** Eliminates unhandled promise rejections from logging path

### 5.4 JSON Migration Concurrency Limit ✅

**File:** `packages/opencode/src/storage/json-migration.ts`
**Problem:** `batchSize = 1000` with `Promise.allSettled(tasks)` reading 1000 JSON files concurrently — can exhaust file descriptors
**Solution:** Added `readConcurrency = 64` limit; batch files into chunks processed by concurrent workers
**Impact:** Bounded file descriptor usage and memory during JSON→SQLite migration

### 5.5 Symlink Traversal Hardening ✅

**File:** `packages/opencode/src/tool/external-directory.ts`
**Problem:** `Instance.containsPath(full)` checks lexical path without resolving symlinks — symlink inside project pointing outside could bypass security boundary
**Solution:** Added `fs.realpath()` resolution; if lexical path is inside but resolved path is outside, treat as external (require permission)
**Impact:** Closes symlink-based path traversal escape in permission system

### 5.6 Directory Listing Concurrency Bound ✅

**File:** `packages/opencode/src/tool/read.ts`
**Problem:** Directory listing used `concurrency: "unbounded"` for symlink stat operations
**Solution:** Changed to `{ concurrency: 32 }`
**Impact:** Prevents FD exhaustion and I/O spikes when listing directories with many symlinks

---

## Files Changed

### Phase 1

- `packages/opencode/src/util/string-builder.ts` (new)
- `packages/opencode/src/session/processor.ts` (StringBuilder, parts cache, cleanup improvements)
- `packages/opencode/src/mcp/index.ts` (concurrency limiting)
- `packages/opencode/src/session/index.ts` (message limit)
- `packages/opencode/src/session/compaction.ts` (shallow clone)

### Phase 4

- `packages/opencode/src/provider/gateway/health-window.ts` (CircularBuffer, health score fix)
- `packages/opencode/src/provider/gateway/async-logger.ts` (bulk trim)
- `packages/opencode/src/provider/gateway/h2-transport.ts` (LRU linear scan)
- `packages/opencode/src/provider/gateway/store.ts` (eviction, JSON offload)
- `packages/opencode/src/util/queue.ts` (linked-list deque)
- `packages/opencode/src/effect/run-service.ts` (hot path fix)
- `packages/opencode/src/util/context.ts` (getStore)
- `packages/opencode/src/project/instance.ts` (currentMaybe)
- `packages/opencode/src/server/projectors.ts` (remove duplicate init)
- `packages/opencode/src/session/message-v2.ts` (page size)
- `packages/opencode/src/session/index.ts` (shallow clone)
- `packages/opencode/src/tool/bash.ts` (array accumulation)
- `packages/opencode/src/tool/grep.ts` (batched stat)
- `packages/script/src/index.ts` (version from package.json)

### Phase 5

- `packages/opencode/src/cli/cmd/run.ts` (await event loop)
- `packages/opencode/src/index.ts` (ResolveMessage guard)
- `packages/opencode/src/util/log.ts` (sync write)
- `packages/opencode/src/storage/json-migration.ts` (concurrency limit)
- `packages/opencode/src/tool/external-directory.ts` (symlink hardening)
- `packages/opencode/src/tool/read.ts` (bounded concurrency)

### Phase 6

- `packages/opencode/src/tool/messagesearch.ts` (new - FTS agent tool)
- `packages/opencode/src/tool/messagesearch.txt` (new - tool description)
- `packages/opencode/src/tool/registry.ts` (register messagesearch tool)
- `packages/opencode/src/cli/cmd/run.ts` (display handler for messagesearch)
- `packages/ui/src/i18n/en.ts` (i18n string for messagesearch)
- `packages/opencode/src/agent/agent.ts` (add messagesearch to explore agent)
- `packages/opencode/src/session/prompt/default.txt` (search history first)
- `packages/opencode/src/session/prompt/plan-reminder-anthropic.txt` (phase 1 step)
- `.opencode/rules/semantic-coding-agent-drop-in.mdc` (pre-activity checklist)
- `.cursor/rules/semantic-coding-agent-drop-in.mdc` (pre-activity checklist)

## Testing

- All non-flaky tests pass (54/57 in processor-effect + pagination + session tests)
- 3 failures are pre-existing flaky tests (confirmed on original code)
- Typecheck passes
