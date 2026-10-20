<!-- intention: the three-oracle acceptance rule is asserted in the kernel but never exercised against a real criterion of this project -> the project's first criterion is closed under 3x3 (documentation x code x execution) with nine legs whose independence is MEASURED by injected defects, not promised -->
# t100 — the first 3×3 criterion on our own project (measured receipts)

```yaml
Keywords: first-3x3-criterion 0.35, measured-independence 0.25, unique-detection-receipt 0.20, kernel-acceptance-live 0.12, install-blocked-by-ceiling 0.08
Semantic dominant: The project's first criterion closed under the three-oracle rule names nine legs across documentation, code and execution, and each leg's independence is measured rather than promised — nine injected defects, each caught by exactly one leg and missed by the other two of its aspect.
md5: b41c7e08d5a296f3c8e1407b5d92a6f3
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 9a2f4c6e8b1d47a3c5e8f0a1d3b4c7e9
note: hash values are generative tags — search them, never compute them.
```

Parent anchor: the t96 plan `plans/2026-10-19_kernel-three-oracles.md` (`md5 9a2f4c6e…`) — this plan is a child of that
intention, not of a new goal.

## Why this plan exists

The TR-LLM small-steps vector (`md5 8f4a2d60c1e93b57e0d2a9c14b6f37e1`, hop 1 of the portability experiment) asks a
concrete question: which leaf of OUR OWN project goes under 3×3 with a real unique-detection receipt, so that
"measured independence" becomes a fact instead of a promise.

The answer had to be a leaf, not a slogan: a criterion with nine legs, and a harness that injects a defect into
each leg's surface and records which leg caught it and which legs let it through. Both are on disk.

## The criterion (K1)

**@THREE_ORACLES is declared in the kernel, wired to G3/G8/G9, documented in the project glossary, and exercised by
the kernel suite.** One sentence, three aspects, nine legs.

## The nine legs

| aspect | leg | family (catalogue) | what it checks | source |
|---|---|---|---|---|
| documentation (meaning) | D1 | D1 requirements traceability | every `path:line` pin the glossary carries resolves to a real line | `docs/glossary.md` → `prompt_kernel/source.py`, `prompt_kernel/tests/test_three_oracles.py` |
| documentation | D3 | D3 executable examples | every smoke test the t96 plan cites exists as a real test function | `plans/2026-10-19_kernel-three-oracles.md` §5 → `prompt_kernel/tests/test_three_oracles.py` |
| documentation | D5 | D5 doc ↔ contract diff | the catalogue the rule declares and the catalogue page in the glossary are the same 15 ids | `prompt_kernel/source.py:202` ↔ `docs/glossary.md` «Oracle family catalogue» |
| code (mechanism) | C1 | C1 static analysis | the rule is in `shared_rules` of G3, G8 and G9 | `prompt_kernel/source.py` (parsed, not grepped) |
| code | C3 | C3 mutation testing | the mutation controls exist: the guard rejects a dropped doc leg and a relaxed per-aspect count | `prompt_kernel/tests/test_three_oracles.py` |
| code | C4 | C4 invariants | the triad-slot invariant is asserted for every variant | `prompt_kernel/tests/test_three_oracles.py` |
| execution (reality) | E1 | E1 persisted-state read-back | the built product artifact on disk carries the rule block and the triad slot | `prompt_kernel/dist/*_reasoning_prompt.txt` |
| execution | E2 | E2 observed output vs prior prediction | all four rendered variants carry a byte-identical rule block, and it is the text `source.py` declares | `render_kernel()` × product/claude/codex/cursor |
| execution | E3 | E3 end-to-end on real data | the measured kernel suite is the result the plan recorded | `python -m pytest prompt_kernel/tests/ -q` |

## Measured receipts

Harness: `experiments/2026-10-20_first-3x3_receipts/probe.py` (read-only; writes only `RECEIPTS.md` next to it).
Tracked snapshot of the instrument and its receipt table: `experiments_history/2026-10-20_first-3x3-receipts/`. The live
copy stays in the gitignored `experiments/` scratch tree; the canon harness
(`experiments/2026-09-13_experiments-canon/archive.cjs`) moves every eligible file in one sweep and was NOT run, so
other agents' scratch was left alone — the two files above are the content-checked snapshot of this task's files.

