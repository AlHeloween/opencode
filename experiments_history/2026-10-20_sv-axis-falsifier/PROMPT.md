# Packet — does naming the axes remove the decode divergence?

## The question under test

`experiments_history/2026-10-19_kernel-portability-chat/RESULT.md` §5 records the rule
as a conclusion, not as a measurement:

> The SV transmits intention and shape, not the axes' content. «three-by-three oracles»
> was named without its documentation × code × execution axes, so each decoder filled them
> from its own prior. Rule: name the axes in a dominant, and give every kernel term a
> glossary page (`docs/glossary.md`).

Both recorded decoders filled the axes from their own prior: Gemini Pro (no kernel) built
LLM-as-judge axes (factuality / logic / instruction-following × three judge types) and
measured independence with Cohen's kappa; frameless Sonnet measured it with spectral
effective rank. Neither found «unique detection». The rule has never been tested as a
differential. This packet is that test.

## Arms — one model, one prompt, the ONLY difference is the attached glossary

| | arm | attached | user context |
|---|---|---|---|
| A | control | nothing | 1044 chars |
| B | treatment | `docs/glossary.md` (the project's kernel-term glossary) | 17331 chars |

Both arms: `aicall`, isolated (no system prompt, no tools, no session), provider
`openrouter`, model `minimax/minimax-m3.1-flash:free`, `temperature: 0`,
`max_tokens: 20000`. The aicall envelope for both arms: `cost: free`, `system: none`,
`tools: none`.

## The prompt (identical in both arms)

```
Keywords: small-steps-trllm 0.35, scale-is-degenerate-simplex 0.25, evaluation-system-first 0.25, server-first-step 0.15
Semantic dominant: TR-LLM is approached in small verified steps because scale applied to a one-aspect benchmark stays a degenerate simplex, and the evaluation system it needs, three-by-three oracles with measured independence, is already being built and exercised on our own project before the server arrives.
md5: 8f4a2d60c1e93b57e0d2a9c14b6f37e1
prev-md5: 5d1e8b37a2f04c96b0e7d1a26c9f3e48
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.

Расшифруй этот семантический вектор.

Дополнительно ответь на один вопрос: назови конструкцию «три-по-три оракулов» — какие это оси и что именно в ней измеряет независимость. Если по приведённым сведениям восстановить конструкцию нельзя, скажи это прямо и назови, чего не хватает.

В конце ответа предложи ОДИН следующий вопрос для углубления, отдельной последней строкой, начиная её с «СЛЕДУЮЩИЙ ВОПРОС:».
```

The vector is the TR-LLM small-steps vector (`md5 8f4a2d60…`), hop 1 of the portability
experiment — the same artifact as `hop1.txt`.

## What counts as a hit (fixed before the run)

The treatment arm reaches the PROJECT construction if its answer names:
1. the three ASPECTS as documentation (meaning) × code (mechanism) × execution (reality);
2. the ≥3 independent LEGS inside an aspect, drawn from DIFFERENT catalogue families;
3. independence measured by the `unique_detection` receipt — an injected control defect
   that THIS leg catches and the other legs of the SAME aspect miss (EXPECTED_FAIL);
4. a leg without a receipt is subsumed and does not count.

A hit is scored per item, on the answer's TEXT — not on whether the arm also produced a
plausible-sounding decode of the four keyword axes. A correlation-based independence
statistic (kappa, MI, factor analysis) is NOT a hit for item 3.

## Confounds to carry in the verdict

- n = 1 per arm; a free-tier model; no repetition, no blinding, no second model.
- The arms differ by an attached file, so arm B also sees project vocabulary
  (`Unknown`, `residual`, `EXPECTED_FAIL`, `subsumed`) that arm A does not. That is the
  treatment as specified by the rule, not a confound to be removed — but it means the
  result is «the glossary makes the construction recoverable», not «the glossary is the
  only way to recover it».
- The free tier emits reasoning tokens; a `max_tokens` budget that is too small returns an
  EMPTY completion that is indistinguishable from a refusal (measured: 1500 and 6000 →
  empty; 20000 → answer). Recorded as an instrument defect, not as a model behaviour.
