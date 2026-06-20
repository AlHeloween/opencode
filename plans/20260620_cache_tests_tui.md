# Plan: Cache Shape Tests + Cumulative Cache Display

**Created**: 2026-06-20
**Context**: Cache shape improvements (`normalizeToolSchemas`, `PrefixShape`, component blame) were implemented in `cache-control.ts` with only self-tests (console.log). The TUI cache display shows only the last packet's hit/miss, not session cumulative.

---

## Goal 1: Proper Tests for Cache Shape

**Abstract**: Replace console.log self-tests with Bun test framework tests. Cover normalization, prefix shape computation, component blame, backward compat, and tool schema conversion.

### Task 1.1: Test File

**File**: `packages/opencode/test/session/cache-control.test.ts` (new)

**Test cases**:

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | normalizeToolSchemas — order invariance | `[{name:"write"},{name:"read"}]` | sorted: `[read, write]` |
| 2 | normalizeToolSchemas — name tiebreak by desc | `[{name:"a",desc:"z"},{name:"a",desc:"a"}]` | `[{a,a},{a,z}]` |
| 3 | normalizeToolSchemas — name+desc tiebreak by params length | `[{name:"a",desc:"",params:"{\"x\":1}"},{name:"a",desc:"",params:"{}"}]` | shorter params first |
| 4 | normalizeToolSchemas — does not mutate input | pass array, check original order preserved |
| 5 | computePrefixShape — order invariance | same tools in different order | identical toolsMd5, toolsOrderHash, prefixMd5 |
| 6 | computePrefixShape — system change detected | different system prompt, same tools | different systemOnlyMd5, different prefixMd5 |
| 7 | requestFingerprint — backward compat (no toolSchemas) | omit 4th param | prefix is undefined, systemMd5/fullMd5 unchanged |
| 8 | requestFingerprint — with toolSchemas | provide tools | prefix is non-null with all fields |
| 9 | auditCache — component blame: system changed | two fingerprints, system differs, tools same | `"system prompt changed (non-tool)"` |
| 10 | auditCache — component blame: tool content changed | two fingerprints, tools differ | `"tool schemas changed (content or count)"` |
| 11 | auditCache — component blame: tool order only | same tools, different order, same system | `"tool order changed only"` |
| 12 | auditCache — falls through when no prefix | two fingerprints without prefix | existing behavior (message scan) |
| 13 | toolSchemasFromRecord — basic conversion | `{ read: { description: "...", parameters: {...} } }` | correct ToolSchema with name, description, JSON params |
| 14 | toolSchemasFromRecord — missing description | tool with no description | description defaults to `""` |

**Input**: `cache-control.ts` exports.
**Output**: 14 Bun test cases, all pass.

**Test**: `bun test test/session/cache-control.test.ts`

### Task 1.2: Remove Self-Tests

**File**: `cache-control.ts` — remove `if (import.meta.main) { ... }` block. Moves all test coverage to the proper test file.

---

## Goal 2: Cumulative Cache Hit/Miss in TUI

**Abstract**: The TUI sidebar (`context.tsx`) currently shows cache hit/miss for the last assistant message only. Add cumulative values across all messages in the session — total `cache.read` and `input` summed across every assistant message. Show both per-packet and session-total.

### Task 2.1: Compute Cumulative Values

**File**: `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx`

**Math**:
```
cumulativeCacheRead  = Σ msg.tokens.cache.read  ∀ msg where msg.role === "assistant" && msg.tokens.output > 0
cumulativeCacheInput = Σ msg.tokens.input         ∀ same messages
cumulativeCacheTotal = cumulativeCacheRead + cumulativeCacheInput
cumulativeCacheRate  = cumulativeCacheRead / cumulativeCacheTotal  (if total > 0)
```

**Implementation**: Add `reduce` in the `createMemo` that iterates all assistant messages. Already have `msg()` which returns all messages.

### Task 2.2: Display Both Values

**Current display** (line 117-118):
```
Cache: 75% hit (12K read · 4K miss)
```

**New display**:
```
Cache: 75% hit (12K read · 4K miss)  ·  session: 68% (45K read · 21K miss)
```

**Color rules**: Same as current — >80% success color, ≥40% warning color, <40% error color. Cumulative uses the same color logic.

**Files**:
| [ ] | File | Change |
|-----|------|--------|
| [ ] | `context.tsx` | Add cumulative state fields, compute from all messages, render both lines |

---

## Execution Order

1. Task 1.1 — Create test file (14 tests)
2. Task 1.2 — Remove self-tests from cache-control.ts
3. Task 2.1 — Add cumulative computation in context.tsx
4. Task 2.2 — Render both per-packet and cumulative in TUI
5. Run all tests + typecheck

---

## Oracle Verification

| Check | Command |
|-------|---------|
| New tests | `bun test test/session/cache-control.test.ts` — 14 pass |
| Existing tests | `bun test test/session/compaction.test.ts` — unchanged |
| Typecheck | `cd packages/opencode && bun typecheck` |
| Self-test removed | `bun run src/session/cache-control.ts` — no output (no `import.meta.main` block) |

---

## Files Summary

| File | Change | Lines |
|------|--------|-------|
| `test/session/cache-control.test.ts` | NEW — 14 tests | ~120 |
| `cache-control.ts` | Remove self-test block | -70 |
| `context.tsx` | Add cumulative cache stats | +15 |
