# Fix: provider cache key — modes share, agents separate

## Abstract

`buildProviderCacheKey()` in `llm.ts:229-237` constructs cache key as `"sessionID:modelID"` — shared across ALL agents. But primary modes (build/plan/reasoning) share the same system prefix (`[0..N]` from `system-compose.ts`), while non-primary agents (title_agent, sub-agents) have significantly different system prompts. Fix: primary modes share one key, other agents get per-agent keys.

### Architecture (from `system-compose.ts`)

```
[0] UNIVERSAL_ENV           — immutable forever
[1] reasoning_prompt.txt    — stable identity prefix (kernel)
[2..N] path system          — rules → skills → env → instructions (SAME for all agents)
[N+1] mutable tail          — banner + agentPrompt (DIFFERENT per agent)
```

- **Primary modes** (build_mode, plan_mode, reasoning_mode): share `[0..N]`, only `[N+1]` differs (agentPrompt). Provider prefix caching handles this naturally.
- **Sub-agents** (coder, explorer, etc.): already handled via `cacheLease?.cacheKey` in `task.ts:360` — bypasses `buildProviderCacheKey` entirely.
- **Title agent**: `mode: "primary"` but `hidden: true`, NOT in `isPrimaryModeIdentity()`. Has a minimal system prompt (no kernel, no full rules). Needs its own cache key.

### Current bug

```
build_mode:     key = "ses:gpt-4o" → system ~125KB (full kernel + rules + AGENTS.md)
title_agent:    key = "ses:gpt-4o" → system ~56KB  (minimal, no kernel)
                → Provider sees SAME key, DIFFERENT content
                → CACHE MISS + INVALIDATION
                → checkSystemStability() warns: "bug: system prompt changed mid-session"
```

### Fix

Primary modes → shared key `"sessionID:modelID"` (they share `[0..N]`).
Non-primary → per-agent key `"sessionID:modelID:agent"` (different system prompt).

---

## Preconditions (verified [Exact])

| ID | Text | Source |
|----|------|--------|
| C1 | `buildProviderCacheKey` accepts `identity` but ignores it | `llm.ts:227` comment + code |
| C2 | `identity` passed as `input.agent.name` at call site | `llm.ts:400` |
| C3 | build_mode ~125KB vs title_agent ~56KB system prompts | log evidence: oldLen=125529, newLen=56146 |
| C4 | `providerCacheKey` override bypasses key construction | `llm.ts:235` |
| C5 | Existing test asserts shared key across all agents | `llm.test.ts:131-138` |
| C6 | `prompt.test.ts:511` calls without identity → both sides "build_mode" | `prompt.test.ts:511` |
| C7 | `isPrimaryModeIdentity()` returns true only for build/plan/reasoning | `mode-identity.ts:26-28` |
| C8 | Sub-agents use `cacheLease?.cacheKey` override (bypass `buildProviderCacheKey`) | `task.ts:360` |
| C9 | `providerIdentityForMode()` is currently a no-op | `prompt.ts:125-127` |
| C10 | `system-compose.ts` puts agentPrompt in mutable tail `[N+1]`, not in stable body | `system-compose.ts:63,77` |

---

## Smoke Tests

### Pre-Flight Baseline

| Command | cwd | Expected |
|---------|-----|----------|
| `bun typecheck` | `packages/opencode` | exit 0 |

### Post-Implementation Oracle

| Command | cwd | Expected |
|---------|-----|----------|
| `bun typecheck` | `packages/opencode` | exit 0 |
| `bun test -- --testPathPattern="llm"` | `packages/opencode` | exit 0 |

---

## Tasks

### T1: Update `buildProviderCacheKey()` in llm.ts

**what:** Primary modes share one key; non-primary agents get per-agent keys.

**files:** `packages/opencode/src/session/llm.ts`

**depends_on_claims:** [C1, C2, C7]

**Before:**
```typescript
/**
 * Stable provider prompt-cache key. Shared across agents for the same session+model
 * (system prefix is identity-stable; do not suffix agent name).
 * `identity` is accepted for call-site compatibility and ignored.
 */
export function buildProviderCacheKey(input: {
  sessionID: string
  providerCacheKey?: string
  modelID: string
  identity?: string
}) {
  if (input.providerCacheKey) return input.providerCacheKey
  return [input.sessionID, input.modelID].join(":")
}
```

