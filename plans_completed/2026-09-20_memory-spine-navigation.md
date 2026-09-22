<!-- intention: the agent's own memory is reachable only by word search over 9 676 indexed parts, so finding a past decision costs a sweep and reading m-star costs ~100k tokens -> the session's semantic dominants form a navigable spine (59 epochs at 4 248 chars) and two queries descend from the spine to the messages, with the excerpt held and the source released -->

```yaml
status: COMPLETED 2026-09-22 — S1–S4 landed 2026-09-20 and were re-verified against the TREE, not
  against this text: `corpus: "summaries"` (src/tool/messagesearch.ts:137), `epoch` (:46),
  `dominants` + `Memory.listDominants` (src/memory/memory.ts:450, call site messagesearch.ts:233),
  `last` (:50), contract src/tool/messagesearch.txt. Unit oracle re-run 2026-09-22:
  `bun test test/memory/spine.test.ts` → 17 pass / 0 fail, exit 0 (run 20260922T122917Z_7c937024).
  S5 (hold/release of the excerpt) was OUT of this plan by construction — it is
  `plans/2026-09-19_temporary-data-acquisition.md`'s task.
```

# Memory spine navigation — find the book by its spine, take the excerpt, put it back

Owner, 2026-09-20 (verbatim):

> «Простым языком: книгу нашел по корешку, открыл, выписал что тебе надо, закрыл и положил
> на полку, все - выписка есть, книги в голове нет и не надо.»

> «Семантические вектора списком. Плюс: goals по желанию.»

> «При желании мы можем спуститься до предложений и вывести сообщения по семантическим доминантам.
> 2 запроса и ты в теме.»

**This is `T9` + `A5` of `plans/2026-09-19_temporary-data-acquisition.md`** (epoch-addressable memory;
acquire a stored record by id) with the missing input shape supplied: **the address is the dominant.**

## 0. Measured — the corpus already exists and is already regular

```
project_checkpoint   59 rows · ALL 59 carry `dominant:` · ALL 59 carry `## Goal`
                     columns: id · session_id · from_message_id · to_message_id · predecessor_id ·
                              provider_id · model_id · agent · body · diffs · impact ·
                              materialized_message_id · time_materialized · time_created ·
                              time_updated · plan_state
spine cost           SUM(length of the dominant line) = 4 248 chars  for all 59  (~1 200 tokens)

part_index           9 676 parts for this session, of which 238 carry `Semantic dominant:`
                     239 carry `Keywords:`  (the two travel together, as @SV_FORMAT requires)
```

Two consequences, both decisive:

1. **No new store and no index.** Extraction is `instr(body,'dominant:')` + `substr` — mechanical on
   100 % of rows. 4 248 chars scans cheaply even at ten times the row count. `part_embedding` sits at
   **zero rows** (designed, never filled) and is not needed: the fork between a field filter and
   embeddings is closed by measurement, not by preference.
2. **The spine costs ~1/80 of one snapshot.** One `m*` part is 390–555 KB (≈100 k tokens); all 59
   dominants together are 4 248 chars. That is the whole of «2 запроса и ты в теме».

## 1. The three levels, and which one is listed versus queried

```
epoch (summary)      → dominant                     ← the spine: LISTED (4 248 chars, all of them)
  message            → dominant + keywords          ← the pages: QUERIED (238 rows, not listed)
    text             → sentences                    ← the lines: reached through a kept excerpt
