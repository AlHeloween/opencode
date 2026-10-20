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
- [x] Commit via scripts/commit_own.py + progress-log line for t96 (242485c6c9); STOP before --install
- [x] Budget 75k (owner verbatim): utf8 74_000 → 75_000 + validate ceiling + reward pins with dated owner-quote comments; headroom spent on clarity, not padding — pair sentence names the agreeing legs, pass→miss/missed_elsewhere, receipt named, instrument qualified; product 73960 B, max tokens 10083 ≤ 10100; suite 454+3 stale; STOP before --install
- [x] Review 1 (12 falsifier fixes): RED (3 wiring + 40 aspect/leg/stamp/rule/frame/G2/mutation) → GREEN 71 passed; wiring G3/G8/G9 + guards; aspect/leg split (stamp aspects, frame aspects, divergence aspects); per-oracle stamp (aspect, family, required unique_detection); in-aspect independence + E1/E2 override; ALL-others-miss; agree/diverge/action/G1-return; per-family executed doc; Unknown bars SUCCESS; 1-drivable-leaf vs 3-at-acceptance; qualify-once; never-provisional; open catalogue; suite 492 passed, byte asserts red per budget rule below
- [x] Budget (owner's call, NOT raised here): product 75630 B / 10269 tok, claude 75535/10353, codex 75378/10284, cursor 75360/10353 vs ceiling 75000/10100 — over by 630 B and 253 tok on required clarification text only; nothing cut; 5 byte asserts + 2 masked token asserts stay red for the owner
- [x] Build + commit for review 1; STOP before --install — receipts (2026-10-20): render ×4 WITHOUT install (product 76799 B `d89955e6…`, claude 76704 B `c228edee…`, codex 76547 B `5008e667…`, cursor 76529 B `ad4f6535…`; all four printed `not_updated` — no receiver written); pytest 522 passed / 7 failed = 4 token caps (product 10474, claude 10558, codex 10489, cursor 10558 vs 10100) + 3 stale receivers (production prompt, claude kernel, cursor rule — green at install); commits c912b4ac52 (review 1) + 8a92646365 (review 2); _build.ps1 run 20261020T015315Z_20944745 exit 0, bytes_written 65734, smoke 10.0.1465
- [x] OWNER DECISIONS — both arrived 2026-10-20 and are executed below: (1) token ceiling → 85 000 B / 11 600 tok (owner: «Ну, ради ТРИЗ можно поднять планку до 85000»; tokens derived at measured 7.33 B/tok); (2) install word (owner: «Ревью, затем ставлю»; Legislator verified 8a92646365) — 4 receivers installed, baseline repinned, suite 529/0, build 10.0.1467
- [x] Review 2 (ceiling 80k + 8 clarifications) → SUPERSEDED by 85k/11600 + install this turn: suite 522 passed / 7 failed (4 token caps + 3 stale) as predicted; bytes GREEN (76799 vs 80000); rule sha a94b79f98c5b0725 ×4
- [x] INSTALL (owner's word, Legislator-verified 8a92646365): pre-install suite 526 passed / 3 stale only; product --install d89955e6, claude c228edee, cursor ad4f6535 (receiver 958f0bee), codex-global 5008e667 (backup experiments/2026-10-20_kernel-install/AGENTS.md.20261020-1006.bak); k3_finish repin (baseline 5ff2dcad → d89955e6) + installed==render True ×4; post-install suite 529 passed 0 failed; _build.ps1 run 20261020T020649Z_469c9393 exit 0, bytes_written 65756, smoke 10.0.1467

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
