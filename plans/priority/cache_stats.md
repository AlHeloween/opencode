---
status: planned
owner: codex
created: 2026-06-25
priority: HIGH
reproduce:
  - cd packages/opencode && bun typecheck
  - bun test test/session/cache-stats.test.ts
---

# Cache Stats — Per-Message Incremental Tracking Plan

## Goal

Replace ephemeral per-request `CacheAuditEntry` with persistent incremental per-message hit/miss tracking in the database. Each turn writes a row with cumulative stats keyed by `sessionID:modelID` (same scope as checkpoints). Recent message cache status is detected by diffing the last two fingerprint records: unchanged messageID.md5 between T and T-1 = hit.

## Abstract Definition

The current `auditCache()` function in `cache-control.ts` computes a per-request `CacheAuditEntry` comparing prev vs next request. It identifies which message diverged and estimates hit ratio — but the result is ephemeral, logged, then discarded. This plan adds persistent accumulation so cache performance can be queried across session lifetime.

## Formalization

```
Let S = (sessionID, modelID) be the scope key (same as checkpoint scoping)
Let Fₜ = requestFingerprint at turn t
  Fₜ = { messages: [{ messageId, md5, role, partCount }], fullMd5, systemMd5 }
Let Rₜ = cache stats row at turn t
  Rₜ = { turn, timestamp, perMessage: Map<messageId, MessageStats>, summary: SessionSummary }

MessageStats = {
  messageId: string
  role: string
  partCount: number
  hitCount: number      // times this message matched the previous turn
  missCount: number     // times this message diverged from previous turn
  lastMd5: string       // most recent md5
  firstSeen: number     // turn number when first observed
  lastSeen: number      // turn number when last observed
}

SessionSummary = {
  totalTurns: number
  totalMessages: number
  commonMessages: number  // count of messages unchanged this turn vs previous
  estimatedHitRatio: number  // commonMessages / totalMessages
  cacheStable: boolean   // fullMd5 == prev.fullMd5
}

Accumulation function:
  accumulate(Rₜ₋₁, Fₜ₋₁, Fₜ) → Rₜ:
    for each messageId in Fₜ.messages:
      if messageId in Rₜ₋₁.perMessage:
        prev = Rₜ₋₁.perMessage[messageId]
        if Fₜ[m].md5 == Fₜ₋₁[m].md5:  // unchanged
          prev.hitCount += 1
        else:
          prev.missCount += 1
        prev.lastMd5 = Fₜ[m].md5
        prev.lastSeen = t
      else:  // new message
        Rₜ.perMessage[messageId] = {
          hitCount: 0, missCount: 0,
          lastMd5: Fₜ[m].md5,
          firstSeen: t, lastSeen: t
        }

    Rₜ.summary = computeSummary(Rₜ, Fₜ, Fₜ₋₁)
```

## Structural Diagram

```
Turn N completes (prompt.ts:1626):
  auditCache(prevFP, currentFP) → CacheAuditEntry (ephemeral)
  │
  ├── [NEW] CacheStats.accumulate(sessionID, modelID, prevFP, currentFP, audit)
  │     ├── load Rₙ₋₁ from cache_stats table
  │     ├── compute per-message { hitCount++, missCount++ }
  │     ├── compute summary { estimatedHitRatio, cacheStable }
  │     └── INSERT INTO cache_stats VALUES (sessionID, modelID, turn, data)
  │
  └── storePrevFingerprint(sessionID, modelID, currentFP)  // existing

Turn N+1 query:
  CacheStats.recentDiff(sessionID, modelID)
    → SELECT data FROM cache_stats WHERE session_id = ? AND model_id = ?
      ORDER BY turn DESC LIMIT 2
    → Rₙ, Rₙ₋₁
    → diff: which messageIDs changed between Rₙ₋₁ and Rₙ?
    → return { changed: Set<messageID>, new: Set<messageID>, removed: Set<messageID> }

Session query:
  CacheStats.worstOffenders(sessionID, limit=10)
    → SELECT message_id, missCount FROM cache_stats
      WHERE session_id = ? ORDER BY missCount DESC LIMIT 10
    → returns messages with highest cache instability
```

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS cache_stats (
  id TEXT PRIMARY KEY,              -- {sessionID}:{modelID}:{turn}
  session_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL,               -- JSON: CacheStatsRow
  UNIQUE(session_id, model_id, turn)
);

CREATE INDEX IF NOT EXISTS cache_stats_session_model_idx
  ON cache_stats(session_id, model_id, turn);
