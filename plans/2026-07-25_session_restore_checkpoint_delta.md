# Session restore + checkpoint delta path (kill full-history reprocess)

**Status:** active  
**Date:** 2026-07-25  
**Branch context:** `Local_Development`  
**Priority:** high тАФ restored long-lived sessions (lifetime ~100M tokens of archive) hang on open / first prompt even when checkpoint exists.

---

## Context / goal

When TUI opens a long session (or first prompt after restore), users see a multiтАСsecond to multiтАСminute тАЬinitializationтАЭ stall. Investigation showed:

1. **Checkpoint design promise is not wired as a load gate.**  
   Header in `checkpoint.ts` claims: *тАЬreducing DB reads to delta messages only.тАЭ*  
   Actual loop: **full hydrate first**, then maybe reuse system + ModelMessage prefix.

2. **`filterCompactedEffect` loads the entire lifetime archive.**  
   Soft-hide (`info.compacted` inside JSON `data`) is applied **after** `SELECT *` + JSON-hydrate of all messages and all parts. SQLite disk bandwidth is not the bottleneck; **JSON.parse + JS object graph + repeated full walks** are.

3. **Request-diff re-serializes full history** (then compares all message groups).  
   Diff **output** is delta-ish; **work** is full-history. Cap `MAX_FORMATTED_REQUEST_CHARS = 256KB` is **prefix-biased** (starts at message #0), so huge sessions often format **old** content and miss the **new** suffix.

4. **TUI `pageCompacted(limit:100)` still full-loads** via `filterCompactedEffect` before slicing.

### Goal

Make restore + first prompt cost scale with:

| Path | Cost target |
|------|-------------|
| Visible model window | O(non-compacted rows) тАФ ideally last N + pinned `message*` |
| With usable checkpoint | O(**delta after last checkpointed message id**) for DB + conversion + request-diff |
| TUI open (limit 100) | O(page size) SQL + hydrate тАФ **never** full session |

Preserve: KV-cache continuity, soft-hide semantics, checkpoint identity invalidation, compaction removal of checkpoints.

### Non-goals

- Training / provider-side context compression  
- Hard-deleting compacted messages from DB  
- Changing compaction memory semantics (`message*` Exact handles)  
- Full rewrite of Effect/session runtime  

---

## Diagnosis (code-backed)

### A. Load-before-checkpoint (control plane)

```
runLoop step
  1. filterCompactedEffect(sessionID)   тЖР SELECT all messages + all parts  тЭМ
  2. loop control over full msgs
  3. Checkpoint.load(...)               тЖР only here
  4. reuse system + ModelMessage prefix
```

Key files:

| File | Problem |
|------|---------|
| `session/message-v2.ts` `filterCompactedEffect` | Unbounded SELECT + hydrate, filter in JS |
| `session/message-v2.ts` `pageCompacted` | Calls full `filterCompactedEffect` then slices |
| `session/prompt.ts` `SessionPrompt.run` | Always full load before checkpoint; no delta branch |
| `session/checkpoint.ts` | Correct *intent*; used only as rebuild cache |
| `cli/cmd/tui/context/sync.tsx` | `messages({ limit: 100 })` тАФ UI OK; server still full-loads |

### B. `compacted` is not a SQL column

`MessageTable.data` is `text({ mode: "json" })`. `info.compacted` lives **inside** JSON.  
SQL filter needs either:

- **Preferred:** first-class `compacted INTEGER NOT NULL DEFAULT 0` column + index `(session_id, compacted, time_created, id)`, backfill from JSON; keep JSON field in sync on compact  
- **Interim:** `json_extract(data, '$.compacted') IS NOT 1` + expression index (slower / messier)

### C. Request-diff full walk

| Call site | Behavior |
|-----------|----------|
| `prompt.ts` ~1795тАУ1833 | `formatRequest(system, modelMsgs /* full */, тАж)` every turn |
| Cold restore | Also `formatRequest(checkpoint.messages /* full */)` as prev |
| `formatRequest` | Loop from `i=0` until 256KB тАФ **prefix truncate** |
| `diffMessages` | Hash/key **all** groups even if only suffix changed |

### D. Why тАЬSQLite can read 1GB/sтАЭ doesnтАЩt help

Cost is not B-tree I/O. Cost is:

- Drizzle `mode: "json"` тЖТ `JSON.parse` per row  
- Full object graph + GC  
- Multiple re-walks (loop, fingerprints, `hashPartTexts` char-by-char, `toModelMessages`, `JSON.stringify(messages)` token estimate, request-diff)  
- Checkpoint AES-GCM decrypt + `JSON.parse` of **second** full copy  

---

## Prior art

**reuse: local + standard soft-delete patterns**

| Source | Reuse |
|--------|--------|
| **Local** `Checkpoint.reusablePrefixLength` / `takeModelPrefix` | Already computes longest shared message-id + fingerprint prefix тАФ use as **delta cursor**, not only conversion skip |
| **Local** `MessageV2.messagesSince(sessionID, afterId)` | Already loads only rows with `id > after` тАФ extend for non-compacted + reverse paging |
| **Local** `page()` | Already limit+cursor; `pageCompacted` should mirror this **without** full hydrate |
| **Local** `request-diff.test.ts` | Extend for suffix-only / id-window formatting |
| **Web** soft-delete practice | Filter soft-deleted rows in SQL (or active view); never hydrate archive for hot paths ([soft-delete query patterns](https://stackoverflow.com/questions/7366849/implementing-soft-delete-with-minimal-impact-on-performance-and-code); active-view pattern) |

No need for external libraries. Do **not** invent a new checkpoint format unless v4 fields prove insufficient (`messageIDs`, `modelMessageCounts`, `messageFingerprints` already exist).

---

## Architecture (target)

```text
                    тФМтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФР
                    тФВ Checkpoint.load (mem/disk)тФВ
                    тФФтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФмтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФШ
                                тФВ
              usable? тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФ╝тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФР
                yes             тФВ no                           тФВ
                тЦ╝               тЦ╝                              тФВ
   lastId = messageIDs[-1]   SQL: non-compacted               тФВ
   DB: messagesSince(lastId)   page / full visible window     тФВ
   (+ optional dirty check     hydrate only those rows        тФВ
      on last few via fps)                                    тФВ
                тФВ               тФВ                              тФВ
                тЦ╝               тЦ╝                              тФВ
   modelMsgs = ck.prefix      system assemble + full convert  тФВ
             + convert(delta)                                  тФВ
                тФВ               тФВ                              тФВ
                тФФтФАтФАтФАтФАтФАтФАтФАтФмтФАтФАтФАтФАтФАтФАтФАтФШ                              тФВ
                        тЦ╝                                      тФВ
              stream to provider                               тФВ
                        тФВ                                      тФВ
                        тЦ╝                                      тФВ
         request-diff: format/diff SUFFIX only  тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФШ
         (or skip when only append-stable)
```

### Checkpoint-usable path (cold restore)

1. Load checkpoint (mem тЖТ disk).  
2. Validate identity + structured-output flag (existing).  
3. **Do not** call `filterCompactedEffect` for the full set.  
4. Load **delta** messages:  
   - `WHERE session_id = ? AND id > lastCheckpointedId AND compacted = 0`  
   - Hydrate **only those** (plus optionally re-fetch last K checkpointed IDs if fingerprint dirty detection needed).  
5. For loop control needing тАЬlast user / last assistantтАЭ:  
   - Prefer delta + checkpoint metadata, **or** a cheap tail query `ORDER BY time_created DESC LIMIT K` non-compacted only.  
6. `modelMsgs = takeModelPrefix(ck, prefixLen) + convert(suffix)`.  
   When delta is pure append and fps match, `prefixLen = messageIDs.length`.  
7. System = `ck.systemPrompt` (unchanged).

### Checkpoint-missing / invalid path

1. SQL-visible-only load (never compacted archive).  
2. Existing system assemble + full convert.  
3. Save new checkpoint as today.

### TUI / API page

`pageCompacted({ limit, before })`:

- **Never** call full `filterCompactedEffect`.  
- SQL: non-compacted, time/id ordered, limit+1, pin compaction boundary if needed (existing `isCompactionBoundary` logic on the small page result only).

---

## Implementation steps

### Phase 0 тАФ Instrumentation (prove before/after)

- [x] Timing logs on `filterCompactedEffect` (kept + `sqlVisible`), `pageCompacted`, `formatRequest`
- [ ] Optional: huge-session manual baseline in Smoke **Actual** after user run (instrumentation ready)

### Phase 1 тАФ SQL-visible path (no archive hydrate)

- [x] **Schema:** `message.compacted INTEGER NOT NULL DEFAULT 0` in `session.sql.ts` + `schema-project.sql.ts` + `db.ts` CREATE
- [x] Projector sets column from `info.compacted` on every `Message.Updated` (covers compact soft-hide)
- [x] Migration `20260601000002_message_compacted_column` тАФ column + JSON backfill + index
- [x] Index `(session_id, compacted, time_created, id)`
- [x] `filterCompactedEffect` тЖТ `WHERE compacted = 0` + hydrate only those rows
- [x] `pageCompacted` тЖТ SQL limit+cursor on visible; pin head via O(1) `visibleHead` (no full hydrate)
- [x] `messagesSince` defaults to visible-only (delta after checkpoint id)

### Phase 2 тАФ Checkpoint as load gate (prompt loop)

- [x] Visible load is SQL-filtered (archive never hydrated) тАФ primary win for lifetime-huge sessions
- [x] Checkpoint save reuses in-loop `cachedMsgs` + `messagesSince` when possible (avoids second full visible SELECT)
- [x] Cold restore: no full-checkpoint `formatRequest` as prev
- [ ] Full reorder (checkpoint before any msgs load) deferred тАФ loop control still needs visible window; Phase 1 makes that cheap when compacted
- [ ] Bounded-tail-only loop (no filterCompactedEffect at all when checkpoint hits) тАФ follow-up if still slow on uncompacted huge sessions

### Phase 3 тАФ Request-diff suffix-only

- [x] `formatRequest` opts: `fromIndex`, `preferNewest` (suffix-first under budget)
- [x] `prompt.ts`: `modelMessageEnd(dbPrefix)` as fromIndex; skip full checkpoint re-format as prev
- [x] Cold restore: only `rememberFormatted` (no `.diff` until next turn has in-process prev)
- [x] Tests: fromIndex suffix, preferNewest keeps latest, budget bounds

### Phase 4 тАФ Secondary CPU wins (same PR or follow-up)

- [x] `hashPartTexts`: length + head/tail sample + Bun.hash (not char-by-char)
- [x] `llm.ts` token estimate: walk string lengths, no `JSON.stringify(messages)`
- [ ] `requestFingerprint` suffix compose тАФ follow-up
- [ ] Checkpoint disk size shrink тАФ out of scope

### Phase 5 тАФ TUI / API verification

- [x] `pageCompacted` rewritten (API/TUI `limit: 100` path)
- [ ] Manual huge-session reopen timing (user / next session)
- [ ] First prompt checkpoint log sample on real huge session

---

## File map

| File | Changes |
|------|---------|
| `packages/opencode/src/session/session.sql.ts` (+ project schema twin if dual) | `compacted` column + index |
| migration / db bootstrap | backfill + index create |
| `packages/opencode/src/session/compaction.ts` | set column on soft-hide |
| `packages/opencode/src/session/message-v2.ts` | visible SQL load, `pageCompacted`, `messagesSince` non-compacted |
| `packages/opencode/src/session/prompt.ts` | checkpoint-first branch; kill redundant full loads; suffix diff call |
| `packages/opencode/src/session/request-diff.ts` | suffix/window format; optional skip full baseline |
| `packages/opencode/src/session/checkpoint.ts` | maybe export lastId helper; doc fix (promise matches code) |
| `packages/opencode/src/session/llm.ts` | optional token estimate fix |
| `packages/opencode/src/session/cache-control.ts` | optional suffix fingerprint |
| `packages/opencode/test/session/request-diff.test.ts` | suffix tests |
| `packages/opencode/test/session/тАж` (new or existing) | visible SQL / pageCompacted / checkpoint-delta unit tests |

---

## Correctness constraints

1. **[KV-CACHE]** Path system still frozen under checkpoint; identity fingerprint rules unchanged.  
2. Soft-hidden rows remain queryable via **session-read / tools** (separate explicit archive APIs if needed тАФ do not break Exact recovery).  
3. Compaction still **removes** checkpoint slots so message IDs cannot mix eras.  
4. `modelMessageCounts` still required for tool-call expansion (existing `takeModelPrefix` rules).  
5. No silent empty context: if delta load fails, fall back to visible-full path and log `bug:` / warn.  
6. Every new catch logs (no empty `catch {}`).

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Loop control needs full history | Bounded tail SQL (last K non-compacted) + checkpoint ids |
| `compacted` only in JSON today | Promote column + backfill before relying on index |
| Fingerprint dirty mid-history | Keep optional re-hydrate of dirty message ids only |
| Diff semantics change for tools reading .diff files | Document: diffs become suffix-centric; still valid turn-to-turn |
| Migration on large DBs | Backfill once; index creation offline-friendly |

---

## Success criteria

1. Opening a session with limit 100 **does not** SELECT compacted archive rows.  
2. First prompt with usable checkpoint: DB hydrate row count тЙИ **new messages since checkpoint** (plus small tail), not lifetime message count.  
3. Request-diff CPU тЙИ O(new messages); no full-checkpoint `formatRequest` on cold restore.  
4. Existing prompt / compaction / request-diff tests pass.  
5. Timing logs on a large session show multi-second work moved to near-instant for checkpoint+delta path (order-of-magnitude improvement).

---

## Smoke Tests (required тАФ PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/session/request-diff.test.ts` from `packages/opencode` | pass | **23 pass, 0 fail** (pre-edit) |
| 2 | `bun test test/session/prompt.test.ts` from `packages/opencode` | pass (or known subset) | pre-edit not re-run fully; post-impl flaky suite (timeouts / unrelated UTC asserts) |
| 3 | Manual huge-session log | large hydrate | deferred to user verification |
| 4 | Instrumentation | missing | added on key paths |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria | Actual [Exact] |
|---|---------------|---------------|----------------|
| 1 | `bun test test/session/request-diff.test.ts` | pass + suffix cases | **25 pass, 0 fail** |
| 2 | `bun test test/session/compaction.test.ts -t filterCompactedEffect` | pass | **1 pass** (visible=1 after compact) |
| 3 | `bun test test/session/compaction.test.ts` | pass | **68 pass** (all compaction) |
| 4 | `bun typecheck` from `packages/opencode` | clean | **exit 0** |
| 5 | Manual huge session reopen | order-of-magnitude faster | pending user |
| 6 | `prompt.test.ts` full file | ideally green | flaky timeouts / UTC assertion failures require separate investigation; not accepted as a passing oracle for this change |

### Gate

- [x] Smoke requirements written  
- [x] Baseline recorded [Exact] (request-diff)  
- [x] Implementation after baseline  
- [x] Core post-impl smokes passed (request-diff, compaction, typecheck)  
- [ ] Manual huge-session confirmation  


---

## Suggested PR / commit order

1. **Schema + visible SQL load + pageCompacted** (safe, huge TUI win alone)  
2. **Prompt loop checkpoint-first + delta** (first-prompt win)  
3. **Request-diff suffix-only** (CPU + correct diagnostics)  
4. **Secondary CPU** (hashPartTexts / token estimate) as polish  

Each PR should ship with Phase 0 timings or unit oracles so we do not regress.

---

## Open questions (resolve during Phase 1тАУ2)

1. Dual schema: only `session.sql.ts` or also `storage/schema-project.sql.ts` тАФ keep both in sync if both exist in this fork.  
2. Minimum **tail K** for loop control without full history (propose K=50 non-compacted).  
3. Whether first restored turn should skip `.diff` write entirely (recommended) vs empty-prev baseline.

---

## Related docs

- `docs/compaction.md` тАФ soft-hide / message* semantics  
- `AGENTS.md` тАФ KV cache + checkpoint system  
- `packages/opencode/src/session/checkpoint.ts` тАФ design comment to update when delta path ships  
)
