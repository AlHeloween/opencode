# Glossary — kernel terms (t90 path: `docs/glossary.md`)

Every `source_ref` is a kernel path:line or a doc, never recall. Every
`content_hash` is the sha256 of the source file the definition was drawn from;
re-hash before citing. A mismatch means the source moved: re-ground the entry.

Kernel source at write time:
`prompt_kernel/source.py`
sha256 `00e3de1ed8bd197c1bb1f7b15b4381a8b6866e283a361cc6f772fd0e2e6fbb7b`
(122796 bytes, 2026-10-19; t90/t96 work in progress — pending install).

## Digital Intention

- **Definition.** The user's request understood in their own language as a
  `{from_state, to_state, ambiguity?}` pair. `to_state` is the user's and never
  moves: grounding binds the oracle to it, decomposition splits the path to it,
  revisions keep it fixed.
- **source_ref:** `prompt_kernel/source.py:1034` (state contract
  `DIGITAL_INTENTION`); invariance rule `@INTENTION_INVARIANCE`,
  `prompt_kernel/source.py:192`.
- **content_hash:** sha256 `00e3de1ed8bd197c1bb1f7b15b4381a8b6866e283a361cc6f772fd0e2e6fbb7b`

## SV (semantic vector)

- **Definition.** An attention fingerprint in `@SV_FORMAT`: 3–9 keywords with
  weights summing to 1.0 (highest first), a one-sentence semantic dominant, and
  generative tags `md5` / `prev-md5` / `parent-goal-md5` plus the verbatim note
  line. Tags are searched, never computed; `md5` values are labels, not
  checksums (never confuse with a digest comparison). A vector is never a claim
  status. The SV transmits intention and shape, not the axes' content — name
  the axes in a dominant (measured 2026-10-19:
  `experiments_history/2026-10-19_kernel-portability-chat/RESULT.md` §5).
- **source_ref:** `prompt_kernel/source.py:826` (`SV_CONTRACT`, tag
  `SV_FORMAT`); format §1.2 of the rendered kernel.
- **content_hash:** sha256 `00e3de1ed8bd197c1bb1f7b15b4381a8b6866e283a361cc6f772fd0e2e6fbb7b`

## Degenerate simplex

- **Definition.** A coverage failure: three sources on ONE explanation, or an
  acceptance aspect covered by fewer than 3 independent oracles. The criterion
  stays Unknown on that aspect; the missing legs are recorded as residual.
  Parent and child never count as two sources; independence is measured WITHIN
  one nesting level.
- **source_ref:** `prompt_kernel/source.py:202` (`THREE_ORACLES` rule);
  `prompt_kernel/source.py:545` (`@MEDOID_SIMPLEX`).
- **content_hash:** sha256 `00e3de1ed8bd197c1bb1f7b15b4381a8b6866e283a361cc6f772fd0e2e6fbb7b`

## Three oracles (aspect vs leg)

- **Definition.** Acceptance is covered only when documentation (meaning), code
  (mechanism) and execution (reality) agree on the criterion. ASPECT names one
  of the three; LEG names one oracle inside an aspect. Each aspect needs ≥3
  independent legs, else a degenerate simplex. An aspect agrees when every leg
  of it passes; a failing leg inside an aspect is itself a divergence.
- **source_ref:** `prompt_kernel/source.py:202` (`THREE_ORACLES` rule);
  stamp shape `prompt_kernel/source.py:1065`.
- **content_hash:** sha256 `00e3de1ed8bd197c1bb1f7b15b4381a8b6866e283a361cc6f772fd0e2e6fbb7b`

## Unique-detection receipt

- **Definition.** The control that proves a leg is independent: an injected
  defect that this oracle catches and ALL the other legs of that aspect miss
  (an EXPECTED_FAIL control; legs of other aspects do not matter for the
  receipt). Carried as `ORACLE_STAMP.unique_detection:
  {defect, caught_here, missed_elsewhere}`. An oracle without a receipt is
  subsumed and does not count as a leg; where no such defect can be constructed
  the gap is residual and the oracle never counts provisionally.
- **source_ref:** `prompt_kernel/source.py:202` (`THREE_ORACLES` rule);
  `prompt_kernel/source.py:1065` (`ORACLE_STAMP`).
- **content_hash:** sha256 `00e3de1ed8bd197c1bb1f7b15b4381a8b6866e283a361cc6f772fd0e2e6fbb7b`

## Oracle family catalogue (D1–5, C1–5, E1–5)

- **Definition.** The default catalogue legs declare their family from; three
  legs from DIFFERENT families of one aspect (two legs from one family are one
  leg). Documentation (meaning): D1 requirements traceability (ISO/IEC/IEEE
  29148); D2 executed procedure with per-step capture (26514; 1063 superseded
  by 26512); D3 executable examples against schema/API; D4 frameless reader
  teach-back; D5 doc ↔ contract diff. Code (mechanism): C1 static analysis /
  types; C2 structural graph; C3 mutation testing; C4 invariants / contracts /
  property-based tests; C5 independent diff review. Execution (reality): E1
  persisted-state read-back; E2 observed output vs prior prediction; E3
  end-to-end on real data; E4 outside measurement / telemetry; E5 differential
  / back-to-back. A doc that is only read is not a leg.
- **source_ref:** `prompt_kernel/source.py:202` (t96 kernel text, pending
  install); pinned by `prompt_kernel/tests/test_three_oracles.py:61`
  (`test_catalogue_families_present`).
- **content_hash:** sha256 `00e3de1ed8bd197c1bb1f7b15b4381a8b6866e283a361cc6f772fd0e2e6fbb7b`

## EVOLUTION_LOOP

- **Definition.** The self-triggered protocol for proposing measurable
  improvements when work closes, stalls, or has no straight goal — a proposal,
  never a question to the owner, serving the same `to_state`. Triggers:
  `@CENTRAL_TASKS` exhausted, or undirected conversation with ≥10 messages of
  history. Selected evolution enters G1 as a new goal; a toolchain/framework /
  language / arch-family change needs fresh G4 authorization.
- **source_ref:** `prompt_kernel/source.py:782` (`EVOLUTION_LOOP` protocol,
  rules `SELF_TRIGGER_A` through `MIGRATION_PROTOCOL`).
- **content_hash:** sha256 `00e3de1ed8bd197c1bb1f7b15b4381a8b6866e283a361cc6f772fd0e2e6fbb7b`