```

JSON shape of `data` column:
```jsonc
{
  "turn": 5,
  "timestamp": 1719273600000,
  "perMessage": {
    "msg_abc123": {
      "messageId": "msg_abc123",
      "role": "user",
      "partCount": 3,
      "hitCount": 4,
      "missCount": 0,
      "lastMd5": "d41d8cd98f00",
      "firstSeen": 1,
      "lastSeen": 5
    },
    "msg_def456": {
      "messageId": "msg_def456",
      "role": "assistant",
      "partCount": 8,
      "hitCount": 2,
      "missCount": 3,
      "lastMd5": "098f6bcd4621",
      "firstSeen": 2,
      "lastSeen": 5
    }
  },
  "summary": {
    "totalTurns": 5,
    "totalMessages": 12,
    "commonMessages": 10,
    "estimatedHitRatio": 0.83,
    "cacheStable": false
  }
}
```

## Tasks

### Sub-Goal 1: Schema (0.5 day)
- [ ] 1.1 Add `cache_stats` table to `src/session/session.sql.ts` with Drizzle schema
- [ ] 1.2 Columns: `id` (PK, compound), `session_id`, `model_id`, `turn`, `timestamp`, `data` (JSON text)
- [ ] 1.3 Unique constraint: `(session_id, model_id, turn)`
- [ ] 1.4 Index: `(session_id, model_id, turn)` for fast last-N-row lookup
- [ ] 1.5 Generate migration via `drizzle-kit generate`

### Sub-Goal 2: Types and Accumulation (1 day)
- [ ] 2.1 Define `MessageStats`, `SessionSummary`, `CacheStatsRow` types in `cache-control.ts`
- [ ] 2.2 Implement `accumulateStats(prev: CacheStatsRow | null, prevFP: RequestFingerprint | null, currentFP: RequestFingerprint): CacheStatsRow`
- [ ] 2.3 Implement `recentDiff(sessionID, modelID)` — loads last 2 rows, diffs perMessage maps, returns changed messageIDs
- [ ] 2.4 Implement `computeSummary(row: CacheStatsRow, currentFP, prevFP): SessionSummary`

### Sub-Goal 3: Persistence Layer (0.5 day)
- [ ] 3.1 Implement `CacheStats.store(row: CacheStatsRow): Effect<void>` — INSERT OR REPLACE
- [ ] 3.2 Implement `CacheStats.loadLatest(sessionID, modelID): Effect<CacheStatsRow | null>`
- [ ] 3.3 Implement `CacheStats.loadRecent(sessionID, modelID, limit=2): Effect<CacheStatsRow[]>`
- [ ] 3.4 Cleanup: `CacheStats.remove(sessionID)` — delete all rows for session

### Sub-Goal 4: Query API (0.5 day)
- [ ] 4.1 `CacheStats.worstOffenders(sessionID, limit=10): CacheStatsRow[]` — highest miss count
- [ ] 4.2 `CacheStats.sessionHitRatio(sessionID): number` — average estimatedHitRatio across all turns
- [ ] 4.3 `CacheStats.messageHistory(sessionID, messageID): CacheStatsRow[]` — all rows for a message

### Sub-Goal 5: Integration (0.5 day)
- [ ] 5.1 Wire into `prompt.ts` after `auditCache()` (line 1626): fire-and-forget `CacheStats.store()`
- [ ] 5.2 Keep existing ephemeral `CacheAuditEntry` for in-turn decisions (cacheStable check, modelMsgsCache)
- [ ] 5.3 Accumulate stats as side effect — does not block the prompt loop

### Sub-Goal 6: Tests (0.5 day)
- [ ] 6.1 Accumulate: message survives 3 turns unchanged → `hitCount=3`, `missCount=0`
- [ ] 6.2 Message changes at turn 4 → `hitCount=3`, `missCount=1`, md5 updated
- [ ] 6.3 New message appears at turn 5 → `firstSeen=5`, `hitCount=0`
- [ ] 6.4 Message removed at turn 6 → no longer in perMessage map, lastSeen frozen at 5
- [ ] 6.5 recentDiff: correctly identifies { changed, new, removed } sets
- [ ] 6.6 worstOffenders: returns correct ranking by missCount
- [ ] 6.7 Empty session: no rows → all queries return null/empty gracefully
- [ ] 6.8 sessionHitRatio: average across all turns matches manual calculation

## Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| 1 | First turn → row with all messages having hitCount=0 | Row inserted, perMessage has entries |
| 2 | 3 turns with identical messages → hitCount=2 for each | All messages have hitCount=2 |
| 3 | Turn 4: one message text changed → that message hitCount stays, missCount=1 | missCount=1 for changed, hitCount=2 for others |
| 4 | Turn 5: new message appended → appears with firstSeen=5 | New messageID in perMessage |
| 5 | Turn 6: message removed → not in perMessage, lastSeen frozen | lastSeen=5 for removed message |
| 6 | recentDiff(T5, T6) → returns removed messageID | removed set contains deleted messageID |
| 7 | worstOffenders across 10-turn session → correct ranking | Manual trace confirms order |
| 8 | sessionHitRatio over 5 turns → correct average | (0.8 + 0.9 + 1.0 + 0.7 + 0.85) / 5 = 0.85 |
| 9 | Typecheck passes | `bun typecheck` zero errors |

## Effort Estimate

| Sub-Goal | Effort |
|----------|--------|
| 1. Schema | 0.5 day |
| 2. Types + Accumulation | 1 day |
| 3. Persistence | 0.5 day |
| 4. Query API | 0.5 day |
| 5. Integration | 0.5 day |
| 6. Tests | 0.5 day |

**Total: 3.5 days**
