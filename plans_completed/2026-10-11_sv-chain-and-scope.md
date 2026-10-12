<!-- intention: the semantic-vector chain is the only carrier that can rebuild a trajectory after a fold, but it is 8.5% dense, it is read by re-parsing prose, `session: "*"` silently returns nothing, and sessions can be mixed into one list -> the chain becomes readable, addressable and scope-correct: current session by default, `*`/`all` means the whole base, breaks counted inside a session. -->

# messagesearch: the vector chain as carrier, and session scope that means something

**Status:** COMPLETE 2026-10-12 — S1–S5 earned; unit gates + a live source-run smoke on a copied index; closing commit names this plan.

## 1. What is measured (all instruments named)

| fact | value | instrument |
|---|---|---|
| assistant `text` parts in the whole index | 6 667 | `dbread memory` |
| of them carrying `md5:` / `Semantic dominant:` / `Keywords:` | **569 / 565 / 562 — 8.5 %** | `dbread memory` |
| emission decays with window length | obeying at prompt 352 776; gone at 389 893 and 498 315 | `spine.ts:489-502`, owner measurement 2026-10-03 |
| `session: "*"` | **«No results found»** where the same query with no `session` returned 5 hits | live `messagesearch` call |
| why | `resolveScope` handles only `undefined`, `"all"`, `"current"`; `"*"` falls through to the explicit-id branch → `session_id = '*'` → 0 rows, silently | `messagesearch.ts:69-73` |
| chain corpus default | **current session** — already correct, for `corpus:"summaries"` | `messagesearch.ts:129-130` |
| prior-art default | whole project, deliberately — narrowing would turn «no prior art» into a wrong answer | `messagesearch.ts:65-67` |
| why a mix is worse than untidy | `prev-md5` points inside its own thread, so a cross-session seam reads as a **broken chain**, and the break is the only discriminator we have (ΔSV over terms saturates: consecutive messages share no terms) | `spine.ts:58-74` |
| marker scan cost | 1 563 ms over the whole index vs 15 ms inside a range | `memory.ts:442-444` |
| `*` already means "all" elsewhere in this very tool | `ctx.ask({ patterns: ["*"] })` | `messagesearch.ts:107-108` |

## 2. Tasks

- [x] **S1 — `*` is a scope.** DONE — `resolveScope` (`messagesearch.ts:70-72`) treats `"*"` exactly
      like `"all"`; `test/tool/history-filters.test.ts` gained the case. Oracles: baseline 7/0
      `20261011T163309Z_f2711c10` → **RED 6 pass / 1 fail** `20261011T163336Z_b5fb17e8` → **GREEN 7/0,
      18 expect** `20261011T163356Z_b5d9cc75`; `bun typecheck` exit 0 `20261011T163407Z_20b25ea0`;
      `_build.ps1` exit 0, smoke **10.0.1276** `20261011T163435Z_20ad046a`. A LIVE tool verdict is not
      available in this session — the tool catalogue is frozen in the checkpoint and built from the
      binary — so the test (which loads source) is the oracle here, and that is stated in the log.
- [x] **S2 — `corpus: "vectors"`.** DONE — `Memory.listVectorCarriers` reads the EXISTING `part_index`
      (assistant `text`, ULID `message_id` DESC = global time order, `session_id` carried per row);
      the tool projects each row through `hasSemanticVector` + `extractVectorChain` + `extractKeywords`
      + `extractMessageDominant` and renders `vectorLine` (`{ordinal, messageIndex, prev→self md5,
      dominant, keywords, messageID}`). `last` defaults to 20 for this corpus. Unit:
      `test/memory/vector-carriers.test.ts` (projection keeps declared vectors, drops a quoting row;
      link reads intact) — 30/30 with spine in run `20261012T104654Z_9832b3ef`. LIVE (source-run on a
      copied index, `experiments/2026-10-11_sv-chain-smoke`): run `20261012T105036Z_c99fe01d` —
      `## Vector chain — 5 of 441 carrier(s) · 2 break(s)`, newest first, links visible
      (`08f076f1→7c31b9e5`, chain start as `start→3f19c2ea`), grouped under `## Session:`.
- [x] **S3 — breaks counted inside a session.** DONE — `chainBreaks` (`spine.ts`): a row whose
      `prev-md5` differs from the previous listed row's `md5` is a break; an unreadable side is
      UNKNOWN and never marked; the all-zero hash is a chain START, not a break. Header prints
      `N carrier(s) · M break(s)`; with `session: "*"` the list is grouped by session and a session
      boundary is never fed to the counter. Unit: `chainBreaks` cases in `test/memory/spine.test.ts`
      (same 30/30 run). LIVE: `· 2 break(s)` in `20261012T105036Z_c99fe01d`, matching the real
      session seam between listed rows.