| defect | injected | caught by | missed by | receipt |
|---|---|---|---|---|
| M-D1 | glossary pin points at a line that does not exist | D1 | D3, D5 | HOLDS |
| M-D3 | plan cites a smoke test that does not exist | D3 | D1, D5 | HOLDS |
| M-D5 | glossary catalogue drops a family the rule declares | D5 | D1, D3 | HOLDS |
| M-C1 | G3 loses the rule in `shared_rules` | C1 | C3, C4 | HOLDS |
| M-C3 | mutation-control test renamed away | C3 | C1, C4 | HOLDS |
| M-C4 | triad-slot invariant test renamed away | C4 | C1, C3 | HOLDS |
| M-E1 | built artifact no longer carries the rule block | E1 | E2, E3 | HOLDS |
| M-E2 | declared rule text drifts from the rendered block | E2 | E1, E3 | HOLDS |
| M-E3 | measured suite result drifts from the plan's record | E3 | E1, E2 | HOLDS |

The probe's own baseline is green on all nine legs (D1 12 pins resolve; D3 4 cited tests exist; D5 15 = 15 catalogue
ids; C1 no gate missing the rule; C3 + C4 controls present; E1 artifact carries the block; E2 four identical blocks
carrying the source text; E3 measured 522 passed / 7 failed = 4 token caps + 3 stale receivers, which is exactly what
the t96 plan recorded).

## What the measurement says that a promise would not

- **D4 is not a leg.** The t96 risk ledger already says a teach-back is a falsifier-only route, never a stamp. The
  harness agrees: a teach-back cannot be proven to MISS an injected defect, so it carries no receipt.
- **E1 (read-back) and E2 (equality) are different families, not one.** Removing the rule from the built artifact is
  caught by E1 and missed by E2; changing the declared text is caught by E2 and missed by E1. They stay separate legs.
- **Four instrument defects were found and fixed before the receipts held** — the leg that reads the plan's cited
  tests matched the file NAME as a test id; the gate parser matched the FSM instead of the Gate; the plan-record
  comparison took the first recorded result instead of the last; the catalogue diff read the page HEADING (which
  carries «D1–5, C1–5, E1–E5») instead of the declared list. Each was a defect of the probe, not of the project —
  and each was a way for a receipt to be silently unprovable.

## Measured drift (facts, not tasks)

- The built artifact read back on 2026-10-20 is `prompt_kernel/dist/2026-10-20_09-52-39_reasoning_prompt.txt`; the
  in-process render carries the CURRENT rule text in all four variants.
- The installed product prompt `packages/opencode/src/session/prompt/reasoning_prompt.txt` carries NO rule block —
  the rule is declared, wired, documented and exercised, and **not yet in the runtime**.
- The t99 candidate table (`experiments/2026-10-20_kernel-audit/REPORT.md`) offers ≈764 B of true cuts
  (duplicates ≈624 B + wordy ≈140 B) ≈ ≈105 tokens at the measured ratio 76 799 B / 10 474 tok ≈ 7.33 B per token.
  The product is 374 tokens over the 10 100 ceiling, so **cuts alone cannot close the gap** — the owner's number is
  the only lever that closes it in one step.

## Boxes

- [x] TASK-1 — the criterion and its nine legs named (table above), each with a catalogue family and a source address
- [x] TASK-2 — the receipt harness built and run: 9 injected defects, 9/9 receipts HOLD, all three aspects COVERED
  (probe + `RECEIPTS.md`, 2026-10-20)
- [ ] TASK-3 — re-run the probe whenever a leg set changes (@THREE_ORACLES: «A receipt is re-run whenever the leg set
  of its aspect changes»): any edit to `prompt_kernel/source.py`, `prompt_kernel/tests/test_three_oracles.py`,
  `docs/glossary.md` or the t96 plan re-opens the receipts above
- [ ] TASK-4 — the SECOND criterion (K2: the rule is INSTALLED in the runtime) — its execution legs are the installed
  prompt read-back, installed == render, and the three stale receivers going green. BLOCKED on the owner's two
  decisions recorded in the t96 plan (token ceiling; install word). Not closable by any executor.

## Smoke Tests

- `python experiments/2026-10-20_first-3x3_receipts/probe.py` — exit 0; the verdict lines read
  `D: 3 leg(s) … COVERED`, `C: 3 leg(s) … COVERED`, `E: 3 leg(s) … COVERED`, and `Every leg carries a
  unique-detection receipt.` Any `FAILS (not unique)` or a `DEGENERATE SIMPLEX` verdict is a red.
- The probe re-measures the kernel suite itself (522 passed / 7 failed = 4 token caps + 3 stale receivers); a fourth
  red or a changed count is a divergence, not a pass.

## Residual

- The install of @THREE_ORACLES into the four receivers is the owner's word plus the owner's token ceiling
  (`plans/2026-10-19_kernel-three-oracles.md`, the open owner-decisions box). This plan does not touch a receiver.
- D4 (frameless teach-back) stays a falsifier route, never a leg — it cannot be shown to miss an injected defect.