**After:**
```typescript
/**
 * Stable provider prompt-cache key.
 *
 * Primary modes (build/plan/reasoning) share one cache entry because they have
 * the same system prefix — kernel + rules + skills + env + instructions (slots
 * [0..N] in system-compose.ts). Only the mutable tail (agentPrompt) differs and
 * provider prefix caching handles that.
 *
 * Non-primary agents (title_agent, sub-agents) get their own namespace because
 * their system prompts are significantly different (no kernel, stripped rules).
 * Sub-agents also bypass this entirely via cacheLease?.cacheKey in task.ts.
 *
 * `providerCacheKey` override (from cacheLease) bypasses this entirely.
 */
export function buildProviderCacheKey(input: {
  sessionID: string
  providerCacheKey?: string
  modelID: string
  identity?: string
}) {
  if (input.providerCacheKey) return input.providerCacheKey
  const identity = input.identity ?? "build_mode"
  // Primary modes share the same system prefix — one cache entry for all modes.
  if (isPrimaryModeIdentity(identity)) {
    return [input.sessionID, input.modelID].join(":")
  }
  // Non-primary agents (title, sub-agents) get their own namespace.
  return [input.sessionID, input.modelID, identity].join(":")
}
```

**Import needed:** `import { isPrimaryModeIdentity } from "./mode-identity"`

**Result examples:**
- build_mode: `"ses:gpt-4o"` (shared with plan/reasoning)
- plan_mode: `"ses:gpt-4o"` (shared)
- reasoning_mode: `"ses:gpt-4o"` (shared)
- title_agent: `"ses:gpt-4o:title_agent"` (separate)
- No identity: `"ses:gpt-4o"` (defaults to build_mode, shared)
- providerCacheKey override: returned as-is (sub-agents)

---

### T2: Update call-site comment in llm.ts

**what:** Update the comment at line ~393-395 to reflect the new behavior.

**files:** `packages/opencode/src/session/llm.ts`

**depends_on_claims:** [C10]

**Before:**
```typescript
// Shared identity: do not suffix agent name — all roles use the same system prefix.
```

**After:**
```typescript
// Primary modes share one cache entry (same system prefix). Non-primary agents
// get their own namespace (different system prompt).
```

---

### T3: Update test in llm.test.ts

**what:** Test reflects: primary modes share key, non-primary agents get separate keys.

**files:** `packages/opencode/test/session/llm.test.ts`

**depends_on_claims:** [C5, C7]

**Before:**
```typescript
test("provider cache key is stable across agent identities (shared system prefix)", () => {
  const build = LLM.buildProviderCacheKey({ sessionID: "s1", modelID: "m1" })
  const reasoning = LLM.buildProviderCacheKey({ sessionID: "s1", modelID: "m1" })
  const otherSession = LLM.buildProviderCacheKey({ sessionID: "s2", modelID: "m1" })
  expect(reasoning).toBe(build)
  expect(otherSession).not.toBe(build)
  expect(LLM.buildProviderCacheKey({ sessionID: "s1", modelID: "m1", providerCacheKey: "lease" })).toBe("lease")
})
```

**After:**
```typescript
test("provider cache key: primary modes share, non-primary agents separate", () => {
  // Primary modes share one key (same system prefix)
  const build = LLM.buildProviderCacheKey({ sessionID: "s1", modelID: "m1", identity: "build_mode" })
  const plan = LLM.buildProviderCacheKey({ sessionID: "s1", modelID: "m1", identity: "plan_mode" })
  const reasoning = LLM.buildProviderCacheKey({ sessionID: "s1", modelID: "m1", identity: "reasoning_mode" })
  expect(build).toBe(plan)
  expect(plan).toBe(reasoning)

  // Non-primary agent gets its own key (different system prompt)
  const title = LLM.buildProviderCacheKey({ sessionID: "s1", modelID: "m1", identity: "title_agent" })
  expect(title).not.toBe(build)

  // No identity → defaults to "build_mode" → primary → shared key
  const noIdentity = LLM.buildProviderCacheKey({ sessionID: "s1", modelID: "m1" })
  expect(noIdentity).toBe(build)

  // Different session → different key
  const otherSession = LLM.buildProviderCacheKey({ sessionID: "s2", modelID: "m1", identity: "build_mode" })
  expect(otherSession).not.toBe(build)

  // providerCacheKey override bypasses everything
  expect(LLM.buildProviderCacheKey({ sessionID: "s1", modelID: "m1", providerCacheKey: "lease" })).toBe("lease")
})
```

---

## Impact analysis

| Component | Impact | Explanation |
|-----------|--------|-------------|
| `checkSystemStability()` | ✅ Mode switches still trigger warning | Expected — modes share key but have different tails. Not a bug. |
| `checkToolStability()` | ✅ Same as above | Uses same cacheKey. |
| `ProviderTransform.options()` | ✅ No changes | Receives cacheKey as-is. |
| Sub-agents (task.ts) | ✅ No changes | Use `cacheLease?.cacheKey` override, bypass entirely. |
| `prompt.test.ts:511` | ✅ Passes | No identity → "build_mode" → shared key matches. |
| KV cache continuity | ✅ No break | System prefix still byte-stable within session. |
| title_agent cache | ✅ Isolated | Own key → own cache entry → no cross-agent invalidation. |

## Out of Scope

- `providerIdentityForMode()` — no-op today; could be used later for smarter routing
- title_agent system prompt optimization (removing kernel) — separate task
- `checkSystemStability` warning suppression for mode switches — acceptable behavior
