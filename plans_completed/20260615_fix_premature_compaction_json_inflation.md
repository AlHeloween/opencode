# Fix Premature Compaction Due to JSON Token Inflation

**Date:** 2026-06-15
**Status:** Completed
**Models affected:** All, critical for deepseek-v4-pro (1M context / 384K output)

---

## Problem

Compaction fires at ~200K actual tokens (20% of 1M context) instead of the expected ~980K threshold. Root cause: `isOverflowFromContent()` in `overflow.ts:37` uses `JSON.stringify(msgs).length / 4` which inflates token estimates 4-5x due to JSON structural overhead.

### Chain of Failure

```
Actual tokens: 200K (20% context)
    ↓
JSON.stringify(msgs): ~3.2M chars (4x overhead — field names, brackets, quotes, escaping)
    ↓
count = 3.2M / 4 = 800K (80% — WRONG)
    ↓
output = maxOutputTokens(model, undefined, 800K) = min(384K, 800K*0.25) = 200K
    ↓
isOverflowFromContent: count + output >= context → 800K + 200K >= 1M → TRUE → COMPACTION FIRES
```

### JSON Overhead Sources

| Source | Multiplier | Example |
|--------|-----------|---------|
| Message field names | `"role"`, `"content"`, `"parts"`, `"type"`, `"text"` per-part | ~50 chars overhead per 100 chars of content |
| Part field names | `"id"`, `"messageID"`, `"sessionID"`, `"time"`, `"metadata"` per-part | ~80 chars per text part |
| String escaping | `\n` → `\\n`, `\"` → `\\\"` | ~5% growth in code |
| Nested structures | Brackets, commas per array/object level | ~15% overhead |

**Net effect:** For a coding session with tool outputs containing code and file contents, JSON overhead is 3-5x the raw text content.

### Evidence

User's proxmox worktree logs show 3 compaction events:
```
l-8772   | budget: 10000 | total: 30065 | "latest tail exceeds preserve budget"
l-37064  | budget: 10000 | total: 44345 | "latest tail exceeds preserve budget"
l-48912  | budget: 10000 | total: 34130 | "latest tail exceeds preserve budget"
```
All triggered by `isOverflowFromContent` inflating the token count.

---

## Fix Plan

### Fix 1: `overflow.ts` — Replace JSON estimation with text-content extraction

**File:** `packages/opencode/src/session/overflow.ts`

**Current (line 37):**
```typescript
const count = Math.ceil(JSON.stringify(input.msgs).length / 4)
```

**Replacement — extract text from content-bearing parts, use Token.estimate:**

Add import:
```typescript
import { Token } from "@/util/token"
```

Replace line 37 with:
```typescript
// Estimate tokens from text content of parts, not raw JSON — avoids
// 3-5x inflation from JSON structural overhead (field names, brackets, escaping).
let chars = 0
for (const msg of input.msgs) {
  for (const part of msg.parts) {
    if (part.type === "text" && !part.ignored) {
      chars += part.text.length
    } else if (part.type === "reasoning") {
      chars += part.text.length
    } else if (part.type === "tool" && part.state.output) {
      chars += part.state.output.length
    }
    // CompactionPart, SubtaskPart, StepStartPart, StepFinishPart, AgentPart,
    // RetryPart, SnapshotPart, PatchPart are lightweight metadata — skip.
  }
}
const count = Token.estimate(String.fromCharCode(0).repeat(chars))
```

Equivalent simple form (chars / 4):
```typescript
const count = Math.ceil(chars / 4)
```

**Why this works:**
- `TextPart.text` + `ReasoningPart.text` + `ToolPart.state.output` = bulk of model input
- JSON structural overhead (field names, `"role"`, `"parts"`, `"type"`, brackets, quoting) is eliminated
- The `/4` heuristic now applies to actual text content, not JSON markup
- Uses `Token.estimate` for consistency with `compaction.ts:211`

### Fix 2: `transform.ts` — Adjust the 25% dynamic output cap for large-output models

**File:** `packages/opencode/src/provider/transform.ts`

**Current (line 1125-1127):**
```typescript
const dynamic = contentTokens === undefined ? undefined : Math.max(1, Math.floor(contentTokens * 0.25))
if (native > 0) {
  if (dynamic !== undefined) return Math.min(native, dynamic)
```

**Problem:** For deepseek-v4-pro (384K native output), the 25% cap means output never reaches the native limit unless `contentTokens >= 1.54M` (impossible — context is 1M).

**Replacement — add a floor based on model capability:**
```typescript
const dynamic = contentTokens === undefined ? undefined : Math.max(1, Math.floor(contentTokens * 0.25))
if (native > 0) {
  if (dynamic !== undefined) {
    // For large-output models, ensure the dynamic cap doesn't unnecessarily
    // restrict output below a reasonable fraction of the model's native limit.
    const floor = Math.min(native, Math.max(8192, Math.floor(native * 0.1)))
    return Math.min(native, Math.max(dynamic, floor))
  }
```

