# RESULT — does naming the axes remove the decode divergence?

Date: 2026-10-20 · model: `minimax/minimax-m3.1-flash:free` (openrouter, free) · one prompt,
two arms, the only difference the attached `docs/glossary.md` · n = 1 per arm.

## The hit table (fixed before the run, scored on the answer's text)

| # | the project construction | arm A (control) | arm B (treatment) |
|---|---|---|---|
| 1 | three aspects: documentation (meaning) × code (mechanism) × execution (reality) | ✗ — axes explicitly NOT recoverable («нельзя назвать конкретные оси») | ✓ — D / C / E named with the catalogue families |
| 2 | ≥3 independent legs per aspect, from DIFFERENT families | ✗ — «три оракула или независимые проверки на каждой оси», no families | ✓ — «минимум три независимые ноги из разных семейств» |
| 3 | independence = the `unique_detection` receipt (injected control defect: this leg catches, the other legs of the same aspect miss; EXPECTED_FAIL) | ✗ — guessed statistics: корреляции, взаимная информация, факторный анализ, остаточная корреляция | ✓ — the four-step receipt procedure, verbatim |
| 4 | a leg without a receipt is subsumed and does not count | ✗ — not mentioned | ✓ — «без receipt нога считается поглощённой и не засчитывается» |
| — | the degenerate-simplex reading | ✓ — functional reading: a multi-looking grid that is one-dimensional collapses back to one dimension | ✓ — the kernel's exact rule: the criterion stays `Unknown` on the aspect with fewer than 3 legs |

**Score: arm A 0/4 on the construction, arm B 4/4.** Both arms decoded the four keyword axes
correctly and both said the FUNCTION of the 3×3 (do not let a multi-looking evaluation be
one-dimensional). The divergence is not in the strategy — it is in the construction, and it
is exactly where `RESULT.md` §5 said it would be: the axes were unnamed, so each decoder
filled them from its own prior.

## What this settles, and what it does not

**Settles (measured, n=1 per arm):** attaching the project's glossary converts a
correlation-based, wrong reconstruction of «three-by-three oracles with measured
independence» into the project's own construction — aspects, legs, families, and the
unique-detection receipt. The rule from `RESULT.md` §5 — «name the axes in a dominant, and
give every kernel term a glossary page» — is not a stylistic preference; the second half of
it measurably changes what an unframed decoder builds. Arm B also produced a correct
`{from_state, to_state, ambiguity}` triple, which arm A could not, because the vocabulary
that carries the state contract was in the attached file.

**Does not settle:** n = 1, one free model, no repetition, no second model, no blinding.
Arm B also inherits project vocabulary (`Unknown`, `residual`, `EXPECTED_FAIL`,
`subsumed`) that arm A never sees — that is the treatment as specified, but it means the
result is «the glossary makes the construction recoverable», not «the glossary is the only
way to recover it». The recorded Gemini arm (n = 1, different model, different harness)
drifted the same way as arm A here: LLM-as-judge axes and kappa.

## Instrument defect found (class, not anecdote)

**A too-small `max_tokens` makes this instrument return an EMPTY completion that looks
exactly like a refusal or a silent model.** Measured on 2026-10-20 with the same prompt:
`max_tokens` 1500 → empty; 6000 → empty; 20000 → full answer; a 26-char control prompt
answered at `max_tokens` 50. The free tier spends the budget on reasoning tokens, so the
completion arrives with no visible text and NO error. A reader who stops at the first empty
result would record «the model refuses to answer» — the truth is «the budget was consumed
before the answer». An instrument that hides its own failure mode is a delivery, not a
footnote.

Also measured: the `opencode-go` provider cannot serve an isolated call at all
(«Request is missing x-opencode-session») — it refuses rather than routing; the chain
resolution for an omitted model returned `ProviderModelNotFoundError` instead of naming
the missing model.

## Route

The rule is now measured, so it can be written into the kernel's own canon rather than
left in an experiment folder: the SV contract (`prompt_kernel/source.py:826`, the
`SV_CONTRACT`) and the glossary's «SV (semantic vector)» entry already state the rule; the
measurement is the receipt it lacked. Falsifier for the claim above: an isolated arm that
receives the SAME glossary and still reconstructs kappa-style independence.
