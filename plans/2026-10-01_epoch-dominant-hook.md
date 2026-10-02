<!-- intention: «the summary body is written by one machine function and carries its dominants as prose inside `Labels:`, while BOTH readers of the epoch-level hook (`memory/spine.ts:extractDominant`, `compaction.extractSemanticVector`) require a `dominant:` FIELD — measured on the live DB 2026-10-01: 23 summary rows, ZERO carrying the marker, so `messagesearch { corpus: "summaries" }` printed `(no dominant)` for every epoch and its `dominant:` second query could never match» -> «every epoch the writer stores carries a real `dominant:` field, read back by the same reader the spine uses, so the second query — the manual's own TEST REMEMBERING — finds the epoch by the vocabulary the work was conducted in» -->

# The epoch's dominant hook — the writer must write the field the readers read

- **plan_id:** 2026-10-01_epoch-dominant-hook
- **revision:** 1
- **state:** ACTIVE — D1–D3 confirmed, S3 owed
- **found by:** the owner's GMS material (2026-10-01) plus a live measurement on `project_checkpoint`:
  23 rows for this session, `body LIKE '%dominant:%'` → **0**, `%Semantic dominant%` → **0** ✓
- **kind:** STABILIZE — a measured defect of an existing surface (reader and writer disagree on one field)

## The defect, pinned

`mechanicalSummaryBody` (`src/session/compaction.ts:1412`) renders the `## Semantic Vector` section and
is its ONLY writer. It emitted `Chain:`, `Labels:`, `Weights:`, `Target asked:` — and never the field.

- Reader one: `extractDominant` (`src/memory/spine.ts:299`) — `body.indexOf("dominant:")`, FIRST
  occurrence. Fed by `tool/messagesearch.ts:143` for `corpus: "summaries"`.
- Reader two: `extractSemanticVector` (`src/session/compaction.ts:1217`) — inside the section,
  `/dominant:\s*["']([^"']+)["']/`.

Two consequences, both measured:

1. `(no dominant)` on every epoch (23/23) — the spine's hook AND its `dominant:` filter were dead.
2. The `Labels:` line spelled `dominant:` ITSELF whenever the range held exactly ONE assistant reply —
   `plural(1, "dominant")` → `1 dominant: ` — because the count was `speakable.length` (every reply)
   while the list under it was the carriers. A one-reply range with no vector printed
   `1 dominant: none`, and `extractDominant` returned the string `none` as the epoch's hook.

## Tasks

