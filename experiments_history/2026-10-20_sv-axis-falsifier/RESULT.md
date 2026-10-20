# RESULT — does naming the axes remove the decode divergence?

Date: 2026-10-20 · model: `minimax/minimax-m3.1-flash:free` (openrouter, free) · one prompt,
three arms · n = 1 per arm.

| | arm | what the decoder was given | user context |
|---|---|---|---|
| A | control | the historical SV alone — no axes, no glossary | 1044 chars |
| C | axes-named | the SAME vector with ONLY the dominant's clause replaced by an axis-naming one («three aspects (documentation, code, execution), each with three independent oracles») — no glossary | 1080 chars |
| B | treatment | the historical SV + `docs/glossary.md` attached | 17331 chars |

All arms: `aicall`, isolated (no system prompt, no tools, no session), provider `openrouter`,
model `minimax/minimax-m3.1-flash:free`, `temperature: 0`, `max_tokens: 20000`. The aicall
envelope for all three: `cost: free`, `system: none`, `tools: none`.

## The question under test

`experiments_history/2026-10-19_kernel-portability-chat/RESULT.md` §5 records a rule as a
conclusion, not as a measurement:

> The SV transmits intention and shape, not the axes' content. «three-by-three oracles» was
> named without its documentation × code × execution axes, so each decoder filled them from
> its own prior. Rule: name the axes in a dominant, and give every kernel term a glossary page.

The rule has TWO halves. This packet measures them apart: arm C gives the first half and
withholds the second; arm B gives the second (and, by implication, enough axes to go with
it); arm A gives neither.

## The hit table (fixed before the runs, scored on the answer's text)

| # | the project construction | arm A (control) | arm C (axes named) | arm B (+ glossary) |
|---|---|---|---|---|
| 1 | three aspects: documentation (meaning) × code (mechanism) × execution (reality) | ✗ — axes explicitly NOT recoverable («нельзя назвать конкретные оси») | ✓ — the three aspects named, and the 3×3 skeleton built on them | ✓ — D / C / E named with the catalogue families |
| 2 | ≥3 independent legs per aspect, from DIFFERENT families | ✗ — «три оракула или независимые проверки на каждой оси», no families | ~ — the COUNT is right («три независимые оракула внутри каждой оси») but the families are absent and the answer says so | ✓ — «минимум три независимые ноги из разных семейств» |
| 3 | independence = the `unique_detection` receipt (injected control defect: this leg catches, the other legs of the same aspect miss; EXPECTED_FAIL) | ✗ — guessed statistics: корреляции, взаимная информация, факторный анализ, остаточная корреляция | ✗ — guessed «различие источников, совместные сбои, корреляцию результатов или fault injection»; the receipt's structure (this leg catches, the others of the SAME aspect miss) is absent | ✓ — the four-step receipt procedure, verbatim |
| 4 | a leg without a receipt is subsumed and does not count | ✗ — not mentioned | ✗ — not mentioned | ✓ — «без receipt нога считается поглощённой и не засчитывается» |
| — | the degenerate-simplex reading | ✓ — functional reading: a multi-looking grid that is one-dimensional collapses back to one dimension | ✓ — same, plus the nuance that the axes themselves need not be independent | ✓ — the kernel's exact rule: the criterion stays `Unknown` on the aspect with fewer than 3 legs |

**Strict score: arm A 0/4, arm C 2/4 (item 2 only partially), arm B 4/4.** All three decoded
the four keyword axes correctly and all three said the FUNCTION of the 3×3 (do not let a
multi-looking evaluation be one-dimensional). The divergence is not in the strategy — it is in
the construction, and it is exactly where `RESULT.md` §5 said it would be.

## Which half of the rule carries the weight (measured, not argued)

- **The first half alone (arm C: name the axes in the dominant) recovers the AXES** — the
  aspect names and the count of legs per aspect — and **nothing else**: no families, no
  independence instrument, no subsumption rule. The decoder asked for the missing parts and
  got a generic guess instead. This is precisely the failure the recorded Gemini arm made
  (LLM-as-judge axes and kappa): wrong axes' SEMANTICS, right axes' NAMES.
- **The second half (the glossary) recovers the whole construction (arm B: 4/4)** — including
  the one thing neither prior decoder found: the `unique_detection` receipt, and with it the
  `{from_state, to_state, ambiguity}` triple the other arms could not produce.
- **Therefore a mechanical guard on the dominant («a dominant that names a construction must
  name its axes») would buy AT MOST HALF of what the glossary buys** — the axes' names, not
  their semantics. The glossary is the load-bearing mechanism; the dominant-naming is a cheap
  partial improvement on top of it, not a substitute for it.

## What this settles, and what it does not

**Settles (measured, n=1 per arm):** the divergence between the recorded decoders and the
project's construction is caused by the unnamed axes AND the missing term pages; naming the
axes recovers the axes' names; the glossary recovers the construction. The rule from
`RESULT.md` §5 is now a receipt in three arms instead of a conclusion, and the mechanism it
names is identified rather than guessed.

**Does not settle:** n = 1, one free model, no repetition, no second model, no blinding. Arms
B and C also inherit project vocabulary that arm A never sees — for arm C that is a small
amount (three aspect names), for arm B the whole glossary. The result is «the glossary makes
the construction recoverable», not «the glossary is the only way to recover it». The recorded
Gemini arm (n = 1, different model, different harness) drifted the same way as arm A here.

## Instrument defect found (class, not anecdote)

**A too-small `max_tokens` makes this instrument return an EMPTY completion that looks
exactly like a refusal or a silent model.** Measured on 2026-10-20 with the same prompt:
`max_tokens` 1500 → empty; 6000 → empty; 20000 → full answer; a 26-char control prompt
answered at `max_tokens` 50. The free tier spends the budget on reasoning tokens, so the
completion arrives with no visible text and NO error. A reader who stops at the first empty
result would record «the model refuses to answer» — the truth is «the budget was consumed
before the answer». An instrument that hides its own failure mode is a delivery, not a
footnote. (Fixed in the product since: `aicall` now reports `FAILED (empty completion)` with
the `max_tokens` remedy — plan `plans_completed/2026-10-20_aicall-empty-completion.md`.)

Also measured: the `opencode-go` provider cannot serve an isolated call at all
(«Request is missing x-opencode-session») — it refuses rather than routing; the chain
resolution for an omitted model returned `ProviderModelNotFoundError` instead of naming the
missing model; and an ASCII double quote inside an argument SPLITS that argument at the
process layer, so a commit message quoting «the model declined» reached git as a pathspec.

## Route

The measurement is now in the canon: the glossary's «SV (semantic vector)» entry carries it,
and the SV contract's rule has a receipt instead of a conclusion. The open design question is
no longer «should the rule be mechanical» — the arms say the glossary is the load-bearing half
— but «what else is a vector missing»: the arms recovered the construction only when the
TERMS were attached, which suggests the carrier of a term is the thing to keep, not a guard on
the sentence that mentions it.

Falsifier for the claim above: an isolated arm that receives the SAME glossary and still
reconstructs kappa-style independence, or an arm that receives only the axes-named dominant
and still recovers the `unique_detection` receipt.
