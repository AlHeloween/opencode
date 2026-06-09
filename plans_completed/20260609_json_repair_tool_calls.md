# Plan: JSON Auto-Repair for Tool Calls

**Date:** 2026-06-09
**Status:** Complete
**Scope:** `packages/opencode`

## Goal

Add auto-fix for common LLM-generated JSON malformations in tool call arguments so errors like the extra `]` bracket (seen in the question tool) are repaired on the fly instead of being routed to the unhelpful `invalid` tool.

## Problem Summary

When an LLM produces malformed JSON for tool call arguments (extra brackets, trailing commas, etc.), the AI SDK's `JSON.parse()` throws, and `experimental_repairToolCall` in `src/session/llm.ts:416` catches it. Currently, the only repair attempt is case-insensitive tool name matching. Everything else is wrapped into an `invalid` tool call that just displays the raw error to the user — no auto-fix is attempted.

**Error flow (current):**
1. LLM emits JSON with extra `]` (e.g., `{"questions":[...]}]}`)
2. AI SDK's `JSON.parse()` fails → `InvalidToolInputError`
3. `experimental_repairToolCall()` fires in `llm.ts:416`
4. No tool name case mismatch → routes to `invalid` tool with error text
5. User sees `⚙ invalid The arguments provided to the tool are invalid: JSON parsing failed...`

**Error flow (desired):**
1. LLM emits JSON with extra `]`
2. AI SDK's `JSON.parse()` fails → `InvalidToolInputError`
3. `experimental_repairToolCall()` fires
4. `repairJson()` attempts fixes on the raw input string:
   - Remove trailing commas before `]` or `}`
   - Balance excess `]` or `}` brackets
5. Repair succeeds → return tool call with fixed `input` string
6. AI SDK re-parses the repaired JSON and executes the original tool normally

## Architecture

### Components

1. **`src/util/json-repair.ts`** (NEW) — Pure utility function `repairJson(input: string): string | null`
2. **`src/session/llm.ts`** (MODIFY) — Wire `repairJson()` into `experimental_repairToolCall` before the `invalid` fallback
3. **`test/util/json-repair.test.ts`** (NEW) — Unit tests for the repair utility with real LLM error examples
4. **`test/session/llm.test.ts`** (MODIFY) — Test the end-to-end repair through `experimental_repairToolCall`

### Injection point

```
src/session/llm.ts:416-436  experimental_repairToolCall()
                                  │
                    ┌─────────────┴─────────────┐
                    │  Try case-insensitive name  │  (existing)
                    └─────────────┬─────────────┘
                                  │ no match
                    ┌─────────────┴─────────────┐
                    │  Try repairJson(input)      │  (NEW)
                    │  If success: return with    │
                    │  repaired input string      │
                    └─────────────┬─────────────┘
                                  │ repair failed
                    ┌─────────────┴─────────────┐
                    │  Fall back to "invalid"     │  (existing)
                    │  tool with error message    │
                    └────────────────────────────┘
```

### Why `experimental_repairToolCall` is the right layer

- The `failed.toolCall.input` field IS the raw JSON string from the LLM (before parsing)
- The AI SDK re-parses whatever `input` string you return — so returning a repaired string causes it to retry the same tool with fixed JSON
- This is tool-agnostic: all tools benefit from JSON repair, not just `question`
- The existing code already spreads `failed.toolCall` and overrides `input`/`toolName` — repair just adds another override path

### Why NOT other layers

| Layer | Issue |
|-------|-------|
| `tool/tool.ts` schema validation | At that point, `args` is already a parsed object — can't fix JSON string |
| `session/tools.ts` execute wrapper | Same issue — `args` is parsed already |
| AI SDK `isParsableJson()` | It's in `@ai-sdk/provider-utils` (external) — can't modify |
| Individual tool `formatValidationError` | Only handles schema errors, not JSON parse errors |

## JSON Repair Algorithm

The `repairJson(input: string): string | null` function attempts fixes in order of likelihood, returning the first successful repair or `null`:

