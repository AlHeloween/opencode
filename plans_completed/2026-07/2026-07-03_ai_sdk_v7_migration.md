# Plan: AI SDK v6 → v7 Migration

**Created:** 2026-07-03T03:25
**Status:** completed
**Completed:** 2026-07-03T03:45
**Goal:** Migrate from ai@6.0.184 to ai@7.x to fix tool call JSON parsing issues with mimo-v2.5-pro

## Scope

~7 files need changes. Most other files only import types (ModelMessage, APICallError) which are unchanged in v7.

## Pre-requisites

- Node.js 22+ (Bun satisfies this)
- ESM only (already ESM)

---

## Task 1: Upgrade ai package [ ]

```bash
cd packages/opencode && bun add ai@latest
```

Check peer deps: `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic` may need bumping too.

---

## Task 2: llm.ts — Core streaming changes [ ]

**File:** `src/session/llm.ts`

### 2a: `fullStream` → `stream` (lines 107, 130, 569)
```ts
// Line 130: type derivation
export type Event = Result["stream"] extends AsyncIterable<infer T> ? T : never
// Line 569: runtime
return Stream.fromAsyncIterable(result.stream, ...)
```

### 2b: `experimental_repairToolCall` → `repairToolCall` (line 456)
```ts
// v6: async experimental_repairToolCall(failed) {
// v7: async repairToolCall(failed) {
// Also: failed.system → failed.instructions
```

### 2c: `system` → `instructions` in streamText call (line 506-508)
```ts
// v6: { system: system.map((content) => ({ role: "system" as const, content })) }
// v7: { instructions: system } // v7 accepts string[] directly
```

### 2d: `specificationVersion` check (line 532)
Check if v7 uses "v3" or "v4" for wrapLanguageModel.

---

## Task 3: agent.ts — Object generation changes [ ]

**File:** `src/agent/agent.ts`

### 3a: `fullStream` → `stream` (line 479)
```ts
// v6: for await (const part of result.fullStream)
// v7: for await (const part of result.stream)
```

### 3b: Check `generateObject`/`streamObject` return types (lines 467-486)
The `system` param may need renaming to `instructions`.

---

## Task 4: session.ts — Usage mapping [ ]

**File:** `src/session/session.ts`

### 4a: Remove `cachedInputTokens` fallback (line 384)
```ts
// v6: input.usage.inputTokenDetails?.cacheReadTokens ?? input.usage.cachedInputTokens ?? 0
// v7: input.usage.inputTokenDetails?.cacheReadTokens ?? 0
```

### 4b: Remove `reasoningTokens` fallback (line 381)
```ts
// v6: input.usage.outputTokenDetails?.reasoningTokens ?? input.usage.reasoningTokens ?? 0
// v7: input.usage.outputTokenDetails?.reasoningTokens ?? 0
```

---

## Task 5: tools.ts + prompt.ts — asSchema removal [ ]

**File:** `src/session/tools.ts` (line 122), `src/session/prompt.ts` (line 13)

Check if `asSchema` is still exported in v7. If removed, replace with direct schema passing.

---

## Task 6: message-v2.ts — convertToModelMessages [ ]

**File:** `src/session/message-v2.ts` (line 1043)

Check if `convertToModelMessages` still exists in v7 or was renamed. Also check `UIMessage` type changes.

---

## Task 7: Provider files — usage fields [ ]

**Files:**
- `src/provider/sdk/copilot/responses/openai-responses-language-model.ts` (lines 810-811)
- `src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts` (line 357)

These are custom provider implementations that set `reasoningTokens`/`cachedInputTokens`. Check v7 types for these fields.

---

## Task 8: mcp/index.ts — dynamicTool [ ]

**File:** `src/mcp/index.ts` (line 128)

Check if `dynamicTool` still exists in v7 or was merged into `tool`.

---

## Task 9: Typecheck + fix [ ]

```bash
cd packages/opencode && bun typecheck
```

Fix all type errors iteratively.

---

## Task 10: Test [ ]

- Verify streamText tool calls work with mimo-v2.5-pro
- Verify explorer agent launches successfully
- Verify checkpoint save/load still works (uses ModelMessage type)
- Verify message-v2 conversion still works

---

## Verification

- `bun typecheck` clean
- Manual test: launch explorer agent with task tool
- Manual test: session with tool calls

## Files Modified (expected)

- `packages/opencode/package.json` (ai version bump)
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/agent/agent.ts`
- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/tools.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/mcp/index.ts`
- Possibly: `src/provider/sdk/copilot/**/*.ts`