- [x] **S4 — silence is not an answer.** DONE — `Memory.hasSession` + a guard in `messagesearch`
      (skipped for `summaries`, which reads checkpoints rather than the index): an explicit session id
      with no index rows answers `session <id> is not in the memory index`. Unit:
      `test/memory/vector-carriers.test.ts` (`hasSession` true for the live session, false for an
      absent id). LIVE: run `20261012T104941Z_504aceec` — model called
      `messagesearch { session: "ses_absent_smoke_xyz" }` and the tool answered
      `session ses_absent_smoke_xyz is not in the memory index` (title `MessageSearch "session …"`).
- [x] **S5 — gates.** DONE — `bun test test/tool/history-filters.test.ts` 7/7 (run
      `20261012T104654Z_9832b3ef`); `test/memory/*.test.ts` one file per run
      (`20261012T104724Z_08dc8f98`: search, search-rank, fts-query, budget 6/6, abort-leak 2/2,
      vector-sign 6/6 — 0 fail each), `bun typecheck` exit 0 (same run); `test/tool/registry.test.ts`
      11/11 `20261012T105140Z_fa4255ea` (the parameter annotations changed); `_build.ps1` exit 0, smoke **10.0.1287** (run `20261012T105202Z_a4cfcd94`).

## 3. Smoke Tests

| oracle | before | after / result |
|---|---|---|
| `bun test test/tool/history-filters.test.ts` | PASS (baseline pinned) | PASS + `*` case — 7/7 `20261012T104654Z_9832b3ef` |
| `messagesearch { session: "*", query: "liveMessages" }` | **«No results found»** (the defect) | same hits as no-`session` — S1 unit-verified; live re-verification is S5's `*` semantics |
| `messagesearch { corpus: "vectors", last: 5 }` | unknown parameter → parts mode | LIVE `20261012T105036Z_c99fe01d` (with `session:"*"`): 5 newest of 441 carriers, newest first, with md5/prev links and `2 break(s)`. On a FRESH session the same call honestly answers `Vector chain — 0 carrier(s)` (default scope = current session, as `summaries`) — run `20261012T104941Z_504aceec`. |
| `messagesearch { session: "ses_absent" }` | «No results found» | LIVE `20261012T104941Z_504aceec`: names the absent session |

**Measured incident, recorded for the next smoke:** the sandbox project DB is a COPY of the repo's,
and the copy drags the `server_host` row with it — the first run thus ATTACHED to the live host
(pid 26272, port 4096) and its tools executed from the OLD binary (browse + «No results found»).
Fix: `DELETE FROM server_host` in the sandbox copy; the two later runs executed the source and
self-identify by the new titles (`Vector chain — …`, `MessageSearch "session …"`).

## 4. Deliberately NOT in this plan (named so they are not mistaken for done)

- **Density.** 8.5 % means a chain of a few nodes over forty turns. Two routes, owner's choice: repair
  emission (it is a POSITION problem — `vectorSign` already made the vector the address of a durable
  artefact, so a missing one is visible rather than silent), or fill gaps machine-side and mark
  `source: model | machine`. Neither is in S1-S4.
- **Tail of the chain in `m*`.** After a fold the agent cannot ISSUE a query — it reads `m*`. The right
  carrier is the fold, not a tool call. Touches `session/compaction.ts`; its own plan.
- **Materialising the chain into a table.** Not needed at current sizes (marker scan inside a range is
  15 ms); revisit when the chain is read on every turn.
- **Dictionary at every query.** A separate cheap artefact (aggregate terms), not the chain list.
- **`patch` parts are unsearchable** (`if (!text) continue`) — `edit` diffs do not exist for search.
- Pre-existing floating-effect diagnostics in `session/prompt.ts` (documented in `AGENTS.md`).

Residual (named, not silently dropped): `vectors` has no exclusive «older than X» cursor — the
continuation is `last` + `range`, and every row carries its messageID as the address.

## 5. KV note

`messagesearch.txt` and the `Schema.annotate` descriptions ride the tool catalogue in the prompt, so any
description edit is a PREFIX edit. S1 changes an annotation only if the wording needs it — the current
text («'all' (default, every session in the project)») stays TRUE for `parts`, so the minimal edit is
adding `*` as an accepted spelling. (Applied here together with the `corpus: "vectors"` and `last`
extensions of S2.)
