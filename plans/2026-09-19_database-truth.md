# Database truth — dead sources, unclear tables, and fixtures that agree with nobody

<!-- intention: tables and counters nobody writes produce mechanisms that never fire while every suite stays green -> every table has a named writer, every dead surface is removed, and any counter is checked against the live database -->

Owner, 2026-09-19: «если посмотреть базу там море таблиц с непонятными целями». That aside produced a real
defect within the hour — and it was found by READING the database, not by any test.

## Shelf triage 2026-10-09 (t25-shelf-triage)

**Verdict: RETURN — moved back to `plans/` root.** T1's analysis is done below; the remaining actions are named and unblocked.

Re-measured on the live DB (`.opencode/data/opencode.db`, 2026-10-09) and against the code:

- `event` **123 921 rows** (was 87 548) — writer `sync/index.ts:179` (paired with `event_sequence`); readers `session/recovery.ts:87`, `server/routes/instance/httpapi/sync.ts:122`, `control-plane/workspace.ts:178`; growth policy: per-aggregate delete via `sync.remove()` (`sync/index.ts:377`), **no time policy — T2 open: name it or bound it.**
- `balance_snapshot` 840 rows — writer `provider/balance-storage.ts:36`; it is an append-log (a row per balance check; reads take the latest per provider) with **no retention — T3 open.**
- `session_entry` 0 rows — **no writer anywhere in this build** (schema/indexes only: `storage/db.ts:177-187`, `session/session.sql.ts:142-156`; the fact is recorded in `session/turn.ts:14` and pinned by `test/session/turn.test.ts:71`). **T1's concrete next action: remove the surface.**
- Zero-row but with writers (keep): `part_embedding` ← `attachment/embedding.ts:79`; `session_share` ← `share/share-next.ts:320`; `workspace` ← `control-plane/workspace.ts:107`; `media_token_calibration` ← `session/media-token-calibration.ts:112` — empty only because the paths are unexercised here.
- T4: the fixtures already rebased (store suite per the Done section; `test/session/acquired-item-store.test.ts:72`) cover the known offenders; the sweeping audit of every raw-SQL fixture is not evidenced — **still open.**

## Why this is its own plan

It is not TDA. It is a standing property of the storage plane, and the discovery arrived while answering a
question about TDA and would have eaten that cycle. Separated so the TDA plan can finish.

## Done (2026-09-19, commit `55415e7ed1`)

- `currentTurn` counted turns from `session_entry`, which holds **ZERO rows**, so `expires_at_turn < turn`
  was never true and **no span would ever expire** — silently, in a mechanism whose every test was green.
- Re-based on `message` (`json_extract(data, '$.role') = 'user'`); the store suite's fixture moved with it.
- Measured on the live database afterwards: this session 335 turns, the busiest 414 — against 0 for every
  session on the old source.

## The inventory (measured: one SELECT over `sqlite_master`, plus counts)

| table | rows | disposition |
|---|---|---|
| `event` | 87 548 | the largest object in the database; purpose not yet named → T2 |
| `part` | 65 184 | core |
| `message` | 15 368 | core |
| `balance_snapshot` | 1 757 | a "snapshot" growing like a log → T3 |
| `todo` | 116 | core |
| `project_checkpoint` | 47 | Layer-1 summaries |
| `event_sequence` | 26 | ? |
| `session` | 17 | core |
| `migration` | 10 | core |
| `project` | 1 | core |
| `session_entry` | 0 | **writer NOT found** → T1 |
| `media_token_calibration` | 0 | known dead in practice (no provider sends `image_tokens`) → T1 |
| `part_embedding` | 0 | ? → T1 |
| `permission` | 0 | fine — empty until rules exist |
| `session_share` | 0 | ? → T1 |
| `workspace` | 0 | ? → T1 |

## Tasks

- **T1 — no table without a named writer.** For every zero-row table: find the writer in code, or state
  that there is none. A table with no writer is a SURFACE TO REMOVE, not to keep — a defect is fixed by
  deleting a surface, not by adding a guard.
- **T2 — `event`, 87 548 rows, the largest object in the database.** Name its writer, its reader, and its
  growth policy. It is a quarter larger than `part`, which is the working memory of the whole agent.
- **T3 — `balance_snapshot`, 1 757 rows.** Either it is a snapshot (bounded: one row per provider) or it is
  a log (unbounded, and then it needs a retention rule or an honest name).
- **T4 — the fixture rule, made checkable.** A fixture must write what PRODUCTION writes. The counter defect
  survived precisely because a fixture inserted rows nothing in this build writes, so the test and the code
  agreed with each other and neither agreed with the database. Check every fixture that inserts raw SQL
  against the production writer.

## Smoke Tests

- `dbread` inventory before and after: every table either has a named writer in code, or is gone.
- For every removed surface: a `grep` proving zero call sites (the same oracle used when dead code was
  removed on 2026-09-19).
- The counter family: `dbread` against the live database shows non-zero turns for real sessions — the check
  that no fixture had ever performed.