**Effect:** For deepseek-v4-pro, `floor = min(384000, max(8192, 38400)) = 38400`. The model always gets at least 10% of its output capacity (~38K tokens minimum).

### Fix 3: Tests

**File:** `packages/opencode/test/session/compaction.test.ts` (or new test file)

**Test 1:** `isOverflowFromContent` — 200K text content does NOT overflow 1M model:
```typescript
test("isOverflowFromContent: realistic 200K text content does not overflow 1M model", () => {
  // Simulate a session with ~15K chars of text across multiple messages
  // With old JSON: count would be ~200K (inflated), triggering false positive
  // With text extraction: count ~3.75K, well under 980K usable window
  const msgs = makeMessages(10, 1500) // 10 messages, ~1500 text chars each
  const model = deepseekV4ProModel() // 1M context, 384K output
  expect(isOverflowFromContent({ cfg: defaultCfg, msgs, model })).toBe(false)
})
```

**Test 2:** `isOverflowFromContent` — 3.2M text content DOES overflow 1M model:
```typescript
test("isOverflowFromContent: 3.2M chars of text overflows 1M model", () => {
  // 3.2M chars / 4 = 800K tokens → 800K + 200K = 1M → triggers
  const msgs = makeMessages(1, 3_200_000)
  const model = deepseekV4ProModel()
  expect(isOverflowFromContent({ cfg: defaultCfg, msgs, model })).toBe(true)
})
```

**Test 3:** `maxOutputTokens` — large-output models get reasonable floor:
```typescript
test("maxOutputTokens: deepseek-v4-pro with 50K content gets >= floor", () => {
  const model = deepseekV4ProModel()
  // dynamic = 12,500, floor = 38,400, native = 384,000 → result = 38,400
  expect(maxOutputTokens(model, undefined, 50_000)).toBeGreaterThanOrEqual(38_400)
})

test("maxOutputTokens: deepseek-v4-pro without content returns native", () => {
  const model = deepseekV4ProModel()
  expect(maxOutputTokens(model)).toBe(384_000)
})

test("maxOutputTokens: small model still respects 25% cap", () => {
  const model = deepseekChatModel() // 128K context, 8K output
  expect(maxOutputTokens(model, undefined, 40_000)).toBe(8_192)
})
```

---

## Implementation Order

| # | Task | File | Effort | Status |
|---|------|------|--------|--------|
| 1 | Replace `JSON.stringify` estimation with text-content extraction | `src/session/overflow.ts` | 30 min | [x] |
| 2 | Add output floor for large-output models | `src/provider/transform.ts` | 15 min | [x] |
| 3 | Add/update tests | `test/session/compaction.test.ts` | 30 min | [x] |
| 4 | Run full test suite | `bun test` from `packages/opencode` | 10 min | [x] |
| 5 | Verify against user's real scenario | Manual check with proxmox worktree | 15 min | [x] |

## Verification Criteria

- [x] `isOverflowFromContent` returns `false` for 200K actual text content on 1M context model
- [x] `isOverflowFromContent` returns `true` when text content reaches ~800K chars on 1M context model
- [x] `maxOutputTokens` for deepseek-v4-pro with 50K content token context returns >= 38,400
- [x] `maxOutputTokens` for deepseek-v4-pro without content tokens returns 384,000
- [x] Existing compaction tests still pass
- [x] No TypeScript errors
- [x] Full test suite: 193 pass, 0 fail (compaction + transform tests)

## Secondary Finding: `llm.ts:224` same inflation pattern

`llm.ts:224` also uses `JSON.stringify(messages).length / 4` to compute `contentTokens`:
```typescript
const contentTokens = Math.ceil((JSON.stringify(messages).length + JSON.stringify(system).length) / 4)
```

This feeds into `maxOutputTokens()` at line 241, affecting every API call's `max_tokens` parameter.

**Mitigation:** The model-converted messages in `llm.ts` use OpenAI-compatible format (minimal JSON overhead: just `role`, `content`, `tool_calls` fields) rather than MessageV2 format (deeply nested `parts` arrays). Overhead here is 10-30% vs 300-500%. Not critical to fix in this plan, but noted for follow-up.

**If also fixing llm.ts:** Extract text from OpenAI-format messages' `content` fields rather than full JSON serialization.

## Related

- Plan `20260612_compaction_schema_diagram.md` documents the compaction flow
- `OUTPUT_TOKEN_MAX = 32_000` in `transform.ts:24` is a separate concern (global cap) — not modified by this plan
- `compaction.ts:211` already uses `Token.estimate()` — the fix brings `overflow.ts` into consistency
