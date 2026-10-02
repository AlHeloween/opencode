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

- [ ] **P1 — one predicate.** A reply with no real vector block yields NO message dominant; a reply with one
      yields its own block's dominant (last wins, unchanged). Consumers move with it: `compaction.ts:1428`,
      `:1783`, `:1989/1993/2010`, `messagesearch.ts:241`.
- [ ] **P2 — the doc line.** `tool/messagesearch.txt` states that stemming is English-only and that a Russian
      word is reached by its stem with `*`.

## Smoke Tests — prediction written BEFORE the robot run

| # | oracle | predicted | measured |
|---|--------|-----------|----------|
| B0 | `bun test test/memory/spine.test.ts test/session/mechanical-summary-body.test.ts` (cwd packages/opencode), baseline | 34/0 | **34 pass / 0 fail / 72 expect**, exit 0 (`20261002T051116Z_7de51255`) ✓ |
| S1 | a NEW case: prose-only mention of `dominant:` → `undefined`; fails on the old code | RED before, GREEN after | |
| S2 | the same two files after the fix | 34 + new cases, 0 fail | |
| S3 | `bun typecheck` (cwd packages/opencode) | exit 0 | |
| S4 | live, read-only, by Claude: the 66-part probe of `…Co8CHgZX` re-run through the NEW predicate | 65 carriers, the prose one gone | |
