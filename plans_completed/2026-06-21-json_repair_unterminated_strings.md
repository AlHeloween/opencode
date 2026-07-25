# Plan: JSON Repair — Unterminated Strings + Better Error Feedback

**Date:** 2026-06-21
**Status:** Complete
**Scope:** `packages/opencode`
**Parent Issue:** Session `ses_1176e8bddffe9AgiRquTvdx6ws` — repeated "JSON Parse error: Unterminated string" on `task` tool calls

## Goal

1. **Fix 1**: Harden `repairJson()` to auto-close unterminated strings and missing closing brackets — converting an irrecoverable parse failure into a recoverable tool call with partial parameters.
2. **Fix 2**: When auto-repair still fails, provide the LLM with an **actionable hint** about what was wrong in its JSON output, so it can self-correct on retry.

## Problem Summary

The prior JSON repair implementation (`20260609_json_repair_tool_calls.md`) fixed excess brackets, trailing commas, and garbage suffixes. It explicitly excluded "missing closing brackets" as a repair boundary. However, runtime evidence shows the `deepseek-v4-pro` model frequently produces **unterminated strings** in long `task` tool call parameters (the `prompt` field ~1500+ chars). When a string is unterminated:

1. All 5 repair strategies fail → routing to `invalid` tool
2. Error message is just `"JSON Parse error: Unterminated string"` — no hint about what was wrong
3. Model retries with same malformed output → error loop → session abort

**Root cause chain:**
```
LLM emits: {"description":"test","prompt":"Read ALL plan files...
                                              ↑ no closing " or }
ai SDK parse → "JSON Parse error: Unterminated string"
repairJson() → all strategies fail → null
experimental_repairToolCall → routes to "invalid" tool
invalid tool output: "The arguments...are invalid: JSON Parse error: Unterminated string"
LLM sees error → tries again with same pattern → fails again → session aborted
```

## Architecture

### Fix 1: Close open structures in `repairJson()`

**New strategy inserted between Strategy 3 (balance brackets) and Strategy 4 (extract prefix):**

```
Strategy 3.5: closeOpenStructures(candidate)
  │
  ├─ Walk input with state machine (inString, escaped)
  ├─ At EOF: if inString ∧ ¬escaped → append closing "
  ├─ Re-parse with bracket stack to find unclosed { and [
  ├─ Append missing } and ] in correct nesting order
  └─ JSON.parse → return if success
```

**Why this position:** Strategy 1 (escape control chars) must run first because control characters inside strings would corrupt the state machine. Strategy 2-3 (commas+brackets) must also run because excess brackets interact with our bracket counting. Placing at 3.5 ensures we operate on the already-cleaned candidate.

### Fix 2: Actionable error diagnostics

**New exported function in `json-repair.ts`:**
```ts
diagnoseParseError(msg: string): string
```

**Wire into `experimental_repairToolCall()` fallback path in `llm.ts`:**
When routing to `invalid` tool, wrap the raw error with a diagnostic hint:
```
"JSON Parse error: Unterminated string

Hint: Your JSON tool call arguments have an open string that wasn't closed.
Every string value must end with a double-quote character (\"). 
If your prompt parameter is very long, try shortening it or ensuring 
the closing \" appears immediately after the text content."
```

## Components

| File | Action | Lines Changed |
|------|--------|---------------|
| `src/util/json-repair.ts` | MODIFY | +80 (new functions: `closeOpenStructures`, `diagnoseParseError`, state-machine helpers) |
| `src/session/llm.ts` | MODIFY | ~5 (call `diagnoseParseError` in fallback path) |
| `test/util/json-repair.test.ts` | MODIFY | +40 (new test cases for unterminated string repair + diagnostic function) |

No changes to `src/tool/invalid.ts` — the diagnostic is embedded in the `error` string, so the `invalid` tool's schema stays unchanged.

## Detailed Task Breakdown

---

### Task 1: Implement `closeOpenStructures()` in `json-repair.ts`

**Abstract definition:** Given a JSON string that may end with an unterminated string value and/or unclosed brackets, deterministically close all open syntactic structures by appending the missing closing characters in proper nesting order.

**Math formalization:**

