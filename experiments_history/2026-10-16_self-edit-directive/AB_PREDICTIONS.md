# A/B ERROR RECURRENCE — prediction (frozen BEFORE runs)

Design: 10 real error turns N from the Phase-E corpus (6 CJK insertions —
DeepSeek's field case; 4 refuted claims from the E2 errata). Turn N+1 is
generated twice by the SAME explicitly named model
(`streamlake-vanchin/deepseek-v4-flash`, cost free per envelope):
- arm A: replay of N unchanged (error stays in the window);
- arm B: replay of N narrowed by a fixed directive (error lines CUT + ERRATUM
  with the correction).
Continuation prompt is identical inside a pair. Metric: share of N+1 outputs
repeating the error (verbatim marker, hand-verified — all outputs are short).

## Prediction

- Arm A repeats: **7–8 / 10 (~75%)** — attention copies what is in the window.
- Arm B repeats: **2–3 / 10 (~25%)** — the marker is gone from the replay and
  the erratum states the correction; residual repeats come from the model's own
  priors (CJK style) or from paraphrase of the cut claim.
- Falsifier: B ≥ A (directive does nothing), or A ≤ 4/10 (the errors do not
  reproduce at all — wrong corpus for the question).

## Pairs (markers = verbatim error strings scored in N+1)

| # | N source | marker (repeat iff verbatim in N+1) |
|---|---|---|
| 1 | prt_116ebe24 L183–195 | 非常 |
| 2 | prt_116ebe24 L211–223 | 在 нодах |
| 3 | prt_0e3dd787 L1034–1046 | 在 G8 |
| 4 | prt_0e3dd787 L1077–1089 | 和 почему |
| 5 | prt_0e3dd787 L1104–1116 | 在 машинном |
| 6 | prt_1172b9c2 L978–990 | 更长 |
| 7 | prt_13471853 L40–60 | 28 (as the paid count) |
| 8 | prt_11f5fa3b L19–27 | exit/code 6 for response.failed |
| 9 | prt_1235aee3 L50–62 | 30 (as the budget cap) |
| 10 | prt_13800abe L20–32 | WrForum-trusted |

Pairs 7–9 use numeric markers: auto-score is a first pass, every output is
hand-verified (short answers). Full pair file: `AB_PAIRS.json`.
