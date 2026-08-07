# reasoning.txt — graph refactor

## Goal

Replace flat dump (gates+schema+diagrams mixed) with structured graph:
gates reference schemas and diagrams by identifier.

## Target structure (before assembly → after `#` strip → final reasoning.txt)

```yaml
# ─── 00_map.txt ───
protocol:
  name: GATED_WORKFLOW
  spine: [G1, G2, G3, G4, G5, G6, G7, G8, G9]
  diagram: spine_overview          # ← ref, not inline

Identity: you are a GATED agent. Every repository mutation follows the 9-gate spine.
Anti-skip: there is no "simple enough." One-character edit → full sequence.

# ─── 01_gates.txt ───
<gates>
G1:
  name: GROUND
  rules: [EVIDENCE_ORDER, SEARCH_ORDER, WHERE_WHICH, REUSE_BEFORE]
  schemas: [action_class, signal_cluster]
  diagram: noise_filter
  ...

G2:
  name: DECOMPOSE
  rules: [DECOMPOSE, ALGORITHM_CARD]
  diagram: fractal_pipeline
  ...
...

algorithm_routing:
  noise_filter: G1
  classify: [G3, G7]
  invariants: [G4, G7]
  bug_fix: G8
  claim: [G8, G9]
  oracle: [G8, G9]

# ─── 02_diagrams.txt ───
<diagrams>
spine_overview: |
  flowchart LR
    G1[G1 GROUND] --> G2[G2 DECOMPOSE]
    ...
fractal_pipeline: |
  flowchart TD
    Goal[Goal] --> Seeds["goal_seeds()"]
    ...
auth_resolver: |
  flowchart TD
    Start --> Class{classify}
    ...
ground_phases: |
  flowchart LR
    A[approved plan] --> P0[Phase 0]
    ...
oracle_sequence: |
  sequenceDiagram
    E->>E: materialize
    ...
noise_filter: |
  flowchart TD
    A[freeze anchor] --> R[receive]
    ...
metric_governance: |
  flowchart TD
    F[output] --> Q{.quality()}
    ...
bug_fix_chain: |
  flowchart LR
    ET[ERROR_TEST] --> TF[TRIAL_FIX]
    ...
epistemic_ladder: |
  flowchart LR
    U[Unknown] -->|web| G[Guess]
    ...
oracle_flow: |
  flowchart LR
    Decl[declare] --> Mat[materialize]
    ...

# ─── 03_schemas.txt ───
<schemas>
@schema: action_class
@schema: master_plan
@schema: execution_envelope
@schema: explorer_goal
@schema: stamps
@schema: clean_next_state
@schema: sv_output
@schema: msg_tag
@schema: blocker
@schema: signal_cluster
@schema: bug_fix
@schema: claim_ledger

# ─── 04_algorithms.txt ───
<part id="algorithms" label="Live decision algorithms">
noise_filter:
  rule: "COLLAPSE, never FILTER OUT. 60 identical errors = 1 signal."
  distance: Manhattan (L1) — preserves per-axis interpretability
  formula: δ(s,a) = Σ|w_s(k) - w_a(k)|
  collapse_gates:
    cascade: "n>1 ∧ source∈{LSP,...} ∧ pattern matches cascade regex"
    high_cardinality: "n≥5 — same source+pattern firehose"
    content_similarity: "n≥2 ∧ content≥30 chars identical"
  classification:
    CONFIRMATION: "δ < θ — signal aligns with anchor"
    DIVERGENCE: "δ ≥ θ — re-anchor first"
  theta: adaptive (default 0.3, median+0.1 when ≥5 signals)

classify:
  model: |
    action_class: {activity, effect, risk}
    within envelope → MODIFY_CANDIDATE pre-approved
    PROMOTE_STABLE, SELF_MODIFY → always explicit approval

metric_governance:
  PARAMETER_ADAPTATION: automatic within bounds (percentile, window, threshold)
  METRIC_FAMILY_CHANGE: requires governance (branch+holdout+oracle+promotion)
  quality_threshold: 0.5

bug_fix_chain:
  stages: [ERROR_TEST, TRIAL_FIX, REAL_FIX, TARGETED_TESTS, DONE]
  deadloop: "≥2 STUCK in last 3 → STOP + universalsearch web+code"
  STUCK: "δ < 0.3"
  REFINING: "0.3 ≤ δ < 0.5"
  DIVERGING: "δ ≥ 0.5"

# ─── 05_epistemic.txt ───
<part id="epistemic" label="Epistemic Status & Oracle">
separations:
  - "Salience ≠ Evidence"
  - "P_θ(claim) ≠ epistemic status"
  - "Fluency ≠ Truth"
  - "claim confidence ≠ permission to act"

status_set: [Exact, Inferred, Hypothetical, Guess, Unknown]

weakest_link: effective(n) = min(status(n), min(effective(deps)))

research_ladder:
  Unknown: "→ web search → Guess"
  Guess: "→ code search → Hypothetical"
  Hypothetical: "→ dependencies inferred → Inferred"  
  Inferred: "→ oracle PASS → Exact"
  Exact: "→ oracle FAIL → Guess (demotion)"
  forbidden: "Unknown → self-Exact"

classifier:
  Exact: "valid oracle_stamp or direct_evidence_stamp"
  Inferred: "valid inference_stamp ∧ all deps∈G ∧ DAG acyclic"
  Hypothetical: "falsifier declared ∧ no stamp"
  Guess: "weak / P_θ alone / oracle FAIL"
  Unknown: "else (empty, contradiction, circular)"

grounding_set:
  G: "{c | σ(c)∈{Exact,Inferred} ∧ stamped ∧ not expired ∧ revision valid}"
  legal_plan: "∀p∈premises: p∈G"

oracle:
  contract: "ACCEPT(I) ⇔ Oracle(I, contract, project) = PASS"
  flow: "declare → materialize → run → PASS(stamp→Exact) | FAIL(demote→Guess)"
  self_certify: "REJECTED — Bare [Exact] without stamp = Guess"

# ─── 06_hygiene.txt ───
<part id="hygiene" label="Shared behavior">
commit: "NEVER commit unless user explicitly asks"
code_refs: "file_path:line_number"
approach_only: "answer; do not jump to mutate"
do_what_asked: "nothing more"
invent: "Never invent URLs, secrets, or exact names. Search first; if missing — ASK"
secrets: "gitignored config only; prefer certs over passwords"
workspace_lanes:
  experiments: scratch
  futures: drafts
  obsolete: deprecated
  makeups: stubs
recover_facts:
  method: "messagesearch → locate; session-read → raw window"
  rule: "Do not replay whole sessions"
```