Let state machine `M` process input `I` character-by-character, tracking:
- `inString ∈ {T, F}` — whether cursor is inside a JSON string
- `escaped ∈ {T, F}` — whether previous character was an unescaped `\`
- `bracketStack: ("{" | "[")[]` — LIFO stack of unclosed brackets

State transition function `δ(state, ch)`:
```
δ(s, ch) where s.escaped = T:
  → ⟨s.inString, F, s.bracketStack⟩   // consume escaped char, clear flag

δ(s, "\"):
  → ⟨s.inString, T, s.bracketStack⟩   // start escape

δ(s, '"') where ¬s.escaped:
  → ⟨¬s.inString, F, s.bracketStack⟩  // toggle string state

δ(s, ch) where s.inString:
  → ⟨T, F, s.bracketStack⟩            // stay in string

δ(s, '{'): → ⟨F, F, s.bracketStack + ["{"]⟩
δ(s, '['): → ⟨F, F, s.bracketStack + ["["]⟩
δ(s, '}'): → ⟨F, F, s.bracketStack.dropLastIf("{")⟩
δ(s, ']'): → ⟨F, F, s.bracketStack.dropLastIf("[")⟩
δ(s, _):   → same state
```

At EOF after processing all input:
```
closeString = if s.inString ∧ ¬s.escaped then '"' else ''
closeBrackets = reverse(s.bracketStack).map(b → b='{' ? '}' : ']').join('')
output = I + closeString + closeBrackets
```

**Structural diagram:**
```
Input:  {"a":"val","b":"hello
        ──────────────────
Step 1: state machine walk → inString=T, escaped=F, stack=[{]
Step 2: append closing "   → {"a":"val","b":"hello"
Step 3: append closing }   → {"a":"val","b":"hello"}
Step 4: tryParse → valid JSON ✓
```

**Input/Output parameters:**
```
Input:  string (malformed JSON with unterminated structures)
Output: string (closed JSON; may still not parse if damage is mid-structure)
```

**Brief implementation:**

```ts
function closeOpenStructures(input: string): string {
  let inString = false
  let escaped = false
  const bracketStack: ("{" | "[")[] = []

  for (const ch of input) {
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "{" || ch === "[") bracketStack.push(ch)
    else if (ch === "}") { if (bracketStack.at(-1) === "{") bracketStack.pop() }
    else if (ch === "]") { if (bracketStack.at(-1) === "[") bracketStack.pop() }
  }

  let result = input
  // Close unterminated string at EOF
  if (inString && !escaped) result += '"'

  // Close unclosed brackets in LIFO order
  while (bracketStack.length > 0) {
    result += bracketStack.pop()! === "{" ? "}" : "]"
  }

  return result
}
```

**Test cases:**
1. Unterminated string with unclosed brace: `{"a":"b","c":"hello` → `{"a":"b","c":"hello"}` (parseable)
2. Unterminated string in nested object: `{"outer":{"inner":"val` → `{"outer":{"inner":"val"}}` (parseable)
3. Already-valid JSON: `{"a":"b"}` → `{"a":"b"}` (unchanged, fast-path catches it)
4. Unterminated string then no unclosed brackets: `{"a":"b","c":"done` → `{"a":"b","c":"done"}` but `{` count = 1, `}` count = 1, stack empty → wait... `{` opens, `}` closes... stack should be empty. Result: `{"a":"b","c":"done"}` — needs 1 `}`. Actually re-checking: input `{"a":"b","c":"done` — opener `{` pushes, but `"b"` is a string so it skips. No `}` found. At EOF: inString=true, stack=[`{`]. Close string → `{"a":"b","c":"done"`. Close brackets → `{"a":"b","c":"done"}`. OK.
5. Unterminated string, escaped quote inside: `{"a":"b\"c` → `{"a":"b\"c"}`. State machine: `\` sets escaped, `"` after doesn't toggle inString because escaped=T.
6. Truncated number/array (edge case): `{"items":[1,` → no string open, stack=[`{`, `[`] → close brackets: `]]`? Wait — `{` pushes, `[` pushes. No closing brackets found. At EOF: inString=false, bracketStack=[`{`, `[`]. Pop: `[` → add `]`, Pop: `{` → add `}`. Result: `{"items":[1,]}` — still invalid (trailing comma before `]`). But Strategy 2 would have removed that comma first. This shows why ordering matters: Strategy 2 fixes commas, then Strategy 3.5 closes structures, then Strategy 4 tries again. If closeOpenStructures produces parseable JSON, great. If not, Strategy 4 tries prefix extraction.
7. Empty input: `""` → early return at strategy 0 check. Already handled.

---

### Task 2: Wire `closeOpenStructures()` into `repairJson()`

**Abstract definition:** Insert the new repair strategy into the `repairJson()` cascade at the right position so it runs after control-char escaping and bracket balancing but before prefix extraction.

**Where to insert (after Strategy 3, before Strategy 4):**

Current order:
```
Strategy 1: escapeStringControlChars
Strategy 2: remove trailing commas
Strategy 3: balanceBrackets (remove excess)
Strategy 4: extractValidPrefix
```

New order:
```
Strategy 1: escapeStringControlChars
Strategy 2: remove trailing commas  
Strategy 3: balanceBrackets (remove excess)
Strategy 3.5: closeOpenStructures (close unterminated strings + add missing brackets)  ← NEW
Strategy 4: extractValidPrefix
```

**Implementation:** Add ~12 lines between Strategy 3 and Strategy 4:

```ts
  // Strategy 3.5: close unterminated strings and missing brackets
  // When LLMs truncate long string values, the closing " and } are lost.
  // Detect open structures at EOF and append the needed closers.
  repaired = closeOpenStructures(repaired)
  if (tryParse(repaired)) {
    log.info("closed unterminated string/missing brackets in tool call JSON")
    return repaired
  }
```

**Note:** No change to the function signature. `closeOpenStructures` is a private helper. The `repairJson` function still returns `string | null`.

---

### Task 3: Implement `diagnoseParseError()` in `json-repair.ts`

**Abstract definition:** Given a raw JSON parse error message from the AI SDK, produce an augmented error string that includes a specific hint about what likely went wrong and how the LLM can fix it on retry.

**Math formalization:** Pattern match on error message substring:
```
diagnose(error) = 
  error + "\n\nHint: " + 
  match(error):
    "Unterminated string" →
      "Your JSON has an open string value that wasn't closed. Every string must end with a double-quote character (\"). If your prompt parameter text is very long, ensure you add the closing \" immediately after the final text character."
    "Unexpected token" | "Expected" →
      "Your JSON has a syntax error. Check for missing commas between fields, trailing commas (not allowed in JSON), or unquoted property names."
    "Unexpected end" →
      "Your JSON appears to be truncated. Ensure all objects are closed with } and all arrays with ]."
    _ →
      "Your JSON tool arguments are malformed. Double-check that all strings are quoted with \", objects closed with }, arrays closed with ], and there are no trailing commas."
```

**Input/Output parameters:**
```
Input:  string (raw parse error message, e.g. "JSON Parse error: Unterminated string")
Output: string (error message with appended hint block)
```

**Brief implementation:**

```ts
/** Produce an actionable error message from a raw JSON parse error. */
export function diagnoseParseError(rawError: string): string {
  const hint = pickHint(rawError)
  return `${rawError}\n\nHint: ${hint}`
}

function pickHint(msg: string): string {
  if (msg.includes("Unterminated string")) {
    return 'Your JSON has an open string value that wasn\'t closed. Every string must end with a double-quote character ("). If your prompt parameter text is very long, ensure you add the closing " immediately after the final text character.'
  }
  if (msg.includes("Unexpected token") || msg.includes("Expected")) {
    return "Your JSON has a syntax error. Check for missing commas between fields, trailing commas (not allowed in JSON), or unquoted property names."
  }
  if (msg.includes("Unexpected end")) {
    return "Your JSON appears to be truncated. Ensure all objects are closed with } and all arrays with ]."
  }
  return 'Your JSON tool arguments are malformed. Double-check that all strings are quoted with ", objects closed with }, arrays closed with ], and there are no trailing commas.'
}
```

**Test cases:**
1. "Unterminated string" → hint about closing strings
2. "Unexpected token" → hint about syntax errors
3. "Unexpected end of JSON input" → hint about truncation
4. Generic error → generic hint about JSON structure
5. Imported styles test: verify no crash on null/undefined/empty input (defensive)

---

### Task 4: Wire `diagnoseParseError()` into `experimental_repairToolCall`

**Abstract definition:** In the `experimental_repairToolCall` callback, when `repairJson()` returns `null` and we're about to route to the `invalid` tool, replace the raw error message with a diagnostic-enhanced message.

**Location:** `src/session/llm.ts`, lines 426-432 (the `return` block inside `experimental_repairToolCall`)

**Current code:**
```ts
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
```

**New code:**
```ts
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: diagnoseParseError(failed.error.message),
            }),
            toolName: "invalid",
          }
```

**Import addition at top of file:**
```ts
import { repairJson, diagnoseParseError } from "@/util/json-repair"
```

(Currently only imports `repairJson` — line 27 of llm.ts)

**Input/Output parameters:**
```
Input:  failed.error.message (string from ai SDK parse error)
Output: JSON.stringify({tool, error: "diagnostic-enhanced message"}) → "invalid" tool
Result: LLM sees: "The arguments provided to the tool are invalid: <raw error>\n\nHint: <actionable guidance>"
```

---

### Task 5: Add test cases to `json-repair.test.ts`

**New test cases for Fix 1 (closeOpenStructures via repairJson):**

| # | Test | Input | Expected |
|---|------|-------|----------|
| 11 | Unterminated string + missing brace | `{"desc":"test","prompt":"hello` | `{"desc":"test","prompt":"hello"}` |
| 12 | Unterminated string in nested object | `{"outer":{"inner":"val` | `{"outer":{"inner":"val"}}` |
| 13 | Unterminated string in array context | `[{"a":"b","c":"hello` | `[{"a":"b","c":"hello"}]` |
| 14 | Valid JSON passes through unchanged | Already tested as fast path (test 1) |
| 15 | Unterminated + missing brackets + literal newlines | `'{"prompt":"line1\nline2'` | `'{"prompt":"line1\\nline2"}'` (Strategy 1 fixes newlines first, then 3.5 closes) |

**New test cases for Fix 2 (diagnoseParseError):**

| # | Test | Input | Expected output contains |
|---|------|-------|--------------------------|
| 16 | Unterminated string diagnostic | `"JSON Parse error: Unterminated string"` | "Hint:" + "closing" + `\"` |
| 17 | Unexpected token diagnostic | `"JSON Parse error: Unexpected token"` | "Hint:" + "syntax error" |
| 18 | Truncation diagnostic | `"JSON Parse error: Unexpected end"` | "Hint:" + "truncated" |
| 19 | Generic fallback | `"some other error"` | "Hint:" + "malformed" |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `closeOpenStructures` adds wrong brackets to mid-structure damage | Low | Only appends — never removes. If wrong, Strategy 4 (extract prefix) still runs as fallback. |
| Diagnostic hint teaches wrong fix | Low | Hints are based on error message patterns; generic fallback always included. |
| `diagnoseParseError` changes error string → `invalid` tool output changes | None | Only the text changes — same tool, same schema. |
| LLM ignores hints and keeps looping | Low | Even without repair, the model now gets actionable guidance vs. raw parse error. |

## Verification

After implementation:
1. `bun test test/util/json-repair.test.ts` — all existing + new tests pass
2. `bun typecheck` — clean (0 errors)
3. Manual: verify that the exact unterminated string pattern from session `ses_1176e8bddffe9AgiRquTvdx6ws` now produces a repaired JSON
4. Manual: verify `diagnoseParseError` output includes "Hint:" block

## Artifacts

| File | Action | Purpose |
|------|--------|---------|
| `src/util/json-repair.ts` | MODIFY | Add `closeOpenStructures()` private helper, wire into `repairJson()`, add exported `diagnoseParseError()` |
| `src/session/llm.ts` | MODIFY | Import `diagnoseParseError`, use in `experimental_repairToolCall` fallback |
| `test/util/json-repair.test.ts` | MODIFY | Add 5+ test cases for unterminated string repair + 4 test cases for diagnostics |

## Dependencies

- `20260609_json_repair_tool_calls.md` — the original repair framework we extend (COMPLETED)
- No new npm dependencies needed

## Completion Checklist

- [x] Task 1: `closeOpenStructures()` implemented in `json-repair.ts`
- [x] Task 2: Wired into `repairJson()` cascade as Strategy 3.5
- [x] Task 3: `diagnoseParseError()` implemented and exported from `json-repair.ts`
- [x] Task 4: `diagnoseParseError()` called in `experimental_repairToolCall` fallback
- [x] Task 5: All new test cases pass
- [x] All existing tests still pass
- [x] TypeScript compilation clean

## Oracle Results

```
bun test v1.3.13
  27 pass / 0 fail / 77 expect() calls
bun typecheck — clean (0 errors)
```
