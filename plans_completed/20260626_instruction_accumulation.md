# Instruction Content Accumulation — Per-Turn Hash Break

> **Status**: Diagnosis phase. Code analysis found no accumulation mechanism, but evidence is conclusive.

## Goal
Identify and fix the mechanism that causes instruction content (`# Tone` from AGENTS.md) to be prepended before the session banner every turn, shifting the banner from line 11→12→23→34→45 and growing the system by ~460 chars each turn. This causes `checkSystemStability` hash changes on every single turn, even within the same agent.

## Evidence (from sandbox `ses_0fa9a062dffepbaq69CnyQ0677`, Test-Picke binary 10.0.247)

Log entries from `checkSystemStability` (same `cacheKeyHash: 9580022051858516000`, same agent `build`):

| Turn | diffLine | oldLine | newLine | oldLen | newLen | Growth |
|------|----------|---------|---------|--------|--------|--------|
| 1→2 (title→build) | 11 | `[session: ses_...]` | `""` | 4797 | 4798 | +1 |
| 2→3 (build→build) | 12 | `[session: ses_...]` | `# Tone` | 4798 | 5261 | +463 |
| 3→4 (build→build) | 23 | `[session: ses_...]` | `# Tone` | 5261 | 5724 | +463 |
| 4→5 (build→build) | 34 | `[session: ses_...]` | `# Tone` | 5724 | 6187 | +463 |
| 5→6 (build→build) | 45 | `[session: ses_...]` | `# Tone` | 6187 | 6650 | +463 |

Every turn, `# Tone` (AGENTS.md instruction content) appears where the session banner was, and the banner shifts 11 lines deeper. System grows exactly ~463 chars each turn.

## Code Analysis (Explore Agent)

Key finding: **No accumulation mechanism found.** The explorer traced:

| Component | Cache | Accumulation Risk |
|-----------|-------|-------------------|
| `instructionCache` | `ScopedCache` keyed by `directory` | None — computed once |
| `instruction.system()` | Returns cached `system` array | None |
| `instruction.rules()` | Returns cached `rules` array | None |
| `instruction.resolve()` | Per-message `claimsState` | None — tool output only |
| Checkpoint load | Returns exact saved state | None |
| Checkpoint save | Saves pre-mutation `system` | None |
| `llm.ts` assembly | Fresh array each turn | None |
| Plugin hook | No subscribers | None |

**Gap**: Code analysis says no accumulation. Evidence says accumulation. Something is missed.

## Hypothesis

The most likely culprit is the `ScopedCache` key for `instructionCache` — `directory` from `InstanceState.directory`. If this key changes between turns (subtle path differences: trailing slash, case, symlink resolution), the cache would miss and recompute. Each recomputation might discover different instruction files, or the same file processed differently.

Alternatively: the `system` array from prompt.ts is being mutated AFTER assembly by some code path the explorer missed.

## Plan

### Step 1: Fix diagnostic code
- Remove broken `instruction.ts` edits (double `ctx`, untested `Log.Default.warn`)
- Use `log.info()` (the prompt.ts session logger) instead of `Log.Default`

### Step 2: Add assembly-size tracing
- In `prompt.ts:1278` (and the checkpoint path at line 1640): log `rules.length`, `rules[0]?.slice(0,80)`, `env.length`, `instructions.length`, `instructions[0]?.slice(0,80)`, `sessionIdBanner`
- Use `log.info()` with sessionID tag so it appears in session system log

### Step 3: Add cache-key tracing
- In `instruction.ts:206-211`: log `directory` value passed to `ScopedCache.get()` every time `instruction.system()` or `instruction.rules()` is called
- This tells us if the cache key changes between turns

### Step 4: Reproduce in sandbox
- Run `_run.cmd` sandbox, send 3 messages with same agent
- Check session system log for assembly sizes and cache keys
- If cache key changes → fix `InstanceState.directory` stability
- If a specific component grows → trace that component's source

### Step 5: Fix root cause
- Apply fix based on Step 4 findings
- Verify: 3 consecutive turns with same agent → zero hash changes

### Step 6: Cleanup
- Remove diagnostic logging
- Move plan to `plans_completed/`