```

Level 2 must never be listed whole: 238 anchors × ~80 chars ≈ 19 KB, and it grows with the session.
It is reached by a **range** (`from..to` of the chosen epoch, or `tail: N`) or by a **dominant filter**.

## 2. Contract

**Input** — `messagesearch` gains a corpus and a descent, and keeps everything it has.

| field | meaning |
|---|---|
| `corpus?: "parts" \| "summaries"` | default `parts` (today's behaviour, unchanged). `summaries` switches the corpus to `project_checkpoint` |
| `tail?: N` | restrict to the last N messages of the scope (`message_index > max - N`; `message_index` is **per-session** — verified: `min_idx = 1` in every session) |
| `dominant?: string` | match the semantic dominant, at whichever level the corpus selects |
| `goals?: boolean` | also return the `## Goal` head of each epoch (owner: «goals по желанию») |
| `session?` | unchanged, but the **default differs by corpus** — see §3 |
| `query?` | unchanged: FTS5 + BM25 + epistemic hybrid over `part_index` |

**Output — default: a list, one line per epoch, each carrying its address.**

```
#<from#>`..`#<to#>   "dominant"   · agent · model · <checkpoint id>
```

with `goals: true` appending the `## Goal` head beneath its line. Every line carries the range and the
id, so the second query can pull exactly that book.

## 3. Two corpora, two natural defaults — and no documented contract is reversed

`messagesearch.ts:32-38` states the opposite default **on purpose**: «Default stays project-wide:
`messagesearch` exists to find work done in other sessions, and silently narrowing that would turn
"no prior art" into a wrong answer rather than a smaller one.» That reasoning holds for the **parts**
corpus (prior art across the project) and does not apply to the **summaries** corpus, whose chain
(`predecessor_id`) lives inside one session. So:

| corpus | default scope | why |
|---|---|---|
| `parts` | project-wide (unchanged) | `@REUSE_BEFORE` — prior art in other sessions |
| `summaries` | **current session** | this is the agent's own memory; the chain is per-session |

Neither default is flipped; the corpus decides. No accepted design is reverted.

## 4. Tasks

- **S1 — DONE 2026-09-20.** `corpus: "summaries"` returns one line per epoch: ordinal, dominant,
  agent, model, checkpoint id, and the `fromMessageID..toMessageID` address; ordered by
  `time_created`. Read through the existing `IncrementalCheckpoint.listAll` — no raw SQL in the tool.
  Oracle: **live, over all 43 real bodies** (`experiments/2026-09-20_memory-spine/spine-live.ts` +
  its `.out.txt`) ⇒ `epochs=43`, `dominant_present=43/43`, `spine_chars=7040`, against
  `body_chars=634525`. Unit oracle: `bun test test/memory/spine.test.ts` 9 pass / 0 fail; `bun typecheck`
  exit 0. **Deviation, recorded:** the address is the message-id pair, because a checkpoint stores no
  numeric positions — the `#N` ordinals are computed in the spine, not stored.
- **S2 — DONE 2026-09-20.** `goals: true` appends each epoch's `## Goal` head; with the flag off the
  output is exactly S1's. Oracle: `goal_present=43/43` live; the flag is asserted to add, never replace.
- **S4 (partial) — DONE for the spine.** `last: N` keeps the last N units of the selected corpus. The
  parameter is named `last`, **not `tail`**, because one name must not carry two units: at this level
  the unit is the epoch, and for the parts corpus it will be the message. Oracle: `last: 3` on the live
  spine returns epochs 41–43.
- **Constraint found while wiring, and it shaped the output:** `ExecuteResult<M>` infers `M` from
  **every** branch of `execute`, so a tool may not return two different `metadata` key sets — the
  union collapses and omitted keys become `undefined` against `number`. This cost one red typecheck
  (`TYPECHECK_EXIT=2`) and is the same trap already recorded for `recall`. The spine therefore conforms
  to the existing `{query, mode, results}` shape, and the **address travels in the output text**, where
  it is read. Also: a non-empty `query` with `corpus: "summaries"` prints an explicit note that it is
  ignored, rather than silently doing nothing.
