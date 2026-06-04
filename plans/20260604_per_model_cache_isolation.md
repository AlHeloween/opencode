# Plan: Per-Model Cache Isolation

**Created**: 2026-06-04
**Status**: pending
**Owner**: AlHeloween
**Branch**: `Local_Development`
**Supersedes**: `20260604_fix_stall_timeout_subagent_context.md`

---

## Summary

**Problem**: Task agent with 256K model crashes at start when main agent has 500K cached content. Provider reuses main agent's prompt cache for task agent because cache key is identical when task model inherits parent model ID.

**Root cause**: Cache key at `llm.ts:206` is `[sessionID, agent, modelID]`. When task model isn't explicitly configured via `model.json`, the task agent inherits the parent's model ID. Different sessions but same model → provider may conflate caches internally.

**Fix**: Scope cache key by session type (main vs subagent). One line change. No content modifications.

---

## Goal 1: Stream Stall Timeout ✅

- [x] `Stream.timeout` replaces `Effect.timeoutOrElse` — idle-based
- [x] Default 120s idle timeout (was 30_000_000ms)
- [x] Completion-flag stall detection
- [x] Typechecked

**File**: `packages/opencode/src/session/processor.ts`

---

## Goal 2: Cache Key Scoping

### Task 2.1 — Add Model Context Scope to Cache Key

**File**: `packages/opencode/src/session/llm.ts:206`

```diff
- cacheKey: [input.sessionID, input.agent.name, input.model.id].join(":"),
+ cacheKey: [
+   input.parentSessionID ? "sub" : "main",
+   input.sessionID,
+   input.agent.name,
+   input.model.id,
+ ].join(":"),
```

**Effect**: Cache key changes from `ses_child:explore:model` to `sub:ses_child:explore:model`. Provider sees completely different key → creates independent cache → 500K main agent content never leaks into 256K task agent request.

**Constraint**: `input.parentSessionID` is already present in `StreamInput` (line 77), populated from `prompt.ts:1327` (`session.parentID`). No new plumbing needed.

### Task 2.2 — Verify no other cache key paths

The fallback at `transform.ts:878` (`[sessionID, modelID]`) is dead code for the main LLM path — `llm.ts:206` always provides explicit `cacheKey`. No change needed.

### Task 2.3 — Cross-Model Cache State Cleanup

**Files**: `packages/opencode/src/session/processor.ts:111-113`, `packages/opencode/src/session/llm.ts:32`

When a subagent session finishes:
1. Clean `cachePoisonStates` entry for the subagent's `sessionID:agent:modelID` key
2. Clean `systemContentHashes` entry for the same key
3. Hook at `task.ts` after `ops.prompt()` completes — add `TaskPromptOps.cleanup(sessionID)`

This is a separate cleanliness concern, not blocking the core fix.

### Task 2.4 — Pre-Call Token Validation (Follow-Up)

Optional enhancement: before `llm.stream()` in `processor.ts`, estimate tokens using `Token.estimate()` and check against `usable(ctx.model)`. If predicted overflow, return `"compact"` early instead of letting the provider reject the call.

**File**: `packages/opencode/src/session/processor.ts:743-754`

---

## Implementation Plan

### Phase 1: Core Fix (one line)

```
Build order:
  2.1  Cache key scoping  ← implements per-model isolation
```

### Phase 2: Cleanup (follow-up)

```
  2.3  Cross-model cache state cleanup
```

### Phase 3: Enhancement (deferred)

```
  2.4  Pre-call token validation
  —    TUI cache health display
  —    Model-aware messagesearch
```

---

## Constraints

- System prompt (rules, instructions) is **not** changed — mandatory content stays
- Tool definitions are **not** changed — mandatory
- Content is **not** truncated or modified — only cache key scoping changes
- Backward compatible: sessions without `parentID` get same `"main"` scope as before

---

## Verification

- [ ] `bun typecheck` — zero errors
- [ ] Launch explorer agent from session with 500K content on 256K model → no overflow
- [ ] Main agent cache unaffected by task agent runs
- [ ] Task agent cache unaffected by main agent runs

---

## SV

```
sv=[[cache-key,scoping,per-model,isolation,parentSessionID,subagent],
    [0.30,0.25,0.20,0.12,0.08,0.05]]
md5: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
prev-md5: d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9
semantic_dominant: cache_key_scoping
```
