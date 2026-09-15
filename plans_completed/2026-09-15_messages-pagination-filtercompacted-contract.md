# Plan: messages-pagination filterCompacted — contract alignment

<!-- intention: 6 red filterCompacted tests (stale pre-82f88cf126 boundary contract) -> 46 pass / 0 fail with tests asserting the current flag-based contract -->

## Verdict (grounded)

**Tests are wrong, code is right.**

- Commit `82f88cf126` (2026-07-16, "soft-delete instead of hard-delete") deliberately
  replaced boundary-scan `filterCompacted` (compaction-part + summary-assistant
  detection, newest-first walk, `result.reverse()`) with an order-preserving
  flag filter (`info.compacted`). It updated `test/session/compaction.test.ts`
  but missed `test/session/messages-pagination.test.ts` → 6 reds since.
- Proof old contract breaks callers (task requirement):
  - `message-v2.ts:1526` feeds ASC-ordered rows into pure `filterCompacted`;
    old `result.reverse()` would emit newest-first to every
    `filterCompactedEffect` consumer.
  - `prompt.ts:1842-1844` `lastKnownId = msgs[msgs.length-1]` → oldest id →
    `messagesSince` (prompt.ts:1835) re-appends the whole session each loop
    step (duplicate context).
  - `prompt.ts:1101/1779/2381/2503/2654` build LLM messages from that array —
    reversed conversation.
  - Production writer `compaction.ts:1091-1117` no longer creates
    CompactionPart/summary-assistant boundaries; scenarios are unproducible.

## Changes (test file only, no src/)

File: `packages/opencode/test/session/messages-pagination.test.ts`

1. Add `markCompacted` helper — soft-hide via `info.compacted = true` +
   `svc.updateMessage` (exactly what compaction.ts does).
2. "returns all messages when no compaction" → expect `[...ids].reverse()`
   (stream is newest-first; filter preserves input order). Same toEqual strength.
3. "stops at compaction boundary..." → "excludes soft-hidden messages and
   preserves stream order": mark u1,a1 hidden → expect `[a2, u2]`.
4. "breaks at compaction boundary..." → "returns compaction marker + newer
   messages after a fold": hide window, add synthetic m* (=== COMPACTED ===),
   expect `[a3, u3, m*]`.
5. "retains an assistant tail..." → fold hides whole window incl. mid-turn
   second assistant; expect `[a4, u3, m*]`.
6. "prefers latest compaction boundary..." → repeated folds: two waves of
   flags + two markers; expect `[a4, u4, m2]`.
7. Consistency test: compare `filterCompacted(stream)` to
   `Array.from(stream)` (drop `.reverse()`) — order preservation, no compaction.

No assert weakening: all remain full-array `toEqual`. No skips. Passing
legacy-shaped tests (empty iterable, compaction part without summary, error
summary, no-finish summary) stay untouched — they pin current semantics
(non-flag markers alone never hide).

## Smoke Tests

- S1 (baseline, captured): `cd packages/opencode && bun test test/session/messages-pagination.test.ts` → 40 pass / 6 fail
- S2 (post): same command → 46 pass / 0 fail
- S3 (post): `cd packages/opencode && bun typecheck` → exit 0
- S4 (post): `cd packages/opencode && bun test test/session/` → no NEW failure names vs baseline (729 pass / 18 fail)
