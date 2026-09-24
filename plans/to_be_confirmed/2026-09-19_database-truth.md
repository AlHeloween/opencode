# Database truth — dead sources, unclear tables, and fixtures that agree with nobody

<!-- intention: tables and counters nobody writes produce mechanisms that never fire while every suite stays green -> every table has a named writer, every dead surface is removed, and any counter is checked against the live database -->

Owner, 2026-09-19: «если посмотреть базу там море таблиц с непонятными целями». That aside produced a real
defect within the hour — and it was found by READING the database, not by any test.

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
