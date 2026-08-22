# Compact m*: remove prior m* content + 32K summary cap

**Goal:** Stop pulling prior m* decisions into new m*; make prior m* a hard boundary in Recent tail; cap summaries at 32K tokens.

**Scope:** `packages/opencode/src/session/compaction.ts` + tests

## Smoke Tests

### Baseline

```bash
# From packages/opencode:
bun test test/session/summary-cadence.test.ts
```

### Post-implementation

```bash
bun test test/session/summary-cadence.test.ts
bun test test/session/   # all session tests pass
```

## Tasks

### T1: Remove priorDecisions from compact() + buildMessageStar()

**What:** Stop extracting decisions from prior m* and passing them into buildMessageStar.

**Files:** `packages/opencode/src/session/compaction.ts`

- In `compact()` (~line 958-961): remove `extractDecisions(messageText(priorMsgStar))` and the `priorDecisions` variable
- In `buildMessageStar()` signature (line 623): remove `priorDecisions?: string[]` parameter
- In `buildMessageStar()` body (line 676): `allDecisions` = only `currentDecisions`, no spread of `priorDecisions`

**Note:** `buildMessageStar` is module-private (not exported). Unit test via `compact()` integration only — no export change needed. Verify by reading the m* output text and checking decisionsBlock lacks prior m* decisions.

**Test:** Integration test: call compact with visible messages containing a prior m* with decisions + current summaries with different decisions — verify m* decisionsBlock contains only current decisions.

### T2: prior m* = hard stop in selectRecentTail()

**What:** When walking back to extend thin tail, prior m* is a hard boundary — do NOT include it in recent.

**Files:** `packages/opencode/src/session/compaction.ts`

- In `selectRecentTail()` (~line 293-308): remove `selected.unshift(m)` on line 298. When `isMessageStar(m)` is true, just `break` without including it.
- Update JSDoc comment (~line 250-253) to reflect new behavior: prior m* is excluded, not included.

**Test:** Add unit test: `selectRecentTail` with thin tail + prior m* — verify m* is NOT in result.

### T3: Summaries 32K token cap

**What:** Limit total summary body text in m* to 32K tokens. Take most recent summaries first.

**Files:** `packages/opencode/src/session/compaction.ts`

- In `compact()` (~line 861-915): after collecting `summaries[]`, trim from the **oldest** end until total body text ≤ 32K tokens.
- Add constant: `export const MAX_SUMMARY_BODY_TOKENS = 32_768` (same value as RECENT_MIN_TOKENS but semantically distinct).
- Note: summaries array elements have `.text` field (not `.body`) — see line 861 type.

**Logic:** (use `.text.length` directly, not `contentChars` which expects `MessageV2.WithParts[]`):
```
const maxChars = MAX_SUMMARY_BODY_TOKENS * CHARS_PER_TOKEN  // 131,072
let totalChars = summaries.reduce((sum, s) => sum + s.text.length, 0)
while (totalChars > maxChars && summaries.length > 1) {
  const removed = summaries.shift()!
  totalChars -= removed.text.length
}
```

**Invariant comment update:** Line ~948-953 ("Representation invariant: every hidden message is represented — either by a collected summary or by the Recent walk-back") needs rewording after T2. Prior m* is now hidden but NOT covered by a summary and NOT in Recent. Correct it to: "every hidden message except prior m* is represented — prior m* is session-read-only (DB-retained)".

**Test:** Add unit test: compact with many summaries — verify only recent ≤32K included.

### T4: Update tests

**What:** Ensure existing tests pass + new tests for T1-T3.

**Files:** `packages/opencode/test/session/summary-cadence.test.ts`

- Verify existing cadence tests still pass
- Add tests for selectRecentTail with prior m*
- Add tests for summary cap behavior

## Prior Art

- `docs/compaction.md` — canonical contract
- `docs/session-memory-graph.md` — flow diagrams
- `packages/opencode/src/session/compaction.ts:255-309` — selectRecentTail current behavior
- `packages/opencode/src/session/compaction.ts:606-731` — buildMessageStar current structure

## Acceptance Criteria

- [ ] `priorDecisions` parameter removed from buildMessageStar
- [ ] decisionsBlock contains only current summary decisions
- [ ] selectRecentTail excludes prior m* from recent tail
- [ ] summaries capped at 32K tokens in compact()
- [ ] All existing session tests pass
- [ ] New tests cover all three changes
