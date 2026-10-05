---
title: Summary Exact handles
owner: Local_Development
last_verified: 2026-09-21
reproduce:
  files:
    - packages/opencode/src/session/prompt.ts
    - packages/opencode/src/session/summary.ts
    - packages/opencode/src/session/sidecar-policy.ts
  commands:
    - cd packages/opencode && bun test test/session/summary-anchors.test.ts test/session/summary-sidecar.test.ts test/session/summary-cadence.test.ts test/session/summary.test.ts
  inputs: A Layer-1 capture range whose messages carry snapshot anchors (or, for the fallback, completed parts carrying filediff shapes — no tool-name filter).
  expected_outputs: A sidecar checkpoint with model summary body plus system-authored file diffs and CodeGraph impact.
---

# Summary Exact handles (snapshot anchors + tool diffs + CodeGraph)

**Critical contract** for Layer-1 `s` rows (`project_checkpoint` / enrichRange).  
Code: `session/summary.ts` (`summaryRangeStartHash`, `mergeAnchorDiffs`, `enrichRange`, `captureMechanical`), `snapshot/fossil.ts` (`diffFull`).

## The producer, restored (2026-09-27)

The 2026-09-22 sidecar removal took the **producer** with the request it made. `enrichRange` survived
with **zero call sites**, and `project_checkpoint` held **0 rows over 870 messages** — so the fold
carried a tail and nothing else, and the code-thread past ~32K was unreachable. The consumer side was
never broken: `renderSummaryBlock` renders such a row, `compact()` collects it from `listAll`, and
`latestOpen()` is what makes the `layer-1` counter a countdown instead of a measure of the window.

