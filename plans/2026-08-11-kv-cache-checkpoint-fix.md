# Fix: KV Cache Instability — Checkpoint + System Prompt

**Goal:** Make system prompt byte-stable across mode switches (build_mode ↔ plan_mode). Current state: three consecutive requests with mode switches produce three completely different system prompts — zero KV cache reuse.

**Plan created:** 2026-08-11T13:15:00Z

## Premises (⊆ G, Exact)

- C1: `checkpointPath()` and `memoryKey()` in `checkpoint.ts` include `agentName` in the key → different modes get different checkpoints
- C2: `Checkpoint.load()` in `prompt.ts:1782` passes `agentName: cacheAgent.name` → mode switch = no checkpoint = full rebuild
- C3: Full rebuild calls `Effect.all([sys.skills(cacheAgent), env, instructions, rules])` → `sys.skills()` returns undefined during service init race
- C4: `assemblePathSystem` receives `undefined` for skills → 1 fewer slot in system array
- C5: `collapseSystemMessagesInPlace` has threshold at ≤8 slots: 9→collapse (monolithic), 8→no collapse (separated messages) → structural diff
- C6: Tool descriptions (`task` tool, `skill` tool) also depend on `sys.skills()` → truncated when undefined
- C7: `buildProviderCacheKey` is `sessionID:modelID` — shared across all modes (correct, confirmed byte-stable after `systemIdentityPrompt` removal)
- C8: `lastInjectedMode` tracker in `prompt.ts:149` correctly prevents re-injection after compaction
- C9: `checkSystemStability` uses suffix-length check (fixed in `80f1330`) — detector only, doesn't generate bytes
- C10: `systemIdentityPrompt` removed, `agentPrompt: ""` in `assembleSystemMessages` — no identity in system prefix

## Root Cause (from gateway per-request evidence)

**Three requests in one session: build_mode → plan_mode → build_mode**

| Request | Chkpt | Skills | Slots | Collapse | System structure |
|---------|-------|--------|-------|----------|-----------------|
| Req1 (build) | ✅ build_mode | ✅ full | 9 | yes → monolithic | Normal |
| Req2 (plan) | ❌ plan_mode (new) | ❌ undefined | 8 | no → separated | Broken |
| Req3 (build) | ✅ build_mode | ✅ full | 9 | yes → monolithic | Normal |

The checkpoint agentName isolation creates a "rebuild lottery" on every mode switch. Each mode starts with a fresh checkpoint, hits the `sys.skills()` race, and the result is a fundamentally different system prompt structure — not just a different tail.

**Two bugs compound into complete KV cache destruction:**
1. Checkpoint keys include agentName → mode switch = full rebuild
2. `collapseSystemMessagesInPlace` threshold at 8 slots → ±1 slot flips between monolithic/separated

## Open Questions

- Q1: Is `agentName` needed for subagent checkpoints (coder_agent, explorer_agent)? Subagents have different tool sets and permissions — separate checkpoints are correct for them.

## Goals

### GATE_1_GROUND
sv: checkpoint, agentName, primary-modes, slots, collapse, sys.skills, mode-switch, KV-cache

**Document:** Gateway per-request JSON files (1786453193184, 1786453206810, 1786453218983) — three consecutive requests in same session with mode switches. Source code: `checkpoint.ts`, `prompt.ts`, `system-compose.ts`, `system.ts`.
**I/O:** Input: session + mode switch sequence. Output: byte-stable system prompt across all modes.
**Brief:** Checkpoint keys segregate primary modes → full rebuild → `sys.skills()` race → oscillating system prompt. Fix: unify checkpoint key for primary modes + fix collapse threshold.
**done_pct:** 0

**Tasks:**

- [ ] **T1**: Remove agentName from checkpoint key for primary modes
  - sv: checkpoint, agentName, primary-modes, key, isPrimaryModeIdentity
  - what: In `checkpoint.ts` — modify `memoryKey()`, `checkpointPath()`, `checkpointSlotPaths()`, `publish()`, `persist()`, `load()`, `remove()` to NOT include agentName when the agent is a primary mode identity. Subagents (coder_agent, explorer_agent, general_agent, researcher_agent, media_agent) keep agentName in key.
  - files: `packages/opencode/src/session/checkpoint.ts`
  - depends_on_claims: [C1, C2, Q1]
  - oracle: `bun test test/session/checkpoint.test.ts` — all pass
  - status: [ ]

- [ ] **T2**: Update checkpoint call site in prompt.ts
  - sv: prompt.ts, Checkpoint.load, cacheAgent, primary-modes
  - what: In `prompt.ts:1782-1788` — pass `agentName` only for non-primary modes. For primary modes, pass `undefined`. Update `checkpointData.agent` at line 2126 similarly. Update `CacheControl.getPrevFingerprint` at line 1844.
  - files: `packages/opencode/src/session/prompt.ts`
  - depends_on_claims: [C2, T1]
  - oracle: `bun typecheck` — exits 0
  - status: [ ]

- [ ] **T3**: Fix `collapseSystemMessagesInPlace` threshold determinism
  - sv: collapseSystemMessagesInPlace, threshold, deterministic, slots
  - what: The ≤8 check (line 99) creates structural divergence. Fix: remove the slot-count early return. The collapse should behave identically regardless of how many system slots exist. The function already handles 3+ slots correctly in the general case.
  - files: `packages/opencode/src/session/system-compose.ts`
  - depends_on_claims: [C4, C5]
  - oracle: Collapse produces same message structure with 8 and 9 slots
  - status: [ ]