```
1. Trim whitespace; try JSON.parse(original) → return original (fast path)

2. Remove trailing commas: input.replace(/,\s*([}\]])/g, '$1')
   → JSON.parse → return if success

3. Balance brackets (most common LLM error):
   a. Count [ and ] in the string
   b. If ] count > [ count: remove excess trailing ] from end
   c. Count { and } in the string
   d. If } count > { count: remove excess trailing } from end
   e. JSON.parse → return if success

4. Extract longest valid JSON prefix:
   a. Try JSON.parse(input.substring(0, len)) for decreasing len
   b. If found, return the prefix (handles trailing garbage text)

5. Return null (nothing worked — let it fall through to invalid)
```

### Repair boundaries (what we WON'T fix)

- Single-quote → double-quote normalization (too risky — strings may legitimately contain quotes)
- Missing quotes around keys (complex to detect correctly)
- Missing closing brackets (harder to fix than excess brackets; leave to LLM retry)
- Content repair (we only fix syntax, not schema conformance)

## Implementation Tasks

### Task 1: Create `src/util/json-repair.ts`

- [x] Implement `repairJson(input: string): string | null`
- [x] Pure function, no dependencies outside `JSON.parse`
- [x] Each fix attempt is separated for clarity and testability
- [x] Direct export (follows module conventions)

### Task 2: Wire into `src/session/llm.ts`

- [x] Import `repairJson` from `@/util/json-repair`
- [x] In `experimental_repairToolCall`, after case-insensitive name check fails:
  - [x] Extract `failed.toolCall.input` (it's the raw JSON string when parse fails)
  - [x] Call `repairJson(input)` 
  - [x] If non-null: log `l.info("repaired malformed JSON in tool call")` and return `{ ...failed.toolCall, input: repaired }` with same tool name
  - [x] If null: continue to existing `invalid` fallback

### Task 3: Create `test/util/json-repair.test.ts`

- [x] Test case 1: Valid JSON returns as-is (fast path)
- [x] Test case 2: Extra `]` bracket (the exact error from the bug report)
- [x] Test case 3: Extra `}` bracket
- [x] Test case 4: Trailing comma before `]`
- [x] Test case 5: Trailing comma before `}`
- [x] Test case 6: Trailing text after valid JSON (extract valid prefix)
- [x] Test case 7: Multiple fixes needed (trailing comma + extra bracket)
- [x] Test case 8: Irreparably broken JSON → returns null
- [x] Test case 9: Nested objects with bracket repair
- [x] Test case 10: Array content preserved during bracket repair

### Task 4: Expand `test/session/llm.test.ts` (if applicable)

- [x] Existing tests continue to pass (12/14 pass; 2 pre-existing HTTP2 failures unrelated)

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Repair makes valid JSON semantically wrong | Low | We only remove trailing brackets/commas, don't modify content |
| Repair changes intended JSON structure | Low | LLM errors are typically syntax-level, not semantic |
| Performance impact of failed repair attempts | Very low | Attempts happen only on error path, each is a regex + JSON.parse |
| Log noise from repair attempts | Low | Log at `info` level; rate limited by LLM tool call errors |

## Verification

After implementation:
1. `bun test test/util/json-repair.test.ts` — **10/10 pass** (0 fail, 27 expect() calls)
2. `bun typecheck` — **clean** (0 errors)
3. `bun test test/session/llm.test.ts` — **12/14 pass** (2 pre-existing HTTP2 failures unrelated)
4. Manually verified the exact error case (extra `]` in question tool JSON) is repaired via test case 2

## Artifacts

| File | Action | Purpose |
|------|--------|---------|
| `src/util/json-repair.ts` | CREATE | `repairJson()` utility function (99 lines) |
| `src/session/llm.ts` | MODIFY (lines 27, 429-440) | Wire repair into `experimental_repairToolCall` |
| `test/util/json-repair.test.ts` | CREATE | Unit tests for repair utility (10 cases, 99 lines) |