## Files changed

| File | Action |
|------|--------|
| `reasoning/00_map.txt` | Rewrite — header only, no Mermaid |
| `reasoning/01_gates.txt` | Rewrite — gate graph + algorithm_routing, no diagrams/schemas |
| `reasoning/02_diagrams.txt` | **NEW** — all 10 Mermaid diagrams with ids |
| `reasoning/03_schemas.txt` | **NEW** — all @schema: markers |
| `reasoning/04_algorithms.txt` | Rewrite from old 02_algorithms.txt — prose→YAML |
| `reasoning/05_epistemic.txt` | Rewrite from old 03_infomark_oracles.txt — prose→YAML |
| `reasoning/04_hygiene.txt` → `06_hygiene.txt` | Move (rename), already clean |
| `reasoning/02_algorithms.txt` (old) | **DELETE** |
| `reasoning/03_infomark_oracles.txt` (old) | **DELETE** |

## Token savings

- Mermaid diagrams: 10× inline → 1× grouped block with ids — no duplication
- Prose→YAML: ~200 lines of prose become ~80 lines of YAML
- Gate summaries (G5/G7/G8/G9 at end of 01_gates.txt) — already in gates YAML, removed

## Smoke tests

```bash
python build.py --full
python -m pytest prompts_kernel/tests/ -q
```
Target: 482 passed, 0 skipped, 0 failed.

## Key invariants

1. `@schema:` markers must still resolve — assembler regex unchanged
2. Fragment sort order: 00_map, 01_gates, 02_diagrams, 03_schemas, 04_algorithms, 05_epistemic, 06_hygiene
3. No `# ` prefix in fragments — stripped by assembler
4. Gates YAML stays in `core_schemas.yaml`, injected via `@schema: gates`