- **S3 — DONE 2026-09-20.** `dominants: true` (with `range` for the cheap path, `dominant` to filter,
  `last: N`) returns the message-level dominants of a range: `#index "<dominant>" · role/partType ·
  messageID · partID`. Read through a new `Memory.listDominants`, which restricts to the assistant's own
  `text` parts and excludes `=== COMPACTED ===` snapshots. **Both exclusions are measured, not stylistic:**
  17 snapshots carry the dominants of EVERY summary, and a tool output quotes what it read (the marker
  sat 81 311 chars from the end of one such part). After the restriction: 197 carriers, only 3 with more
  than one marker, marker always ≤2 015 chars from the end — which is why the message level uses the
  **LAST** marker while the epoch level uses the FIRST (`extractDominant` vs `extractMessageDominant`).
  **A range comes first because it is the cheap path, and that is the measurement:** the same marker
  filter over the whole index costs **1 563 ms**, a range query **15 ms**, live **36 ms** for the range and
  **45 ms** session-wide.
  Oracle — live, driving the real functions rather than a copy of the query
  (`experiments/2026-09-20_memory-spine/dominants-live.ts`): the last epoch's range returned **8 carriers**
  of its 37 messages, every one a genuine dominant with its part address; session-wide **245**.
  **Falsifier found by the first run of that very instrument — and it is about instruments, not the tool:**
  the range reported `carriers=0` while session-wide gave 197. Cause **read from state, not guessed**: the
  boundary ids were absent from the index, which held **3 539 of the session's 3 885** messages. The index
  is synced **lazily**, and the tool does it as the first thing `execute` does (`Memory.sync`, `:78`). An
  instrument that calls `listDominants` directly measures the **lag**, not the query — and a zero from an
  unvalidated probe is not a fact. Anything reading `part_index` outside the tool must sync first, or it
  will read stale state and call it an empty result.
- **S4 — the tail window.** `tail: N` honoured on both corpora. Oracle: N = 5 returns exactly the last
  five message indices of the scope, and N larger than the session returns everything, not an error.
- **S5 — the excerpt is held, the source is released.** Hand off to `T9`/`A5`: the chosen body is
  acquired under a declared span (`ttl`) and released to a pointer. **Not built here** — this plan takes
  the spine and the descent; the hold/release path already exists (`ttl` on the part,
  `TempEnable`/`TempDisable`, `recall(…, keep: true)`) and is the TDA plan's task.

## 5. Smoke Tests

- **baseline (before any edit):** `bun typecheck` exit 0 from `packages/opencode`; today's
  `messagesearch` behaviour on a known query, recorded verbatim as the regression reference (the
  `parts` corpus must not move).
- **S1:** the count of returned lines equals the checkpoint count for the session; one line grep-matches
  the dominant stored in the row.
- **S2:** with `goals: false` the output is exactly the S1 output (the flag adds, never replaces).
- **S3:** the same message is reachable by `from#..to#` and by `dominant:`; the ids agree.
- **S4:** `tail: 5` vs `tail: 1000` — the second returns the session, not an error.
- **the decisive one (the owner's own claim):** *two queries from cold to a named decision.* Query 1 =
  the spine; query 2 = the descent. Recorded as the number of calls and the total bytes, against the
  current path (word search → snippets → `sessionread`) on the same question.
- **regression:** the `parts` corpus output for a fixed query is byte-identical before and after.

## 6. Risks and residuals

- **The corpora are stored, not derived.** `part_index` is a synced index (`Memory.sync` on every call);
  `project_checkpoint` is the source. The spine therefore needs **no sync** and the descent inherits the
  index's freshness. A stale index must be visible, not silent.
- **`dominant` is free text written by the model.** Nothing validates it against `@SV_FORMAT`; a
  malformed or missing block simply yields no line for that message. That is acceptable at this level
  (a missing line is a smaller error than an invented one) and is exactly the observability gap `H6`
  keeps open.
- **The fine level grows.** 238 anchors today; the filter is what keeps it usable, and if the descent is
  ever listed whole it will cost ~19 KB. The contract forbids listing it.
- **Deliberately not built here:** S5 (hold/release), any embedding path, and any change to the `parts`
  corpus.
