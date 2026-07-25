# Plan: Improve Cache Prefix Stability Across Session Restores

**Created**: 2026-05-26
**Status**: [x] Implemented and typechecked
**Validated**: [x] By explore agent (ses_19b81b982ffeUEUOQYuJnS1cCP)

## Goal

Make the provider-side prompt cache survive app restarts and across-day usage by separating dynamic content (today's date) from the cached system prompt prefix. Add diagnostics so users can see cache effectiveness.

## Problem

When a session is restored after app restart, the LLM provider's prompt cache is cold:

1. **P0**: `system.ts:86-101` (`environment()` at line 97) injects `Today's date: ${new Date().toDateString()}` into the system prompt. This changes daily → cache prefix content hash changes → cache miss even if provider TTL hasn't expired.
2. **Provider TTL** (~5-10 min) is outside our control, but is worsened by #1.

Cache key (`sessionID`) IS preserved across restores (DB primary key). Cache **content** is NOT because the system prompt drifts.

## Root Cause Architecture

Current data flow (all one string → one system ModelMessage):

```
llm.ts:111-122  →  system[0] = join(reasoningPrefix, agentPrompt, ...input.system, userSystem)
llm.ts:136-140  →  rejoined to 2 strings
llm.ts:376      →  system: system.join("\n")  →  ONE system ModelMessage
transform.ts:260 →  applyCaching() marks system message → date in cache content
```

Key finding from explore: at `llm.ts:376`, `system: system.join("\n")` produces a single string → single ModelMessage. The AI SDK accepts `system: string[]` (confirmed from `ai/dist/index.d.ts`). Changing this to pass the array directly enables multiple system messages, and `applyCaching()` (which marks "first 2 system messages" at `transform.ts:258`) will naturally skip the 3rd (date).

## Implementation

### File 1: `packages/opencode/src/session/system.ts` [x]

**Interface** (line 52-55) — add new method:
```ts
export interface Interface {
  readonly environment: (model: Provider.Model) => string[]
  readonly environmentDate: () => string[]    // NEW
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}
```

**Service.of** (line 85-102) — add `environmentDate()`, remove date from `environment()`:
```ts
// NEW method (add after environment block):
environmentDate() {
  return [`  Today's date: ${new Date().toDateString()}`]
},

// MODIFIED environment() — remove line 97:
//   `  Today's date: ${new Date().toDateString()}`,
// (keep all other lines identical)
```

### File 2: `packages/opencode/src/session/prompt.ts` [x]

**Lines 1467-1474** — add `envDate` to Effect.all, place last in system array:
```ts
// Current:
const [skills, env, instructions, rules, modelMsgs] = yield* Effect.all([...])
const system = [...rules, ...instructions, ...env, ...(skills ? [skills] : [])]

// New:
const [skills, env, envDate, instructions, rules, modelMsgs] = yield* Effect.all([
  sys.skills(agent),
  Effect.sync(() => sys.environment(model)),
  Effect.sync(() => sys.environmentDate()),     // NEW
  instruction.system().pipe(Effect.orDie),
  instruction.rules().pipe(Effect.orDie),
  MessageV2.toModelMessagesEffect(msgs, model),
])
const system = [...rules, ...instructions, ...env, ...(skills ? [skills] : []), ...envDate]
```

### File 3: `packages/opencode/src/session/llm.ts` — THREE changes [x]

**Change 3a — Lines 110-123: Restructure system build**

Replace the `system.push(join(...))` pattern with separate messages:
```ts
const system: string[] = []
// Header: reasoning prefix + agent/provider prompt (stable, will be cached)
system.push(
  [
    ...(reasoningPrefix ? [reasoningPrefix] : []),
    ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
  ]
    .filter((x) => x)
    .join("\n"),
)
// Add environment/rules/instructions/skills as separate messages
for (const item of input.system) {
  system.push(item)
}
// Add user system prompt
if (input.user.system) system.push(input.user.system)
```

**Change 3b — Lines 135-140: Modified rejoining**

Replace the 2-message collapse with a 3-message collapse (keep header, keep 2nd, collapse rest into 3rd):
```ts
// Keep first 2 messages for caching, collapse 3+ into message 2
if (system.length > 2 && system[0] === header) {
  const tail = system.slice(2)
  const second = system[1]
  system.length = 0
  system.push(header, second)
  if (tail.length > 0) {
    system.push(tail.join("\n"))
  }
}
```

This produces: `[header, second, tailJoined]` — 3 elements when `> 2`, 2 when `=== 2`. The date (from `input.system`) is in element position 2 or later due to being last in the `input.system` array.

**Change 3c — Line 376: Pass system as system messages, not joined string**
```ts
// Current:
...(isOpenaiOauth || isWorkflow ? {} : { system: system.join("\n") }),
// New:
...(isOpenaiOauth || isWorkflow
  ? {}
  : { system: system.map((content) => ({ role: "system" as const, content })) }),
