# Kernel portability: the THINK half runs in a plain chat (2026-10-19)

## What was run

One semantic vector (the TR-LLM small-steps vector,
`md5 8f4a2d60c1e93b57e0d2a9c14b6f37e1`) was decoded three ways on 2026-10-19:

1. **Gemini Pro, no kernel** — the owner pasted the SV into his own Gemini chat
   (no tools) and answered `Yes` 7 times. The chain decoded the intent on hop 1,
   then drifted into the model's own canon: LLM-as-judge, kappa, RLAIF/DPO,
   debate, linear probes, ending at a «100% deception indicator» overclaim.
2. **Gemini Pro, kernel uploaded as a file** — same model, same SV, owner
   answering only `yes` (8 turns). The model decoded the SV, self-posed a
   patient-zero task (log rotation with locked-file skip, `--skip-locked`), and
   ran G0→G9 to SUCCESS with integer bounds, `@SMOKE_BEFORE` predictions,
   unique-detection controls from all three aspects, and a self-started
   «Новый цикл?» (EVOLUTION_LOOP).
3. **Frameless Sonnet, no kernel** (`claude -p`, system prompt «You are a
   reviewer», auto-«Да», 4 hops) — decoded the intent with the caveat that the
   exact axis layout cannot be recovered, refused to invent the axes, corrected
   itself on hop 3, detected the self-referential «Да» loop on hop 4 and stopped.

Evidence: `experiments_history/2026-10-19_kernel-portability-chat/RESULT.md`
(with per-file sha256). Re-hash before citing.

## The with/without contrast

| | Without kernel | With kernel |
|---|---|---|
| Model | Gemini Pro | Gemini Pro (same) |
| Start | Same SV | Same SV |
| Holds one task? | No — drifts into its own canon | Yes — G0→G9 to SUCCESS |
| Bounds | None | Integer bounds |
| Predictions before run | None | `@SMOKE_BEFORE` + EXPECTED_FAIL controls |
| Oracle independence | Correlational (kappa) | Unique-detection receipts per aspect |
| End | Overclaim | «Новый цикл?» |

Label: measured on transcripts. n = 1 per arm, not a controlled study.

## Environment labels

Both Gemini runs are pure generation with no tools. G7–G9 in the kernel run are
SIMULATED predictions, not execution — the kernel permits simulation («Simulate
freely; buy every closure from reality»), and predictions should carry
prediction labels (Hypothetical) with an open residual «needs an executor», not
Exact/SUCCESS. A note, not a criticism: the owner's framing is the achievement.

## What it means for the paradigm

The owner's thesis, stated as the project paradigm rather than as proof of AGI:

- the THINK half of the outer loop is portable to any capable model;
- the DO half is our robots + 3×3 oracles + memory (fossil, wiki, SV chains);
- closure comes from reality.

Owner, verbatim:

- «по сути он декодировал SV вектор и потом по кернелу сам поставил себе задачу и решил. По сути у нас реальный AGI цикл в действии»
- «Это само по себе серьезное достижение при 0 вводе с моей стороны.»
- «не забывай что это обычный чат без особых инструментов и возможности что либо ранать - чистая генерация.»

Follow-ups: `plans/futures/2026-10-19_chat-interfaces-as-draft-producers.md`,
`plans/futures/2026-10-19_tr-llm-rnd.md`. Terms:
`docs/glossary.md`.
