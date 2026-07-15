# Plan: BlockAnchorReplacer Single-Candidate Guard

**Date:** 2026-07-15
**Scope:** `packages/opencode/src/tool/edit.ts` + tests
**Bug:** BlockAnchorReplacer falsely matches a small search block against a much larger content block when anchor lines coincidentally appear far apart.

## Root Cause

`BlockAnchorReplacer`'s single-candidate path (line 450) accepts any match when `similarity >= 0.0` (`SINGLE_CANDIDATE_SIMILARITY_THRESHOLD`). Combined with empty middle lines skipping similarity computation via `continue`, a 3-line search whose anchors match 15 lines apart is unconditionally accepted — and the "match" spans content that should not be replaced.

## Fix

**File:** `packages/opencode/src/tool/edit.ts`

### Fix 1: Block-size proportionality guard (line 451-452)

Reject a single candidate if the actual block is wildly larger than the search block:

```ts
// After line 452: const actualBlockSize = endLine - startLine + 1
// ADD:
const BLOCK_SIZE_RATIO_MAX = 3
if (actualBlockSize > searchBlockSize * BLOCK_SIZE_RATIO_MAX) {
  return  // skip this candidate — anchors span too far
}
```

This catches the pathological case while preserving legitimate uses where anchors are a few lines off.

### Fix 2: Empty-line similarity contribution (lines 462-464)

When both search and content middle lines are empty, treat as a perfect match rather than skipping:

```ts
// REPLACE:
if (maxLen === 0) {
  continue
}
// WITH:
if (maxLen === 0) {
  similarity += 1.0 / linesToCheck  // both empty = perfect match
  continue
}
```

This ensures empty lines in the search pattern contribute positively rather than being invisible.

### Fix 3: Apply same guard to multiple-candidate path (lines 498-527)

The same block-size proportionality check should apply in the multiple-candidate scoring loop to avoid penalizing well-matched small blocks in favor of large mismatched spans.

## Test Cases

**File:** `packages/opencode/test/tool/edit.test.ts`

Add to `describe("fuzzy matching")`:

1. **BlockAnchor rejects oversized single candidate** — search pattern with 3 lines whose anchors match a block 10+ lines apart in content. Should fall through to later replacers instead of falsely matching.

2. **BlockAnchor accepts proportional candidate** — search pattern whose anchors span a block close to the search block size. Should match correctly.

3. **multiedit sequential application** — test that multiedit applies edits sequentially where edit N+1's oldString matches content that exists only after edit N is applied.

## What NOT to Change

- `SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0` — raising this would break legitimate uses where anchors alone uniquely identify a block. The block-size ratio guard is the targeted fix.
- Other replacers — only BlockAnchorReplacer is affected.

## Verification

1. Run existing edit tests: `cd packages/opencode && bun test test/tool/edit.test.ts`
2. Run new tests
3. Manually verify the AGENTS.md multiedit scenario: simulate the 4-edit multiedit against a copy of AGENTS.md and confirm no sections are deleted