```

This enables the AI SDK to create multiple SystemModelMessage objects. `applyCaching()` at `transform.ts:258` marks the first 2 — the 3rd (date) remains uncached.

**Change 3d — Cache hit/miss logging** (diagnostics):

Add in the `processor.ts` finish-step handler where normalized usage data is available. Log cache status without treating cold cache as a bug:
```ts
if (usage.tokens.input > 0 || usage.tokens.cache.read > 0 || usage.tokens.cache.write > 0) {
  log.info(Session.isCacheWarm(usage.tokens) ? "cache hit" : "cache miss", {
    sessionID: ctx.sessionID,
    modelID: ctx.model.id,
    inputTokens: usage.tokens.input,
    cacheReadTokens: usage.tokens.cache.read,
    cacheWriteTokens: usage.tokens.cache.write,
  })
}
```

### File 4: `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx` [x]

**Lines 90-94** — Always show cache status, not just when warm:
```tsx
// Current (line 90):
{state().cacheRead > 0 && (
  <text fg={...}>Cache: {state().cacheHitRate}% hit ({...} read · {...} miss)</text>
)}

// New: always show when there's context data
{state().cacheRead > 0 ? (
  <text fg={...}>Cache: {state().cacheHitRate}% hit ({fmt.format(state().cacheRead)} read · {fmt.format(state().cacheInput)} miss)</text>
) : state().cacheInput > 0 ? (
  <text fg={theme().textMuted}>Cache: cold (no cached tokens)</text>
) : null}
```

### File 5: `packages/opencode/src/session/session.ts` — NEW helper [x]

Add utility to check cache warmth (for use in diagnostics):
```ts
export function isCacheWarm(tokens: { cache: { read: number } }): boolean {
  return tokens.cache.read > 0
}
```

## Result

```
Before (2 msg → 1 ModelMessage):  [header+date+stuff, pluginStuff]  → cached (contains date)
After  (3 msg → 3 ModelMessages): [header, stableStuff, date]       → first 2 cached, date uncached
```

| Message Position | Content | Cached? |
|---|---|---|
| `system[0]` | reasoning prefix + agent/provider prompt | Yes (stable) |
| `system[1]` | rules + instructions + env core + skills | Yes (stable) |
| `system[2+]` | today's date (+ any extra plugin content) | No (volatile) |

## Validation from Explore Agent

- [x] `environment()` returns `[joinedString]` (1-element array) — `environmentDate()` follows same pattern
- [x] Only one caller of `sys.environment()` — `prompt.ts:1469`
- [x] Subtask/compaction flows do NOT include date (`system: []` or don't call environment)
- [x] AI SDK v6 accepts `system: string[]` (type-safe, confirmed in dist types)
- [x] `applyCaching()` at `transform.ts:258` already marks first 2 system messages — no change needed
- [x] `applyCaching()` at `transform.ts:349-361` is gated to Anthropic-family — date fix benefits ALL providers via `promptCacheKey`
- [x] `options()` at `transform.ts:864` sets `promptCacheKey = sessionID` for OpenAI/Azure/opencode/Venice/OpenRouter

## What does NOT need changing

- `applyCaching()` — already handles first-2-only
- `ProviderTransform.message()` — unchanged
- Compaction/subtask flows — don't include date
- No other callers of `sys.environment(model)`

## Verification

1. [x] `bun typecheck` in `packages/opencode/` — passed via cmd_runner run `20260526T144618Z_527e8165`
2. [ ] Manual test: start session, close app, reopen within 1 min → first message shows "Cache: cold" in TUI, second message shows cache hit %
3. [x] Check: date still appears in system messages (via message 2+) — model still knows today's date

## Non-goals

- Provider TTL control (outside our control)
- Cache pre-warming / priming (would cost tokens)
- Cross-fork cache continuity (separate issue, needs different sessionID strategy)
