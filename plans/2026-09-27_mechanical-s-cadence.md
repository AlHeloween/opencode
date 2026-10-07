# Mechanical `s` cadence — restore the Layer-1 summary without a model call

<!-- intention: the 2026-09-22 removal took the model call AND the mechanical half with it — `enrichRange` has zero call sites, `project_checkpoint` holds 0 rows over 870 messages, so the fold carries memory + a tail and the code-thread past ~32K is unreachable -> every 64k of work writes a mechanical summary (semantic-vector list + the range's messages + fossil/tool diffs + CodeGraph impact) with no model call, the owner can READ it as a panel, and the fold carries its three layers again -->

## HANDOFF 2026-09-27 03:35 — everything works. The duplication was MY MEASUREMENT, not a defect.

**There is no gate defect. Do not go looking for one.**

```sql
-- the count that counts panels, and only panels
SELECT COUNT(*) FROM part
 WHERE data LIKE '%"type":"text"%' AND data LIKE '%"text":"=== LAYER-1 SUMMARY ===%';
-- real_panels = 1 · first 03:24:45 · last 03:24:45
```

## VERIFIED BY THE FOLD, 2026-09-27 03:38 — the three layers are back, by address

The fold was the only oracle left for "the third layer is back", because the layer only becomes
visible when `m*` is rendered. It was, and the evidence is addresses rather than impression:

| claim | evidence | differential |
|---|---|---|
| `m*` carries the summaries | **10 `--- Summary N ---` blocks**, #329..#561, each carrying its own row's `checkpoint_id` — block 9 = `ckpt_0e0c58d2a001xmCeYapR3l0D63` (from# 370, to# 477), block 10 = `ckpt_0e0e4ca44001XZrdFuNGM50fyA` (from# 478, to# 561), both matching the DB rows exactly | the earlier live fold printed **no** summary blocks at all, because `project_checkpoint` held 0 rows |
| the `summaryedit` fill survives | block 9's `Constraints & Preferences` and `Key decisions` print my filled text | the fill is not decoration for the panel; it is what the fold itself carries |
| the fold materializes | all 11 rows now have `time_materialized` set (`is_open = 0`) | the debt closed itself at the fold, not by hand |
| one row is not in the head | row 1 (`ckpt_0e079be0f001M55eySXco0B8tT`, from `msg_0e02dab0…`) predates the retained head and survives as the fading link only | 10 of 11 render; the oldest is outside the head's range, which the range accounting states (`summaries: #329..#561`) |
| the Goal gate fires on COUPLING, not position | the head reads `goal (plan): UNKNOWN — 2 plans state an intention and this window is coupled to none of them; nothing here may name one by position`, and `coupling: 0` | before the fix the same fold named `2026-09-24_to-be-confirmed-shelf-triage`, a plan the owner never set |

**The last row is live evidence for `plans_completed/2026-09-26_fold-carrier-integrity.md` T1**, and it is
behaviour, not a closing artifact: whether that box can close is a code read against its acceptance,
not this head. Recorded here so the next cycle does not re-derive it. (T1 closed 2026-10-08 — the
single-ACTIVE-plan case is now gated on coupling too; the run ids are in that plan.)

**`--- Window topics ---` is still degenerate in a milder form:** `current-sv×30` against six terms at
1-2. The carrier counts how many vectors carry a term in their own top-3, and I write `current-sv`
into every reply, so the histogram ranks my habit rather than the window. Not fixed here; it belongs
to whatever owns the topics carrier.

**What I reported as a residual does not exist.** I counted "19 panels for 11 rows" with
`data LIKE '%LAYER-1 SUMMARY%' AND data LIKE '%synthetic%'` — and that filter matches **my own dbread
calls, whose SQL quotes the very pattern**. Reading back what it matched showed `"tool":"bash"`,
`"tool":"edit"`, `"tool":"dbread"` where the checkpoint id should be. The gate fired ONCE, on the one
occasion a row was created. `latestOpen` vs `listAll` is immaterial; that change is harmless and
arguably more correct, but it fixed nothing.

Three diagnoses were built on that number and all three are void. The panel works, the cadence works,
the debt line works. Nothing is outstanding on the gate.

**The instrument trap, fourth instance today, and the most expensive one:**

| trap | result |
|---|---|
| `LIKE '%md5: 0%'` | matched `parent-goal-md5:` → 81 "broken hashes" that did not exist |
| `LIKE '%b7e93f0a…%'` | matched my own prose quoting the fragment |
| `LIKE '%=== LAYER-1 SUMMARY ===%'` | matched my own tool calls → a phantom defect, a handoff, and a refusal to fix a gate that was never broken |
| **rule** | **a filter must be checked against what it MATCHED, not against how many rows it returned.** `substr` on the first hit costs one query and settles it. |

**Still open, and real:** the two cosmetic defects fixed in code but not yet in a build (the
`plural()` compound argument, and the status renderer reading the next `## ` as a section's content —
the BODY was correct, the reader was not); `plan_state` NULL on rows written before 03:00;
`Next Steps` listing tasks already done until the plan boxes were marked `[x]` (done, committed);
`processor-effect.test.ts` UNKNOWN, no baseline, hangs with 0 bytes, 868 lines, no file-level
`setDefaultTimeout`; `docs/compaction.md:762` and `:765` still carry two `Match` rows describing code
that has no call site.

**Built and PROVEN live** (the mechanical summary cadence, candidate 10.0.1130+):

| step | evidence |
|---|---|
| `captureMechanical` writes a row on the 64K occasion | `project_checkpoint` went 0 → 10 rows; the gate holds between occasions (measured: 0 new rows in 53 min while `layer-1` climbed 3 364 → 63 351) |
| the body is 9 sections, 7 filled from system-Exact sources | row `ckpt_0e0c58d2a001xmCeYapR3l0D63`: 7 458 chars, `diffs` present, `impact` present, `plan_state` **present** (the earlier rows have `plan_state` NULL — the differential that proves the change landed) |
| the range is 64K-plus, as specified | that row: 108 messages, 70 035 chars, 6 files `+47 −22` |
| `summaryedit` fills a row and the debt retires | `ckpt_0e0838b7a001tFGjE3zN4vJ3NQ` 586 → 2 819 chars, `no gaps — folds into the next m* as-is`; replaced body kept in `.opencode/data/summary-revisions/` |
| the TUI renderer was never removed | `LAYER1_SUMMARY_MARKER` + `isLayer1SummaryMessage` alive; `cli/cmd/tui/routes/session/index.tsx:1938-2023` renders `<Show when={isLayer1Summary()}>`. Only the PRODUCER was cut, in `51afd6c2e6`, with the model call. |
| tests | `test/session/mechanical-summary-body.test.ts` — 13 pass; with `summary-cadence` — 42 pass / 0 fail; `bun typecheck` exit 0 |

**NOT working: the panel never appears in the TUI, and the owner sees nothing.**

Latest measurement, and it REFUTES my third diagnosis:

```
rows 10 · panels 16 · newest row 02:50:38 · open_rows 10
```

`open_rows = 10` — **no row is materialized**, so `latestOpen` was NOT `undefined`, the boundary did NOT vanish, and the "vanishing boundary" theory is wrong. Panels still grow one per turn with no new row.

**Three diagnoses attempted and all three refuted.** Do not repeat them:

1. *"The gate sat beside the write instead of on it."* — it was on the write; the flood was real but this was not the mechanism.
2. *"`save` conflicts and RETURNS the existing row, so `if (row)` passes forever."* — true in isolation, and the guard `row.toMessageID !== previousBoundary` was added for it. The guard is in the running build and the panel still grew.
3. *"The boundary vanishes because `latestOpen` filters `time_materialized IS NULL`."* — **refuted by `open_rows = 10`.** The `listAll(...).at(-1)` change is harmless and arguably more correct, but it is not the cause.

**The open question, stated as a question:** with `open_rows = 10` and `latestOpen` returning the newest row, why is `row.toMessageID !== previousBoundary` TRUE on a turn where no new row is created? Either the range's `to` is advancing and `save` is conflicting on something other than `(session, from, to, predecessor)` — read `IncrementalCheckpoint.save` (`:75-109`) and its `UNIQUE` key again — or the panel is being written by a SECOND call site. **`formatLayer1SummaryDisplay` has exactly one caller in `src`; verify that against the running binary, not against the source, because the running binary is what wrote the 16 panels.**

**Instrument traps paid for three times today, all the same shape** — a `LIKE` over a whole `part` is a claim about the FIELD, not the field:
- `LIKE '%md5: 0%'` matched the tail of `parent-goal-md5:` → reported 81 broken hashes that did not exist.
- `LIKE '%b7e93f0a…%'` matched my own PROSE quoting the fragment.
- `LIKE '%=== LAYER-1 SUMMARY ===%'` matched my own replies → 9 "panels" of which 13 were prose. Add `AND data LIKE '%synthetic%'` to count real ones.

**Also open, unrelated to the panel:** `plan_state` NULL on rows written before 03:00; `Next Steps` in those rows lists tasks already done because the plan boxes are not marked `[x]`; `processor-effect.test.ts` is UNKNOWN (no baseline, hangs with 0 bytes — 868 lines, no file-level `setDefaultTimeout`); `docs/compaction.md:762` and `:765` still carry two `Match` rows that describe code with no call site.


from_state: `compact` produces `<memory>` + a table of contents + a ~32K tail. No `s`, no diffs, no CodeGraph reachability. Work older than the tail is unreachable except through VCS, which does not carry decisions.

to_state: crossing 64k of content writes one `s` whose body is assembled entirely by the machine; `summaryedit` remains the only model entry and is reachable only from the `tailNote` demand line; `m* = memory + s (≤32K) + recent (≤32K)`.

## Evidence (measured, this session)

| Fact | Instrument |
|---|---|
| `project_checkpoint` = 0 rows; DB holds 4 sessions / 870 messages / 4098 parts | `dbread` |
| `IncrementalCheckpoint.save` has no call site | `grep` over `src` |
| `enrichRange` exported (`summary.ts:640`, `:662`) with no call site | `grep` over `src` |
| the only surviving diff path is `collectToolFileDiffs` → `user.info.summary` (`summary.ts:555,560`) | read |
| call sites dropped in `bff5f50f7a`, code deleted in `51afd6c2e6`, remainder in `73d78e4138` (all 2026-09-22) | `git show --stat` |
| `sinceSummary` counts the whole window when `boundary` is undefined (`compaction.ts:609-616`, printed at `:846`) | read |
| `m*` is ~64K by design; the fold must stay window-fill, the 64K is the SUMMARY cadence (`compaction.md:709-710`) | read |
| `docs/compaction.md:762` and `:765` mark as **Match** two behaviours that no longer hold | read |

## Tasks

- [x] **T1 — mechanical writer.** `session/summary.ts` gains `captureMechanical`: `enrichRange` (fossil anchor → working copy, merged with tool filediffs) + CodeGraph impact, the body from `mechanicalSummaryBody` (`session/compaction.ts`), persisted through `IncrementalCheckpoint.save`. `id/id.ts` gains the `checkpoint: "ckpt"` prefix — `tool/summaryedit.txt` and `tool/messagesearch.ts` both document `ckpt_…`, and nothing minted it. **Proven live:** 11 rows, the newest `ckpt_0e0e4ca44001XZrdFuNGM50fyA` at 894t with `diffs`, `impact` and `plan_state` all present; 13 tests in `test/session/mechanical-summary-body.test.ts`.
- [x] **T2 — mount on the 64K cadence.** `session/prompt.ts`, beside `checkpointDue` (`:2441`): the same content measure against the newest `s` decides, the range is sliced from that boundary, and `captureMechanical` writes the row. No request, no provider, no retry counter. `agent` uses `checkpointAgentName ?? cacheAgent.name` — `undefined` there means "primary-mode identity", and the column is NOT NULL. **Proven live:** the gate holds between occasions (0 new rows in 53 min while `layer-1` climbed 3 364 → 63 351) and fires at the threshold.
- [x] **T5 — the panel the owner can read.** `formatLayer1SummaryDisplay` restored (`session/compaction.ts`) and called from the mount: a `synthetic + ignored` message carrying `=== LAYER-1 SUMMARY ===`, which the TUI has always rendered via `<Show when={isLayer1Summary()}>`. Only the producer was cut in `51afd6c2e6`, with the model call. **Proven live:** the owner saw the panel at 03:25:54, and `real_panels = 1` — one panel, on the one occasion a row was created. The "19 panels for 11 rows" in an earlier revision of this line was my own bad `LIKE`, retired in the HANDOFF above.
- [x] **T3 — close the false `Match` rows.** The task said "two rows, `:762` and `:765`". **Both the count and the line numbers were wrong, and the plan understated the job by three rows.** Measured against the code, FIVE rows of the gap table described the world between 2026-09-22 and 2026-09-27 — the interval in which the producer was gone:
  - `:755` `s` not in content window — claimed no panel is built; `prompt.ts:2583` builds one.
  - `:757` After checkpoint — claimed "no capture runs on any path"; `prompt.ts:2546` calls `captureMechanical`.
  - `:758` Range diffs — `enrichRange` had zero call sites; `summary.ts:712` is now its only caller.
  - `:761` Checker after summary — claimed nothing calls the checkers on a new row; `compaction.ts:833` calls `diagnoseSummaryGaps` per open row.
  - `:765` `m* = [s,s,recent m]` — claimed "zero summaries -> tail-only m*"; the 2026-09-27 03:38 fold printed **10 summary blocks**.
  `:762` (Summary generation/accounting) is still accurate and was left alone. All five now state the code, cite the file:line, name this plan, and mark the interval they were wrong for rather than silently flipping the status.
- [x] **T4a — regression on the WRITER.** `test/session/mechanical-writer.test.ts`, 5 tests on the real `SessionSummary.layer` against a real `project_checkpoint` row — no mocks, and the diffs are the `metadata.filediff` a completed `edit` really leaves, read by the real `collectToolFileDiffs`. 47 pass / 0 fail with `mechanical-summary-body` + `summary-cadence`; typecheck exit 0.
  - one call -> exactly ONE row, `ckpt_` prefix, `from`/`to` the range's own ids, `diffs[0].file` the edited path and its patch intact;
  - **a SECOND call over the same range adds no row** and returns the SAME id. This is the invariant the "19 panels" phantom was guessing at from prose — asserted, so the next duplicate is a red test rather than a number somebody re-derives;
  - a one-message range writes nothing (`from === to` guard);
  - the negative claim gets a FAIL-CAPABLE instrument: `summary.ts` imports no `llm`/`prompt` module, and `captureMechanical`'s own BODY matches no `streamText|streamObject|LLM.|SessionPrompt.|SessionProcessor.`. The body is checked, not the comment above it that claims «No provider is contacted».
  - Two measured constraints the first draft got wrong, both now in the file's header: `db.ts` holds the store in a LOCAL context (so `listAll` after the run throws «No context found for database» — reads belong inside), and `project_checkpoint.session_id` is a FOREIGN KEY (so the session row must exist; `enrichRange` alone needs none, and generalising from a test that only calls `enrichRange` is what wrote the FK failure in).
- [ ] **T4b — regression on the THRESHOLD CROSSING.** STILL OPEN, and 2026-09-27 turned this entry's own "UNRESOLVED, two candidates and not measured" note into a measurement. What the test claimed is now false BY NAME: `prompt.test.ts:874` was titled «crossing the Layer-1 threshold» and asserted `expect(IncrementalCheckpoint.listOpen(session.id)).toHaveLength(0)`.
  - **WHY NO ASSERTION COULD HAVE CAUGHT IT — the durable half.** `save` inserts the row with `time_materialized` NULL (its input type is `Omit<Record, … "timeMaterialized">`, `incremental-checkpoint.ts:75`), so a WRITTEN row is OPEN and a row never written is trivially open-free. `listOpen === 0` therefore holds in BOTH worlds. An oracle that cannot fail is not a weak oracle, it is a claim — the same finding as the divergence reporter, on a surface nobody had looked at.
  - **MEASURED** (run `20260927T130742Z_67c98fc3`, a probe that prints all five numbers on failure): `chars: 280 840` → `computeOpenWindowTokens` = `open: 70 210` against `threshold: 65 536`, and `rows: 0`. **The occasion is TRUE and the row is still absent, so the counter is not the problem.** That REFUTES candidate 1 outright (BPE compression: `"x".repeat(280_000)` is counted as content) and candidate 2 as well (`visibleAfter` does carry the message — all 280 840 chars of it). Both candidates this entry carried are closed by one measurement.
  - **WHERE THE PATH ENDS — one level up from where the old note looked.** The whole Layer-1 block sits inside `if (result === "stop" || completedCleanly)` (`prompt.ts:2429`), with `completedCleanly = result === "continue" && finished && !handle.message.error` (`:2427`). `layer1Due` (`:2518`) IS at the same level as `checkpointDue` — the old note was right about the siblings — so the open question is whether this scenario enters `:2429` at all. UNPROVED, and now the only thing left.
  - **PRODUCTION IS NOT BROKEN, and the log says so with an address:** `layer1 summary panel written` for `ckpt_0e222b777001wiAa28aie4XUg9` at 2026-09-27T09:12:01Z. My first reading of the red test was «the crossing writes nothing» — a LIVE defect — and that log refuted it. T4b remains what it was: having the gate under a test, not repairing the gate. What changed is that the two candidates are closed and the block is located.
  - **The test was RENAMED, not deleted** (`20260927T131050Z_0ab54c29`, 1 pass / 0 fail): «a 70_000-token turn issues NO sidecar model request» — what it actually proves. A test whose title claims coverage it does not have is the same lie as a carrier quoting a panel, and both are fixed the same way: make the claim match the evidence. `test.todo` was deliberately NOT used — it never runs its body, so it would hide the gap instead of naming it.
- [x] **T6 — a diff remembers the TURN that produced it.** Owner's question, 2026-09-27: «есть ход — что мы правили тогда». The retrieval half already existed (a `project_checkpoint` row carries `file, patch, additions, deletions` per entry, plus a CodeGraph `impact` computed FROM those paths — measured `impact.from="tools"`, `impact.to="summary-range"`, 7–40 impacted files per row). What did not exist is ADDRESSING BY TURN: the rows are per 64K RANGE, and `enrichRange` merged a turn's diffs into the range's, so the turn attribution was destroyed at write time.
  - **The turn id is `parentID`, in one hop, with no walk and no join** (`turnRootId`). Measured across the WHOLE database: 1159 assistant messages, every one parented to a `user` — zero assistant→assistant, zero orphans. A turn is a flat fan-out from one user message. `Turn` in `session/turn.ts` is a NUMBER (a user-message count) and is the wrong thing to address by: it renumbers when a user message is inserted above, which is the shift problem one level up.
  - The key rides INSIDE the stored diff object, not a new column: `incremental-checkpoint.ts` reads `diffs` with no parse and no schema decode (`diffs: row.diffs ?? undefined`), so an extra key survives the round trip and no migration is involved.
  - **The one real trap, and it is the reason a naive version would have shipped a silent defect:** `mergeAnchorDiffs` keeps the ANCHOR entry for any file fossil also sees, and took only the patch from the tool metadata. Tagging tool diffs alone would therefore have dropped the turn from exactly the files an `edit` touched — the more reliable the diff, the more silently it would have erased the question it was collected to answer. The merge now carries `turn` across (one statement, both keys, because `FileDiff` is readonly).
  - `turn` is OPTIONAL and its absence is meaningful: an anchor-only diff describes the whole RANGE, so absent means «not attributable to one turn», never «belongs to no turn». Pinned by a test.
  - Tests: 4 new in `mechanical-writer.test.ts` — `turnRootId` for both roles, `collectToolFileDiffs` tags, the merge carry, and the absent case. 28 pass / 0 fail with `summary-anchors` + `mechanical-summary-body` (run `20260927T042056Z_69193967`); typecheck exit 0 (`20260927T042128Z_d419c2eb`).
  - **The durable half is the commit message, not a source comment.** `.opencode/data` is gitignored, so a row can vanish; a `turn: msg_…` line in the commit body survives and is greppable with `git log --grep`, and it carries the COMMIT, which a comment in the source cannot. A marker per edited line was considered and declined: it adds a diff to maintain the marker, and the grain it would carry is already carried by the id.
  - Recipe, once rows exist with `turn`:
    ```sql
    SELECT pc.id, json_extract(j.value,'$.file'), json_extract(j.value,'$.patch')
      FROM project_checkpoint pc, json_each(pc.diffs) j
     WHERE pc.session_id = ? AND json_extract(j.value,'$.turn') = ?;
    ```
  - **T6b — `sv`: the anchor is the last `@SV_FORMAT` label, not a message id** (owner, 2026-09-27: «надо не id кидать а последний md5 из sv — вот это anchor… ведь реальный ход это от sv до sv, сообщений в промежутке может быть пачка»).
    - **The unit is right and the measurement proves it is sparse on purpose**: 90 of 594 assistant messages in this session carry a label; the other 504 are tool-call carriers with no text. A field on every message would be a message id in costume — the label marks the END of an exchange and the bundle between labels is the payload.
    - **Rule**: a labelled reply CLOSES the exchange, so the edits it made take that label; an unlabelled message's edits take the LAST label seen. One running variable in `collectToolFileDiffs`, linear, no second pass. Pinned by 3 tests, including the fallback — the naive «each diff takes its own message's label» would leave every tool-call edit unattributed.
    - **`sv` is a handle, not a key.** It is never computed, so it can carry a leaked token (two measured this session) and two labels can collide. Stored next to the system-minted ids, that costs an ambiguous lookup, never a corrupted record. As a PRIMARY key it would be unsafe — which is why `turn` stays.
    - `mergeAnchorDiffs` carries `sv` across exactly as it carries `turn`.
    - **A gap found while writing it**: the `multiedit` branch called `take()` with no anchor at all. `multiedit` is one of the most-used tools here, so that would have been the COMMON case carrying nothing — a silent partial, not an edge. Fixed.
    - **Convention from here on: a commit body leads with the last `sv` label**, because that is the anchor that survives. `.opencode/data` is gitignored; the commit is not. `git log --grep <md5>` → the commit → the exact change.
    - 18 pass / 0 fail across `mechanical-writer` + `summary-anchors` (run `20260927T042440Z_6e92091a`); typecheck exit 0 (`20260927T042435Z_fb6a29bf`).
    - **NOT yet live**: no row carries `turn`/`sv` until the owner rebuilds, and the rows already written cannot gain them — the attribution was lost at merge time and is unrecoverable except by re-reading the messages.
  - **T6c — a row's sv identity is the PAIR, not the last label** (owner, 2026-09-27: «sv и его md5 — это главное мерило, отражение цифрового намерения, всё что в промежутках — локальная активность. Потому что могут быть брейки, могут быть уточнения»).
    - **This corrects my ordering, not just my code.** `turn` was built FIRST and is, by the doctrine, exactly the «local activity» the doctrine excludes: a clarification or a break inside one user message splits that bucket. `sv` therefore sits BESIDE `turn` and outranks it — `turn` is the convenience bucket, the label is the address.
    - The body carried only `Last label:`, so a range said where it ENDED and never where it BEGAN. A range could not be found by the label it starts on, and two ranges could not be chained label-to-label — which is the only chaining that survives a break or a clarification. Now `Labels: first <md5> · last <md5>`.
    - `from_id`/`to_id` remain the LOCAL coordinates (they shift if messages are inserted above); the label pair is the GLOBAL one (it does not).
    - Two test assertions moved with the line, because when behaviour moves its suite moves in the same change: `Last label: ${A}` -> `Labels: first ${A} · last ${A}`.
    - 25 pass / 0 fail across `mechanical-summary-body` + `mechanical-writer` (run `20260927T042714Z_630b6bda`); typecheck exit 0 (`20260927T042709Z_a67ed219`).

## Run log

### Why this exists, in the owner's terms (2026-09-27)

- **Points vs edges.** `memory` holds POINTS — facts, decisions, addresses. A summary holds
  **EDGES** — what followed what, which diff, which plan task closed, where the chain broke. Losing
  an edge is not a rounding error: it forces `project exploration` from scratch, and project
  exploration is what the whole apparatus exists to avoid.
- **Why a model call cannot replace it.** A model told to retell 500K tokens compresses with
  losses, and the losses are the long-tail edges. A mechanical summary does not retell — it
  ADDRESSES: `md5 → prev-md5` restores order, the diffs say what changed, the messages stay
  reachable by id. Edges are not compressed, they stay addresses.
- **Why RAG was left.** RAG retrieves by similarity, which yields points. Once the semantic vectors
  carry `md5`/`prev-md5`, the transformer inherits the state graph from the chain itself at minimal
  load, so a vector store would be paying for what the chain gives free. RAG earns its cost only on
  raw code with no vectors.
- **Why the fill is mostly MACHINE.** A summary exists so the SYSTEM writes most of it; otherwise
  every row becomes handwriting and the token bill follows. Measured 2026-09-27: the mechanical
  body filled 0 of the 9 sections the validator wants, so filling one row by hand cost 2 819 chars
  against 586 machine-written. Eight of the nine are derivable; only `Key decisions` needs a judge.
- **Why the fold stays mechanical.** You are already oriented when it happens — the chain and the
  vectors are already in the window. Asking a model to summarise at the boundary is the slowest
  possible way to do what a format can do exactly.

### Decisions taken

| # | Decision | Owner |
|---|---|---|
| D1 | TRIGGER and BOUNDARY are different: 64K is the OCCASION, the end of the reply is the BOUNDARY. A crossing mid-turn waits for the turn to end, and the row then covers slightly MORE than 64K. | «64к это просто повод для вызова summary… там будет больше чем 64к» |
| D2 | The write is GATED on the occasion. Ungated it produced one row per turn — 8 rows in 15 minutes — because the boundary advances every turn and the counter resets with it. | measured, agreed |
| D3 | The debt line is ONE line with a count and at most `SUMMARY_DEBT_ROWS_SHOWN` addresses. Six unpaid rows once printed the same 340-char gap string six times. | measured |
| D4 | The agent initiates the fill when `tailNote` demands it. Machine demand + agent action closes the loop; machine demand alone left the debt unpaid forever. | «сам ты его инициировать не можешь — это неправильно» |
| D5 | Local trivia goes into a summary; `memory` gets a LINK and a short note, not the detail. | «если ты не хочешь забивать свою memory локальными приколами, то делаешь summary и в память ссылку на него» |


| Run | Command | Result |
|---|---|---|
| `20260927T005547Z_bd2d58ac` | baseline: `bun test summary-cadence summary-anchors` | **35 pass / 0 fail**, 5.32s |
| `20260927T005853Z_9d13ea47` | `bun typecheck` after T1/T2 | **exit 2** — 6 errors, all mine (1 agent type, 5 service mocks) |
| `20260927T010004Z_acecb614` | `bun typecheck` after the fixes | **exit 0** |
| `20260927T010118Z_d0208425` | `bun test summary-cadence summary-anchors` | **35 pass / 0 fail**, 9.39s — matches baseline |
| `20260927T010158Z_e710c494` | `bun test processor-effect` alone | **UNKNOWN** — 0 bytes written, no exit. 868 lines, `TestLLMServer` + `CrossSpawnSpawner`, and NO file-level `setDefaultTimeout`. No baseline exists for this file, so it is not attributable to this change in either direction. |

**Instrument class recorded here:** `stdout_text.log` shows only the banner while `state.json`
reports `exit_code: 2` — tsgo's diagnostics land in `stdout.log` (raw ANSI), not in the text
render. A `stdout_text.log` that looks clean is NOT evidence that a run passed; read
`state.json` for the exit code and `stdout.log` for the diagnostics.

## Open decision (owner) — carries into T1

`isValidSummaryBody` / `diagnoseSummaryGaps` require body ≥200 chars, per-section minima and ≥1 decision bullet. A purely mechanical body will not satisfy them by construction, so every summary arrives with `gaps` and `tailNote:749` demands a fill. Either that is the intent — the machine drafts, the model fills on demand — or the validator must learn a mechanical shape. Not decided here.

## Risks

| Risk | Containment |
|---|---|
| the writer fires mid-turn and disturbs the boundary | mount it on the same stop path as `checkpointDue`, after the checkpoint is durable |
| `materialize()` (`compaction.ts:2211`) consumes rows in a way the fold did not expect | read before writing; the fold is the one consumer |
| the counter's name and space disagree with its new meaning | rename only if the row is confirmed dead; a rename is not a fix |

## Smoke Tests

Baseline, before any edit (record the result):

```
cd packages/opencode && bun test test/session/summary-cadence.test.ts test/session/summary-anchors.test.ts
```

Post-change oracle, per the canon's own reproduce block (`docs/summary-exact-handles.md:5-13`):

```
cd packages/opencode && bun test test/session/summary-cadence.test.ts test/session/summary-anchors.test.ts test/session/summary-exact-live.test.ts
cd packages/opencode && bun typecheck
```

Decisive predicate, not a typecheck: `SELECT COUNT(*) FROM project_checkpoint` for the session rises from 0 after crossing 64k, AND the provider request count for that turn is unchanged.
