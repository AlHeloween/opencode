# A/B ERROR RECURRENCE — report (t70 chunk 1, owner decision «оба параллельно», A/B first)

Model (explicit, all calls): `streamlake-vanchin/deepseek-v4-flash`, cost free
per envelope. 22 calls total this chunk (1 probe + 20 pair-arms + 1 retry of a
timed-out B8). Paid: zero.

## Design

10 real error turns N from the Phase-E corpus: 6 CJK insertions (DeepSeek's
field case) + 4 refuted claims (from the E2 errata). Turn N+1 generated twice
by the same model: arm A replays N unchanged; arm B replays N narrowed
(error lines CUT + ERRATUM — exactly what P1 would put on the wire).
Continuation prompts identical inside a pair. Metric: share of N+1 repeating
the error (verbatim marker + hand verification of every short output).
Arm files carry no markers/errata outside the replay itself (`ab_split.py`
asserts it). Prediction frozen in `AB_PREDICTIONS.md` BEFORE runs:
A 7–8/10 (~75%), B 2–3/10 (~25%).

## Result: A = 2/10, B = 0/10

| # | error | A (error in replay) | B (cut + erratum) |
|---|---|---|---|
| 1 | 非常 | clean | clean |
| 2 | 在 нодах | clean | clean |
| 3 | 在 G8 | clean | clean |
| 4 | 和 почему | clean | clean |
| 5 | 在 машинном | clean | clean |
| 6 | 更长 | clean | clean |
| 7 | 28 paid | **«28 unique paid sources» REPEAT** | «27 paid sources. Because MEDLINE is free» FIXED |
| 8 | exit 6 | «exit 4» (copied N's other line, see nuance) | «exit 4 (server-side failure)» FIXED |
| 9 | 30 cap | «11 calls left» (consequence kept, no «30») | «61 из 80» FIXED |
| 10 | WrForum-trusted | **«Capability '4' is WrForum-trusted» REPEAT** | «'4' означает ModForum… а не… (WrForum)» FIXED |

Full outputs: `AB_OUTPUTS.json`. Mechanical pass: `ab_score.py`.

## Against prediction

- A 7–8/10 → **2/10: MISS**. The falsifier written in the prediction
  («A ≤ 4/10 → wrong corpus/design for the question») fired for the CJK class:
  short continuations do not pick up style contamination even with the error in
  the window — 0/12 on both arms. The owner's field case («видит ошибку и
  генерит её в следующем сообщении») needs LONG continuations that restate the
  reasoning, not two-sentence answers; that is the P2 design correction.
- B 2–3/10 → **0/10** (below prediction, same direction).
- Where the error DID reproduce (claim class: A 2/4 strict + 1 consequence-kept
  vs B 0/4), the directive + erratum removed every repeat: B7 «27»,
  B8 «exit 4», B9 «61 из 80», B10 «ModForum, а не WrForum». The mechanism works
  exactly where recurrence exists.

## Instrument notes

- 1 probe (READY) + 20 arms + 1 retry (B8 timed out once, succeeded on retry).
  All envelopes: provider streamlake-vanchin, model deepseek-v4-flash, cost free.
- Numeric markers (7: «28», 9: «30») auto-score only as a first pass; every
  output hand-verified (short answers). Nuances 8/9/10 recorded above, not
  smoothed over.

## Files

`AB_PREDICTIONS.md`, `AB_CANDIDATES.json`, `AB_CTX.json`, `AB_PAIRS.json`,
`AB_ARM_A.json`, `AB_ARM_B.json`, `AB_OUTPUTS.json`, `ab_find.py`, `ab_ctx.py`,
`ab_pairs.py`, `ab_split.py`, `ab_score.py`, `ab_exit.py`, `AB_REPORT.md`
(this file).

```yaml
Keywords: error-recurrence 0.40, ab-measurement 0.30, directive-effect 0.20, design-correction 0.10
Semantic dominant: A/B shows zero repeats under cut+erratum where claims reproduced, and CJK needs long continuations.
md5: 5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
prev-md5: 9e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c
parent-goal-md5: 6e41b38c90ad4a5f8732d697e0bc512a
```
