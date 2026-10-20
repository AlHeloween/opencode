<!-- intention: owner-approved TRIZ names float as paraphrase without kernel force → bare name corpus in three placements, STOP before --install -->
# Plan: TRIZ name corpus into the kernel (t102)

**SV:**
```yaml
Keywords: triz-name-corpus 0.35, names-not-explanations 0.25, three-placements 0.20, latent-algorithm-activation 0.12, stop-before-install 0.08
Semantic dominant: The owner-approved TRIZ names enter the kernel as a bare name corpus in three placements, contradiction work in decomposition and concern, evolution in the evolution loop and analysis tools in grounding and binding, so the universal algorithms already in the weights are set in motion without paragraphs that cost bytes or invite paraphrase.
md5: f5b379334b6747a697319af198411a54
prev-md5: e2e353e70e294516b7aab386f4f32c03
parent-goal-md5: 113316aa0eea445c8fc3c7045dd89313
note: hash values are generative tags — search them, never compute them.
```

## Boxes

- [x] **T1** RED tests: `prompt_kernel/tests/test_triz_corpus.py` (283: presence ×4 variants, once-only invariant, removal + unwire mutation controls, wiring)
- [x] **T2** Implement: `TRIZ_CONTRADICTION` + `TRIZ_ANALYSIS` shared rules wired into G2/G5 and G1/G6; `TRIZ_EVOLUTION` local rule in EVOLUTION_LOOP (add-only, one carrier clause per placement, names exactly as approved)
- [x] **T3** Oracle: corpus GREEN 283/283; full suite 809 passed + 3 stale-receiver reds only; bytes/tokens per variant inside 85 000 / 11 600
- [x] **T4** Commit via `scripts/commit_own.py` + progress-log line; STOP before `--install` (Legislator review + frameless pass, then owner install word)

## Smoke Tests

- **ST1** Every approved name renders in all 4 variants (`test_triz_name_present`)
- **ST2** No name outside its block (`test_triz_name_nowhere_outside_its_block`, zero pre-existing collisions measured 2026-10-20)
- **ST3** Removing one name fails the suite (`test_guard_rejects_removed_name`); unwiring one gate fails (`test_guard_rejects_unwired_corpus`)
