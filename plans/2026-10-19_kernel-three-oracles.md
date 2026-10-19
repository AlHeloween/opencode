# t96 — kernel: acceptance rests on three oracles (documentation, code, execution)

<!-- intention: acceptance closes on one oracle or on unmeasured independence -> every criterion closes only when documentation, code and execution agree, each aspect covered by ≥3 declared, receipt-carrying legs -->

```yaml
Keywords: three-oracles 0.35, documentation-as-oracle 0.25, pair-disagreement-defect 0.20, executed-docs 0.12, user-documentation-standards 0.08
Semantic dominant: Detailed project documentation becomes the third required acceptance oracle beside code and execution, each aspect covered by three independent receipt-carrying legs.
md5: 9a2f4c6e8b1d47a3c5e8f0a1d3b4c7e9
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 113316aa0eea445c8fc3c7045dd89313
note: hash values are generative tags — search them, never compute them.
```

## Status

- [x] Ground standards (IEEE 1063 superseded by 26512 per IEEE SA fetch b5f605aa; ISO/IEC/IEEE 26514:2022 per ISO fetch 75a42e10; ISO/IEC/IEEE 29148:2018 per ISO+IEEE corroborating pages)
- [x] RED tests (28 failed) → GREEN 28 passed: triad slot, per-aspect ≥3, catalogue + numbers, frame legs, G2 leaves, mutation controls
- [x] Implement: stamp legs + unique_detection field, frame legs sentence ×4 (parity holds), shared THREE_ORACLES rule (#### header), G2 SMALLER extended to brief wording; test_render stamp pin moved with dated reason
- [x] Oracle: full suite 454 passed + 3 stale reds; bands utf8 → 74_000 (product 73905), tokens → 10_100 (max 10079); t84 green; repr per variant identical core
- [ ] Commit via scripts/commit_own.py + progress-log line; STOP before --install

## 1. Grounding

- t90 base: HEAD `4ddce9c6` (t90 NOT installed — the install precondition is waived by the Legislator for one writer / one install cycle; reading rebased on HEAD text).
- Kernel today: execution-against-prediction (@ORACLE, @SMOKE_BEFORE, G3 ACCEPTANCE_FRAME), source independence (@MEDOID_SIMPLEX), docs only as G1 reading + G9 upkeep — not an oracle.
- Measured cases: pipeviewer (code+run agreed, doc/meaning disagreed — viewport vs DOM-state proves E1/E2 differ); edit.txt vs edit.ts (doc+run agreed, code disagreed — ~1/9 edits failed, t93).
- Standards below go in ONLY with a fetched primary authority (number + edition verified); an ungrounded number stays out.

## 2. Implementation (slot over imperative)

- `ORACLE_STAMP`: `legs: {documentation, code, execution}` + `unique_detection?` {defect from one of the three aspects, caught_here, passed_elsewhere}.
- `ACCEPTANCE_FRAME` (shared wording ×4): each criterion names its three legs; an uncovered leg is residual.
- Shared rule `THREE_ORACLES`: triad agreement; per-aspect ≥3 independent oracles (reference @MEDOID_SIMPLEX, never restate); fewer = degenerate simplex → Unknown + missing legs as residual; doc counts only when EXECUTED (per-step prediction+capture, or schema-parsed examples); pair disagreements → DIVERGENCE_EVENT with the three readings; unique-detection receipt per stamp (EXPECTED_FAIL control), without it subsumed; defects sourced from the three aspects; families declared from the catalogue, three DIFFERENT families per aspect.
- Catalogue (names only): D1 29148; D2 executed procedure / operator manual (1063, 26514); D3 doctest vs schema/API; D4 frameless teach-back (aicall); D5 doc↔contract diff. C1 static/type; C2 structural graph; C3 mutation; C4 invariants/contracts/property; C5 independent diff review. E1 state read-back; E2 output vs prediction; E3 e2e on real data; E4 outside measurement; E5 differential/back-to-back. Degenerate pairs named (same-author test+assertion ONE; two screenshot tools ONE; E1 vs E2 differ).
- G2 `SMALLER_IS_INSTRUMENTABLE`: extended — split until every leaf is observable on all three aspects; a leaf without documentation is not yet a leaf; instruments share the geometry (@TOOLCHAIN_QUALIFICATION).

## 3. Claim ledger

- C1: triad slot present in every variant. Falsifier: a variant render without the three legs.
- C2: per-aspect ≥3 refers to @MEDOID_SIMPLEX (not restated). Falsifier: clause absent.
- C3: catalogue families present, names only, grounded numbers only. Falsifier: missing family or ungrounded number.
- C4: mutation controls discriminate (drop-doc fails; drop-≥3 fails). Falsifier: guard passes on the mutant.

## 4. Risk ledger

- R1: size — catalogue + rule ≈2 KB; bands step (utf8/token asserts + validate ceiling + reward pins), nothing cut.
- R2: single writer on source.py is this session alone (t90 precondition waived in writing by the Legislator).
- R3: D4 teach-back names aicall — a falsifier-only route per DELEGATION, never a stamp; framed as such.

## 5. Smoke Tests

RED (must FAIL on today's kernel for the stated reason):
- `test_three_oracles.py::test_triad_slot_in_all_variants` — legs {documentation, code, execution} + unique_detection in every render; today absent.
- `test_three_oracles.py::test_per_aspect_three_refers_to_simplex` — ≥3 + @MEDOID_SIMPLEX in the triad rule; today absent.
- `test_three_oracles.py::test_catalogue_families_present` — D1–D5/C1–E5 markers + grounded numbers; today absent.
- `test_three_oracles.py::test_guard_rejects_missing_documentation_leg` + `test_guard_rejects_relaxed_per_aspect_count` — mutation controls; today the guard itself is absent.
- Guard (passes today): t84 tokenize test stays green.

GREEN: RED file passes unmodified; full suite shows only the 3 stale-receiver reds; 4 variants render; caps by band-step only.

## 6. Residual

- `--install` (all receivers) is NOT this step — Legislator + aicall review, then the owner install word.
- No product-source change; no `bin/` touch.