- [ ] **T4**: Cache `sys.skills()` result per agent in InstanceState
  - sv: sys.skills, cache, InstanceState, race-condition, deterministic
  - what: `system.ts:140` — `sys.skills()` currently re-computes on every call. Wrap in `InstanceState.make` (like `instructionCache`) to cache the skill list per agent. This eliminates the race where `Effect.all` returns undefined for skills.
  - files: `packages/opencode/src/session/system.ts`
  - depends_on_claims: [C3, C6]
  - oracle: 10 consecutive calls return same result
  - status: [ ]

- [ ] **T5**: Update mode-transition test
  - sv: test, checkpoint, mode-switch, stability
  - what: Add test: build→plan→build mode switch sequence → verify system prompt is byte-identical for both build_mode turns. Add test: checkpoint survives mode switch (same key used).
  - files: `packages/opencode/test/session/mode-transition.test.ts`
  - depends_on_claims: [T1, T2]
  - oracle: `bun test test/session/mode-transition.test.ts` — all pass
  - status: [ ]

- [ ] **T6**: Typecheck + kernel tests
  - sv: typecheck, pytest, regression
  - what: `bun typecheck` from packages/opencode, `python -m pytest prompts_kernel/tests/ -q`
  - files: all modified
  - depends_on_claims: [T1, T2, T3, T4, T5]
  - oracle: exit 0 for both
  - status: [ ]

## Claim Ledger

| ID | Text | Status | Evidence |
|----|------|--------|----------|
| C1 | checkpoint key includes agentName | Exact | checkpoint.ts:89-96,122-128,131-137 |
| C2 | Checkpoint.load passes agentName | Exact | prompt.ts:1782-1788 |
| C3 | sys.skills() race in Effect.all | Inferred | prompt.ts:1811-1813 + gateway diff evidence |
| C4 | Missing skills → 1 fewer slot | Inferred | assemblePathSystem:132 |
| C5 | Collapse threshold at 8 | Exact | system-compose.ts:99 |
| C6 | Tool descriptions depend on skills | Inferred | Skill.fmt call path |
| C7 | buildProviderCacheKey = session:model | Exact | llm.ts:190 |
| C8 | lastInjectedMode survives compaction | Exact | prompt.ts:149,362,367 |
| C9 | checkSystemStability uses suffix-length | Exact | llm.ts:125-160 |
| C10 | systemIdentityPrompt removed | Exact | llm.ts:327 (agentPrompt: "") |

## Smoke Tests

### SMOKE_BEFORE (baseline)

```bash
# Typecheck
cd packages/opencode && bun typecheck 2>&1
# Expected: exit 0

# Kernel tests
cd prompts_kernel && python -m pytest tests/ -q
# Expected: 488 passed

# Checkpoint tests
cd packages/opencode && bun test test/session/checkpoint.test.ts --timeout 30000 2>&1
# Expected: all pass

# Mode transition tests
cd packages/opencode && bun test test/session/mode-transition.test.ts --timeout 30000 2>&1
# Expected: all pass
```

### SMOKE_AFTER (post-implementation oracles)

```bash
# Verify checkpoint files for primary modes don't contain agentName
ls .opencode/data/log/.checkpoints/
# Expected: files named {provider}_{model}_{sessionID}_S0.enc (no agentName for primary modes)
# Subagent checkpoints: {provider}_{model}_{agentName}_{sessionID}_S0.enc

# Verify system prompt stability across mode switches
# Manual: check gateway per-request logs — same system structure for all requests
# Automated: bun test test/session/mode-transition.test.ts

# Verify collapse produces same structure
# Manual: system with 8 and 9 slots produce identical message layout

# Typecheck clean
cd packages/opencode && bun typecheck 2>&1
# Expected: exit 0
```

## Blast Radius

- `packages/opencode/src/session/checkpoint.ts` — key construction, load/save/publish/persist (T1)
- `packages/opencode/src/session/prompt.ts` — checkpoint load call site, checkpoint save data (T2)
- `packages/opencode/src/session/system-compose.ts` — collapse threshold (T3)
- `packages/opencode/src/session/system.ts` — skills caching (T4)
- `packages/opencode/test/session/mode-transition.test.ts` — new test (T5)
- `packages/opencode/test/session/checkpoint.test.ts` — may need updates
- `packages/opencode/src/tool/task.ts` — subagent checkpoint clone (uses agentName, stays unchanged — subagents need separate checkpoints)

## Design Decision: Primary vs Subagent Separation

**Primary modes (build_mode, plan_mode, reasoning_mode):** Share the same system prefix (kernel + rules + skills + env + AGENTS.md). Identity capsule is the only difference, handled by `cleanIdentity` fingerprint. Checkpoint key = `sessionID:modelID` (no agentName).

**Subagents (coder_agent, explorer_agent, general_agent, researcher_agent, media_agent, orchestrator_agent):** Have different tool sets, different permissions, different conversation contexts. Checkpoint key = `sessionID:modelID:agentName` (agentName kept).

**Implementation:** Use `isPrimaryModeIdentity(name)` as the gate:
```typescript
const checkpointAgent = isPrimaryModeIdentity(agentName) ? undefined : agentName
```
