# Instruction Memoization — Fix Prompt Cache Corruption

**Created:** 2026-06-01
**Status:** Done — `instruction.ts` memoized via InstanceState, typecheck clean, 6/6 core tests pass

---

## Problem

Prompt cache hit rate is 2% because `instruction.system()` and `instruction.rules()` re-read ALL files and fetch ALL remote URLs on **every single LLM request** within the same session. If any instruction file changes mid-session (user edits AGENTS.md, CLAUDE.md, `.opencode/rules/*.mdc`), the system message content hash changes while the `promptCacheKey` (sessionID) stays the same → permanent cache miss for the session.

Transient I/O failures compound this: `read()` catches errors and returns `""`. A single failed read that later succeeds produces a different content hash → cache poisoned.

### Root cause chain

```
prompt.ts:1469 → instruction.system() → re-reads AGENTS.md/CLAUDE.md/URLs every request
  → same sessionID as cache key
  → content hash differs → server cache MISS
  → silent, permanent for that session
```

## Fix

**Memoize `instruction.system()`, `instruction.rules()`, and `systemPaths()` using `InstanceState` (ScopedCache).** Compute once per project directory, reuse for all sessions.

### Trade-off

| | Current (re-read) | Fixed (read-once) |
|---|---|---|
| Picks up file changes | Immediately | Only after project reopen |
| Cache hit rate | 2% (fragile) | Near 100% for cached blocks |
| Transient I/O corruption | Possible | Impossible (read once at init) |
| Remote URL changes | Picked up (risk) | Frozen at init (stable) |

The trade-off is correct: changing system instructions mid-conversation is an edge case. Users editing AGENTS.md mid-session should start a new session.

## Implementation

### File: `packages/opencode/src/session/instruction.ts`

**Current state:**
- `systemPaths()` — called by `system()` and `resolve()`, re-executes fs globs on every call
- `system()` — calls `systemPaths()`, reads all files + fetches HTTP URLs each time
- `rules()` — re-reads `.opencode/rules/*.mdc` on every call
- `state` (InstanceState) — only stores `claims: Map<MessageID, Set<string>>`

**New state:** Move all computation into `InstanceState.make()`:

```typescript
const instructionCache = yield* InstanceState.make(
  Effect.gen(function* () {
    // 1. Compute paths (was systemPaths body)
    const config = yield* cfg.get()
    const ctx = yield* InstanceState.context
    const paths = new Set<string>()
    // ... fs.findUp, globalFiles, config.instructions ...

    // 2. Read all files (was system body)
    const files = yield* Effect.forEach(Array.from(paths), read, { concurrency: 8 })
    const urls = (config.instructions ?? []).filter(isHttp)
    const remote = yield* Effect.forEach(urls, fetch, { concurrency: 4 })

    const systemResult = [
      ...Array.from(paths).flatMap((item, i) => files[i] ? [`Instructions from: ${item}\n${files[i]}`] : []),
      ...urls.flatMap((item, i) => remote[i] ? [`Instructions from: ${item}\n${remote[i]}`] : []),
    ]

    // 3. Read rules (was rules body)
    const rulesDir = path.join(ctx.worktree, ".opencode", "rules")
    let rulesResult: string[] = []
    if (yield* fs.existsSafe(rulesDir)) {
      const matches = yield* fs.glob(...)
      // ... read and parse each rule file ...
    }

    return { paths, systemResult, rulesResult }
  }),
)
```

**Exposed functions become thin readers:**

```typescript
const systemPaths = Effect.fn("Instruction.systemPaths")(function* () {
  return (yield* InstanceState.get(instructionCache)).paths
})

const system = Effect.fn("Instruction.system")(function* () {
  return (yield* InstanceState.get(instructionCache)).systemResult
})

const rules = Effect.fn("Instruction.rules")(function* () {
  return (yield* InstanceState.get(instructionCache)).rulesResult
})
```

**Keep `claims` Map in separate InstanceState** (genuinely per-message mutable state):

```typescript
const claimsState = yield* InstanceState.make(
  Effect.fn("Instruction.claims")(() =>
    Effect.succeed({ claims: new Map<MessageID, Set<string>>() }),
  ),
)
```

## File changes

| File | Change | Lines |
|------|--------|-------|
| `packages/opencode/src/session/instruction.ts` | Move systemPaths/system/rules computation into InstanceState.make; keep claims separate | ~40 lines restructured |

## Verification

1. **Build + typecheck:** `bun typecheck` from `packages/opencode`
2. **Runtime test:** Start a session with Anthropic model, observe `cache hit` in logs (vs `cache miss` currently)
3. **Stability test:** Edit AGENTS.md mid-session, verify no crash or corruption (old content stays, new session picks up new content)
4. **Rules test:** Add a rule file to `.opencode/rules/` mid-session, verify not included until reopen

---

## Dependency chain

- This fix touches only `instruction.ts`
- Depends on existing `InstanceState` + `ScopedCache` (already available in the layer)
- No new dependencies, no new files