- [x] **D1 — the writer emits the field.** `mechanicalSummaryBody` writes `dominant: "<hook>"` as the
      FIRST line under `## Semantic Vector`, taking the LAST dominant the range carries — the vector the
      next window chains from (the same reason `lastMd5` is half the row's identity). Emitted ONLY when
      a carrier exists: an empty hook would be read as a dominant by both readers, which is worse than
      an absent one, because the spine's `(no dominant)` is a TRUE statement about such a range.
- [x] **D2 — the count counts what is listed.** The `Labels:` line's `${plural(speakable.length, …)}`
      became the carriers' count, so a count of replies can no longer spell the marker.
- [x] **D3 — the round trip is pinned by test.** Two cases in `test/session/mechanical-summary-body.test.ts`
      read the body back through `extractDominant` — the reader that was broken WITH the writer — and
      assert the LAST dominant plus the field's position before `Labels:`, and that a one-reply range
      with no vector spells no marker at all and yields `undefined`.
- [ ] **S3 — the LIVE confirmation, owed against the next promoted binary.** `compaction.ts` is runtime
      source, so a session runs whatever `captureMechanical` its BINARY carries — a fold in this session
      still writes the old body. Lift signal and oracle in one: after a binary carrying this change is
      promoted (the OWNER's step, never mine), the next fold writes one `project_checkpoint` row whose
      body carries `dominant: "…"`, and `messagesearch { corpus: "summaries" }` prints that hook where
      it printed `(no dominant)` for the 23 rows below it.
      *Partial, 2026-10-02 (read-only DB probe, `project_checkpoint` newest rows):* the D2 count axis IS live —
      the row of 2026-10-01T21:36Z (session `…892N7AfF`, the robot's run-lifetime work) reads
      `Chain: 0/79 … · 0 dominants: none.` where the old writer would print `79 dominants` ✓. The FIELD is
      not observable there: the range carried ZERO vectors, so its absence is the correct output, not a
      refutation. S3 stays open until a fold over a range with ≥ 1 carrier.

## Smoke Tests — run, with the prediction made BEFORE each one

| # | oracle | predicted | measured |
|---|--------|-----------|----------|
| S1 | `bun test test/session/mechanical-summary-body.test.ts` (cwd `packages/opencode`) | baseline 15/0/38, then 17/0/42 | baseline **15 pass / 0 fail / 38 expect**, exit 0 (`20261001T093230Z_f447ec32`); after the fix **17 pass / 0 fail / 42 expect**, exit 0 (`20261001T093324Z_2d627fb9`) — the +2/+4 is exactly the two new cases ✓ |
| S2a | MUTATION: the `dominant:` line deleted from the writer | ONE red — the field case; the other 16 untouched | **16 pass / 1 fail** (`20261001T093355Z_217063c7`), red at `extractDominant(out) → undefined`, `Expected: "последний"` ✓ — the pin is fallible on the writer's half alone |
| S2b | MUTATION: the count reverted to `speakable.length` | ONE red — the lone-reply case; the other 16 untouched | **16 pass / 1 fail** (`20261001T093428Z_3173210`), and the failure output reproduces the ORIGINAL defect verbatim: `· 1 dominant: none.` — the count spelling the marker and the value being the literal `none` ✓ |
| S1′ | both mutations reverted | 17/0 back | **17 pass / 0 fail / 42 expect**, exit 0 (`20261001T093453Z_cac11019`) — no residue from either mutation ✓ |

Two mutations, each killing exactly one case, is what makes the pin attributable: the field is pinned by
S2a and the count axis by S2b, and neither mutation moved the other 15 — so the suite discriminates the
change rather than merely tolerating it.

*(Note, recorded because it is a tool observation and not a verdict: S2b's `state.json` reported
`exit_code=-1` while the run printed its complete aggregate line. The instrument reported its own
verdict, so the row stands; the code is a cmd_runner observation to explain, not a lost run.)*

## Residual (named, not waived)

- **S3** — the live confirmation, above; owed to the next promoted binary.
- **Legacy rows (23).** Their bodies are frozen and carry the dominants only as prose in `Labels:`.
  NOT backfilled: the body also holds the two model-written sections (`## Constraints & Preferences`,
  `## Key decisions`) that `mechanicalSummaryBody` does not produce, so a re-render would DELETE them.
  Recovery is the `Labels:` line plus `summaryedit`, by hand, per row.
- **The hook can be poisoned by prose (found 2026-10-02; reproduced on live data the same day — `memory.db`
  `part_index`, session `…Co8CHgZX`: `listDominants`' `instr(text,'dominant:')` admits 66 assistant text parts,
  65 carry a real tail vector, 1 is prose whose «dominant» reads «One line of what this vector is about.\` ✓ То
  есть ноль был свойством **шаблона**…»). Also measured: the spine (level 1) prints `(no dominant)` for
  25/25 existing epochs (24 + 1), so `dominant:` filtering finds nothing in today's history.**
  The per-reply dominant the writer lists comes from `extractMessageDominant` (`memory/spine.ts:431`):
  the LAST `dominant:` anywhere in the text, prose and inline code included. The `Chain:` count uses the
  strict tail-block predicate (`compaction.ts:764`) — two predicates for «this reply carries a vector».
  Seen in the row whose `Chain:` says `5/45` while `Labels:` lists prose fragments such as
  «` — писатель её **никогда не пишет** ✓ Читаю рендерер:» (a reply that only TALKED about the field).
  With D1, the last such fragment becomes the epoch's `dominant:` field. Falsifier: a
  `mechanicalSummaryBody` case whose only reply mentions `` `dominant:` `` in prose and carries no
  vector — predicted: the field is emitted with that fragment (RED against the requirement).
- **`Chain:` counts STEPS as turns (found 2026-10-02, measured on the DB).** «79 assistant turns without a
  vector» counts every assistant ROW, tool-call steps included, while @CURRENT_SV asks for one vector per
  completed TURN. Measured per turn: session `…892N7AfF` — 2 user turns, 107 assistant steps, the closing
  report carries the full block; session `…Co8CHgZX` — 95 turns, 946 steps, 64 turns whose last text
  carries the vector (67 with one anywhere). So `0/79` is a range cut mid-turn, not a robot that omits
  vectors — the denominator is the wrong unit and reads as a false alarm (it misled this very probe).
- **Reader-side legacy fallback: deliberately NOT added.** A reader that fell back to the prose list
  would answer two different questions under one name — the exact shape this defect is an instance of.
