# One predicate for «this reply carries a vector» + Russian FTS note

<!-- intention: a reply that only MENTIONS `dominant:` in prose yields a message dominant (and, via D1 of the epoch-dominant-hook plan, can become an epoch's hook); FTS misses Russian word forms silently -> a message dominant exists only when the reply carries a real @SV_FORMAT block, by the same predicate the Chain count uses; messagesearch.txt tells the caller how to reach Russian word forms -->

- sv: { keywords: { one-vector-predicate 0.35, prose-poisoned-hook 0.25, message-dominant-reader 0.20, fts-russian-prefix 0.12, robot-task 0.08 },
        dominant: "A message dominant is read only from a real tail vector block, and the search doc names the Russian prefix form." }
- origin: owner, 2026-10-02 — «Да, отдай Смиту пункты 1 и 2» (after the live messagesearch probe recorded in
  `plans/2026-10-01_epoch-dominant-hook.md` § Residual).
- executor: Smit (robot skill, headless `run`, DeepSeek V4.1 Flash); oracle re-run and commit by Claude.

## The defect, pinned (measured 2026-10-02, read-only)

- `memory/spine.ts:431` `extractMessageDominant` = the LAST `dominant:` anywhere in the text (the «last wins» rule
  itself is measured and stays: replies quote other vectors first). `session/compaction.ts:757`
  `hasSemanticVector` = the strict tail-block predicate the `Chain:` count uses. Two predicates, one question.
- Live: `memory.db` session `…Co8CHgZX`, `listDominants` admits 66 parts, 65 carry a tail vector, 1 is prose.
- FTS `porter unicode61` (`memory/memory.ts:77`): мнемотехника 1 / мнемотехнике 2 / мнемотехнику 0 /
  мнемотехник* 5; mnemonic = mnemonics = 3. `messagesearch.txt` does not say this.

## Tasks

- [x] **P1 — one predicate.** Done by Smit (session `ses_f04f93739ffeLlmlvAwnzCtPJV`, DeepSeek V4.1 Flash), verified
      by Claude: `extractMessageDominant` reads only the reply's own `Semantic dominant:` field LINE (last wins);
      `hasSemanticVector` moved into `spine.ts` unchanged and re-exported from `compaction.ts`. Stale fixtures that
      spelled a reply's vector as the summary-body field `dominant: "…"` (0 of 417 live parts) superseded in
      `summary-block-shape.test.ts` (3 tests) and `compaction.test.ts` (the fold-head test) — assertions unchanged.
      Was: A reply with no real vector block yields NO message dominant; a reply with one
      yields its own block's dominant (last wins, unchanged). Consumers move with it: `compaction.ts:1428`,
      `:1783`, `:1989/1993/2010`, `messagesearch.ts:241`.
- [x] **P2 — the doc line.** Written by Smit with the measured numbers; read in the diff by Claude ✓. Was: `tool/messagesearch.txt` states that stemming is English-only and that a Russian
      word is reached by its stem with `*`.

## Smoke Tests — prediction written BEFORE the robot run

| # | oracle | predicted | measured |
|---|--------|-----------|----------|
| B0 | `bun test test/memory/spine.test.ts test/session/mechanical-summary-body.test.ts` (cwd packages/opencode), baseline | 34/0 | **34 pass / 0 fail / 72 expect**, exit 0 (`20261002T051116Z_7de51255`) ✓ |
| S1 | a NEW case: prose-only mention of `dominant:` → `undefined`; fails on the old code | RED before, GREEN after | Smit: new tests vs HEAD source **37/3**, the 3 reds = the new cases (`20261002T052828Z_4118dcc4`) ✓ |
| S2 | the same two files after the fix | 34 + new cases, 0 fail | Claude re-run, 9 files that spell a vector in fixtures: **190 pass / 1 fail** (`20261002T053649Z_359a6a4f`); the 1 = inherited, see Residual ✓ |
| S3 | `bun typecheck` (cwd packages/opencode) | exit 0 | exit 0 (`20261002T053649Z_ea315a37`) ✓ |
| S4 | live, read-only, by Claude: the 66-part probe of `…Co8CHgZX` re-run through the NEW predicate | 65 carriers, the prose one gone | shipped reader (`probe-live-s4.mjs` imports `src/memory/spine`): **66 → 65**, whole DB **417 → 416**, the drop = `prt_0f6c3d152001xaP3MoGKSADtLc`, re-read: holds the prose phrase, no Keywords/md5 line (`20261002T053721Z_2147850b`) ✓ |

## Residual

- **Inherited red, NOT this change** — `compaction.test.ts:301` «m* reproduces permanent memory verbatim inside
  <memory>» fails at line 350 (the star's LAST line is expected to be the recovery pointer). Causal attribution by a
  comparable run on a HEAD worktree without this change: FAIL there too, same line (`20261002T053624Z_414bf144`),
  while the fold-head test PASSED there (so that one WAS this change → fixture superseded). Candidate cause, not
  verified: `28449f3285` (the fold ends with the rendered master plan, S6). Ours to fix — its own STABILIZE commit.
  **CLOSED 2026-10-02 (owner: «бери тест следующей задачей»):** classified TEST — the assertion encoded the pre-S6
  requirement («recovery pointer is the LAST line»); S6 deliberately moved the master plan after it, and S6's commit
  did not run compaction.test.ts. Re-pinned no looser (one pointer, after `--- Recent`, followed only by the
  master-plan block): compaction.test.ts 89/0 (`20261002T054205Z_685f27a8`); MUTATION (map and pointer swapped in
  `buildMessageStar`) → red at the new assertion, line 353 (`20261002T054226Z_7524b11f`); reverted, diff empty,
  compaction + summary-block-shape 106/0 (`20261002T054240Z_6821090b`).
- **Robot's temp stash** `stash@{0}: red-proof-tmp` — dropped on the owner's yes (`de33e440`), 2026-10-02.
