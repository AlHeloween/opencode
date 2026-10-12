<!-- intention: the semantic-vector chain is the only carrier that can rebuild a trajectory after a fold, but it is 8.5% dense, it is read by re-parsing prose, `session: "*"` silently returns nothing, and sessions can be mixed into one list -> the chain becomes readable, addressable and scope-correct: current session by default, `*`/`all` means the whole base, breaks counted inside a session. -->

# messagesearch: the vector chain as carrier, and session scope that means something

**Status:** ACTIVE — 2026-10-11. Owner: «Давай план и понеслась.» Design settled in the same session; every premise below is measured, not assumed.

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
- [ ] **S2 — `corpus: "vectors"`.** A third corpus, read from the EXISTING `part_index` (no new table
      yet): rows are assistant `text` parts carrying the vector marker, projected to
      `{ ordinal, messageID, messageIndex, md5, prevMd5, keywords, dominant }`, **newest first**, `last`
      default ~20, with the address to continue (the machinery already exists: `extractVectorChain`,
      `extractKeywords`, `extractMessageDominant`, `Memory.listDominants`).
- [ ] **S3 — breaks counted inside a session.** In the vectors list, a `prev-md5` that does not equal the
      previous listed row's `md5` is a break; the header prints `N vectors · M breaks`. With `session:"*"`
      the list is grouped by session and a session boundary is NEVER a break.
- [ ] **S4 — silence is not an answer.** A `session` id with no rows in the index must say so
      (`session <id> is not in the memory index`), not `No results found` — the same class as
      «absence of an oracle reads as FALSE».
- [ ] **S5 — gates.** `test/tool/history-filters.test.ts`, `test/memory/*.test.ts` one file per run;
      `bun typecheck` from `packages/opencode`; `_build.ps1`.

## 3. Smoke Tests

| oracle | before | after |
|---|---|---|
| `bun test test/tool/history-filters.test.ts` | PASS (baseline pinned) | PASS + `*` case |
| `messagesearch { session: "*", query: "liveMessages" }` | **«No results found»** (the defect) | same 5 hits as no-`session` |
| `messagesearch { corpus: "vectors", last: 5 }` | unknown parameter → parts mode | 5 newest vectors, newest first, with md5/prev |
| `messagesearch { session: "ses_absent" }` | «No results found» | names the absent session |

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

## 5. KV note

`messagesearch.txt` and the `Schema.annotate` descriptions ride the tool catalogue in the prompt, so any
description edit is a PREFIX edit. S1 changes an annotation only if the wording needs it — the current
text («'all' (default, every session in the project)») stays TRUE for `parts`, so the minimal edit is
adding `*` as an accepted spelling.
