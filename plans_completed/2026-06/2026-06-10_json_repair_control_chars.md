# Plan: JSON Repair — Escape Control Characters in String Values

**Date:** 2026-06-10
**Status:** Complete
**Scope:** `packages/opencode/src/util/json-repair.ts`, `test/util/json-repair.test.ts`
**Blocks on:** None
**Predecessor:** `plans_completed/20260609_json_repair_tool_calls.md`

## Goal

Extend `repairJson()` to handle unescaped control characters (literal newlines, tabs, carriage returns) inside JSON string values — a common LLM error when generating tool calls with multi-line `prompt` or `description` parameters (e.g., `task`, `explore` agents).

## Problem

When an LLM emits a tool call like:

```json
{"description":"analyze bugs","prompt":"Research task.\n\n1. Find all callers.\n2. Check tests.","subagent_type":"explore"}
```

The `\n` sequences are already escaped — this is valid JSON. But sometimes the LLM emits **literal** newline bytes (0x0A) inside the string:

```json
{"description":"analyze bugs","prompt":"Research task.
                                    ^ literal LF here — INVALID JSON
1. Find all callers.
2. Check tests.","subagent_type":"explore"}
```

`JSON.parse()` throws `SyntaxError: Unexpected token` because control characters are forbidden in JSON strings unless escaped.

### Current state of `repairJson()`

```
Strategy 0: Fast path (tryParse)           ✓
Strategy 1: Remove trailing commas         ✓
Strategy 2: Balance excess brackets        ✓
Strategy 3: Extract valid prefix           ✓
Strategy 4: Combined (commas + brackets)   ✓
Strategy ?: Escape control chars in strings  ✗ MISSING
```

## Solution

Add a new strategy: **escape unescaped control characters inside JSON string values**. Insert it AFTER the fast path but BEFORE structural fixes, since:
- It's always safe (control chars in JSON strings are always a bug)
- It's independent of structural fixes (doesn't change bracket/brace counts)
- Escaping once enables all subsequent structural strategies

### Algorithm: `escapeStringControlChars(input: string): string`

State machine that walks through the input character by character:

```
State variables:
  inString: boolean = false
  escaped: boolean = false     // previous char was \ and not itself escaped

For each character ch:
  if escaped:
    output ch, escaped = false  // existing escape seq (\n, \t, \\, etc.) — preserve
  else if ch == '\':
    output ch, escaped = true   // start of escape sequence
  else if ch == '"':
    inString = !inString        // toggle string state
    output ch
  else if inString:
    if ch == '\n': output '\\n'
    elif ch == '\r': output '\\r'
    elif ch == '\t': output '\\t'
    elif ch < 0x20: output '\\u' + hex(ch)  // other control chars
    else: output ch
  else:
    output ch                   // outside strings: pass through (structural)
```

### Updated strategy order

```
Strategy 0: Fast path (tryParse(input))                   — valid JSON → return
Strategy 1: Escape control chars in strings               ← NEW
            escaped = escapeStringControlChars(input)
            if escaped !== input && tryParse(escaped):
              return escaped
            repaired = escaped  // use for remaining strategies
Strategy 2: Remove trailing commas on repaired
Strategy 3: Balance brackets on repaired
Strategy 4: Extract valid prefix on repaired
Strategy 5: Combined (commas + brackets) on repaired
return null
```

## Implementation Tasks

### Task 1: Add `escapeStringControlChars()` to `json-repair.ts`

- [x] Implement `escapeStringControlChars(input: string): string`
- [x] State machine tracking `inString` and `escaped` flags
- [x] Handle `\n`, `\r`, `\t`, and other control chars (0x00-0x1F)
- [x] Insert as Strategy 1 (after fast path, before structural fixes)
- [x] Apply all subsequent strategies on the escaped version

### Task 2: Update tests in `json-repair.test.ts`

- [x] Test: literal newline inside string → escaped and parsed
- [x] Test: literal tab inside string → escaped and parsed
- [x] Test: literal newline + trailing comma → both fixed
- [x] Test: literal newline + extra bracket → both fixed
- [x] Test: already-escaped `\n` passes through unchanged
- [x] Test: multi-line prompt (task tool scenario)
- [x] Test: control chars outside strings → null (not valid JSON)

### Task 3: Verify

- [x] `bun test test/util/json-repair.test.ts` — **17/17 pass** (48 expect() calls)
- [x] `bun typecheck` — **clean**
- [x] `bun test test/session/llm.test.ts` — 10/14 pass (4 pre-existing failures unrelated)

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| State machine misidentifies string boundaries | Low | Test with valid JSON (no false positives), test with nested quotes |
| Escaping structural chars (outside strings) | Very low | State machine only escapes inside strings; LLMs emit compact JSON |
| Double-escaping already-escaped sequences | None | `escaped` flag in state machine prevents this |
| Performance of char-by-char walk | Very low | Only runs on error path; input is a single tool call (< 10KB typically) |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `src/util/json-repair.ts` | MODIFY | +35 (new function), ~5 restructure |
| `test/util/json-repair.test.ts` | MODIFY | +40 (5-7 new test cases) |