What came back: `captureMechanical` (one `s` per turn, no model call, no request built) and
`mechanicalSummaryBody` (the range, the messages' own semantic vectors, the chain, the diff counts).
The body deliberately does NOT repeat the fold's table of contents — a per-message line is a substring
of what `--- Table of contents ---` already prints.

**Trigger and boundary are different things.** The 64K threshold is the OCCASION; the boundary is the
end of the reply (owner: «64к это просто повод для вызова summary… там будет больше чем 64к»). A
crossing that lands mid-turn waits for the turn to finish, and the row then covers slightly MORE than
64K. Gating the WRITE on the occasion is what keeps one row per turn from becoming the norm: the
boundary advances every turn, so an ungated write resets the counter every turn and floods the pool
(measured: 9 rows in 28 minutes, and the `tailNote` debt line printed the same 340-character gap string
once per row until it was capped at `SUMMARY_DEBT_ROWS_SHOWN` addresses plus a count).

**The agent fills the body.** Machine demand plus agent action closes the loop; machine demand alone
left every row unpaid. The debt line says `fill with summaryedit before the fold`, and
`summaryedit.reviseBody` names ONE column, so the structure (`from_id`, `to_id`, diffs, impact) can
never be touched by a fill.

## The chain, and what a token inside it means

`md5` / `prev-md5` / `parent-goal-md5` are a CUT, not only a diagnosis (owner: «хеш это не только
диагностика, это еще и отсечение»). It is an address whose verification costs the carrier nothing —
32 characters that need not be computed to be relied on as a link; the destination checks.

**Nothing verifies the field, so nothing can fail at it.** (Owner, 2026-09-27: «Если хеш посчитать,
я не сгенерить — то механизм не работает, математически верно — практическая ценность 0.») The
consequence is worth stating because it inverts the obvious reading: a token inside the field is NOT a
corrupted address. The field is a LABEL, never a checksum, and a label is not obliged to be anything.
So `エラー` inside `md5` is not a broken link and not an ambiguity for whoever follows the link — they
take the label and go. What it is: an observation about the generation, in the place nobody expects one.

**So this is self-diagnosis, and it is nearly free** (owner: «архи полезная вещь просто перечитываешь
окружающие сообщения и ловишь свои баги. Это намного проще чем потом править код»). Measured on one
session's own rows (2026-09-27, 123 vectors): exactly two carried a non-hex fragment —
`b7e93f0a5c26d8エラー` (a word, which also ate the head of the `prev-md5` line) and
`7e4b1a90c6d28f35a9e0c7d1b2f38m45` (one letter at index 31). Both are situational, so the fragment
names the state the model was in, and the history is then searchable by that fragment.

NOT the context: the `エラー` token appears nowhere earlier in the database, in any part of any role —
the model produced it first. Context frequency ranked the other way (`Error` 353×, `ошибка` 106×).
~ Owner: «частотный токен ошибки из распределения» — consistent with that, not established.
UNKNOWN: the mechanism, and nothing here can settle it, because a label that is never computed cannot
be checked for what it should have been.

**Therefore the reader is a COVERAGE COUNTER, not a defect detector.** One number, two columns:

| Condition | What it counts | Where |
|---|---|---|
| `absent` | no `md5:` line — the node carries no label, so the state graph has a hole; recovery across it is Guess | `memory/spine.ts` |
| `leaked "…"` | the line is there and holds a token — a generation observation, named so it can be looked up | `memory/spine.ts` |

Neither wears the `⚠ DECLARED CHAIN BREAK` marker: that marker means a vector CONTRADICTS its
predecessor, and marking an absence the same way teaches a reader to ignore it. And a clean 32-hex
value is never judged — @SV_FORMAT makes randomness undecidable from the text, so the reader may
report absence and a token, never suspicion.

**Pattern traps, all three paid for on the same day.** `LIKE '%md5: 0%'` matches the tail of
`parent-goal-md5:` and reported 81 broken hashes that did not exist; a `LIKE` over a whole part
matched PROSE quoting the fragment rather than the field; a 40-char window swallows the JSON `\` before
`\n`, so conforming hashes read as malformed. Anchor to the line start and read the field, not the part.

**The range diff derives from the snapshot anchors the undo/redo chain already stores** (2026-09-21):
`step-start`/`step-finish` carry the turn's baseline and `patch` parts carry the pre-write context, so ONE
fossil diff (anchor → working copy) answers what the whole worktree did in the range — shell-made edits,
deletions and renames included. Tool filediffs (from any completed part carrying them) are merged on top (they backfill snippets
where the chain ships stats only and carry paths the chain has not taken in yet) and are the whole answer
where no anchor resolves. See [fossil-snapshot.md](fossil-snapshot.md) for the chain itself.

---

## Content vs summary

```text
Content M:  [m m m] …     ← never polluted by s
s in DB:         s1 …     ← outside content; only compact → m*
```

---

## Exact sources (anchors + merge)

```text
range messages (from_id..to_id)
  → summaryRangeStartHash: first anchor in range, else last anchor before it
  → Snapshot.diffFull(anchor)  — fossil <anchor> → working copy (whole worktree)
  → mergeAnchorDiffs(anchored, collectToolFileDiffs(range))
  → CodeGraph impact on the merged file paths (worktree-relative)
```

| Piece | Source |
|-------|--------|
| Range start | `summaryRangeStartHash` — the undo/redo anchors stored on the range's parts |
| Diffs | `Snapshot.diffFull(anchor)` merged with tool filediffs (any completed part) |
| Impact | `mcpTouchThenSqlitePack(worktree, files)` — merged paths |
| No anchor | tool filediffs alone (old rows, `snapshot: false`, recreated repo) |

---

## Pipeline (stop)

```text
await Checkpoint.persist
  → sidecar LLM:
       messages = byte-stable checkpoint M + summaryRequestProse(lastSv)
       system/tools/providerCacheKey = trunk identity; Constitution denies execution
       outputTokenMax = 32k (16K reasoning window + 16K stored answer; floor);
       quality gate isValidSummaryBody (deep sections)
       finish-step = cache/tokens/cost/duration log + session-total accounting
  → enrichRange: anchored range diff + tool merge + CodeGraph
  → save s (outside M)
  → compact only later (usable model; not same stop as new s)
```

The model request uses full checkpoint M for provider-prefix reuse; the Exact
enrichment still scopes only to the new `from_id..to_id` range. One targeted
gap-fill retry is allowed. Failed and successful cycles share the same cooldown.

---

## Tests

```text
summary-anchors.test.ts — resolver, merge, LIVE anchored range (a shell-made file with no tool part)
summary.test.ts — collectToolFileDiffs / range slice / anchors
summary-exact-live.test.ts — tool fallback → enrichRange; CG on monorepo files
```

---

## Claim ledger

| Claim | Mark |
|-------|------|
| s outside content | Exact |
| range diff from the stored anchors (whole worktree) | Exact |
| tool filediffs merge (unseen paths, snippets) | Exact (session DB) |
| CodeGraph over the merged file list | Exact when index/MCP available |
| no anchor ⇒ tool filediffs (unchanged fallback) | Exact |
