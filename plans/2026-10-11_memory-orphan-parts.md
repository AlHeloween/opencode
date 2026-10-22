<!-- intention: the memory index only ever ADDS (rowid watermark, monotonic) and carries no liveness filter on the session -> parts of DELETED sessions stay in the index and in search results forever (18 903 parts + 4 310 messages left behind by the cmd_runner bug cleanup; 4 sampled deleted sessions each still carry 3 indexed parts) -> the index stops serving deleted content and stops growing on it. -->

# Memory index serves deleted sessions

<!-- goal_sv: memory-index-liveness, deleted-session-parts, no-ghost-search, watermark-monotonic, index-truth -->
```yaml
Keywords: memory-index-liveness 0.30, deleted-session-parts 0.25, no-ghost-search 0.20, watermark-monotonic 0.15, index-truth 0.10
Semantic dominant: The memory index stops serving parts of deleted sessions and stops growing on them, so what a search returns is what still exists.
md5: c6c8ea653074a18db658845cc3541532
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
note: hash values are generative tags — search them, never compute them.
```
**Status:** ACTIVE — 2026-10-11. Owner picked the "150 invisible parts" task; measurement + his explanation of their origin INVERTED it.

## 0. Why the first version of this plan was wrong (kept, not deleted)

v1 said the sync's filter-only `JOIN message m ON m.id = p.message_id` (`memory.ts:118`) drops
orphan parts, 132 of them carried unique text, so the part was "lost content" and the join should
go. The measurement behind it was right; the READING of it was wrong.

Owner, 2026-10-11: «Левые сессии я удалил потому что они появились из за бага в cmd_runner…
оркестратор не мог отправить задание и запускал сервер, потом прибивал, потом опять запускал.
Сейчас все ок.» So the orphans are the **leftovers of deletions**, and their uniqueness is exactly
what deletion produces — not evidence of value. Measured in the same pass:

| fact | value |
|---|---|
| parts whose `message` row is gone | 136 (132 with text) |
| parts whose `session` row is gone | **18 903** |
| messages whose `session` row is gone | **4 310** |
| sessions alive now | 83 |
| deleted sessions found in `part_index` (4 sampled) | **3 indexed parts each — they ARE searchable** |

Consequences, and they are the opposite of v1:

1. `JOIN message` is **correct** — it is what keeps the 136 parentless parts out of the index.
   v1 would have made the index worse.
2. The real defect is that the sync has **no liveness filter at all on the session**, and the
   watermark can only ever ADD. Nothing is ever removed from the index either.

v1 is superseded, not refuted-and-forgotten: it is the record of a measurement read wrong, and the
reason the plan exists in this shape.

## 1. The defect

`Memory.sync` (`memory.ts:105-196`) reads `WHERE p.rowid > watermark` and inserts. Therefore:

- a part whose **session** no longer exists is indexed and stays indexed — the `message_id` is
  still valid, so the join does not stop it (`ses_ed8b299e…`, `ses_ed97760c…`, `ses_ed9adaa7…`,
  `ses_ed9ba127…` — 3 parts each, measured in `part_index`);
- a part deleted from the project DB is **never removed** from `part_index` — the watermark cannot
  go backwards. The index is append-only over a mutable source.

Both are the same class: **the index does not reflect deletion.**

## 2. Tasks

- [ ] **S1 — liveness filter.** `memory.ts`: a part is indexed only if its `session` exists in the
      project DB (join/EXISTS on `session`). Keep the existing `message` join — it is correct.
- [ ] **S2 — the index forgets.** remove from `part_index` (+ `part_fts`) rows whose session is
      gone, so an existing polluted index heals without a manual delete of `memory.db`.
- [ ] **S3 — RED test.** `test/memory/search.test.ts`: extend `indexFixture` so a part can be
      seeded for a session that is then deleted; assert `Memory.search` does NOT return it, while
      live-session parts still do. Must FAIL before S1/S2.
- [ ] **S4 — gates.** `test/memory/*.test.ts` green, one file per run; `bun typecheck` from
      `packages/opencode`; `_build.ps1`.

## 3. Smoke Tests

| oracle | before | after |
|---|---|---|
| `bun test test/memory/search.test.ts` (cwd `packages/opencode`, cmd_runner) | **6 pass / 0 fail** — pinned 2026-10-11 `20261011T160558Z_f3cd4bd2` | PASS + new case |
| new case: part of a deleted session | **FAIL — it is returned today** | PASS — not returned |
| `search-rank.test.ts`, `fts-query.test.ts` | PASS | PASS (unchanged) |

## 4. Owner decision required (destructive, NOT done here)

The 18 903 parts / 4 310 messages of deleted sessions are still in `opencode.db`. Purging them is
a deletion in his data and needs his word. The index fix (S1/S2) does not require it — it makes the
index ignore them either way.

## 5. Out of scope

- The cmd_runner bug that produced those sessions — owner reports it fixed («Сейчас все ок»).
- `patch` parts carry no `text`, so `if (!text) continue` skips them: **`edit` diffs are not
  searchable in `messagesearch` at all.** Separate decision.
- ~18 parts below the watermark still unexplained by any of the above.
