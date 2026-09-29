# Kernel release 2026-09-29 — tool readiness before testing, directed edits, systematic outcomes

Plan: `plans/2026-09-28_kernel-candidate-incorporation.md` (phases F6, F7 and the LEAN/SVM follow-up).
Depth: L2 (normative), owner-directed rule by rule; every diff was shown before install.
Source of the procedure layer: `prompt_kernel/candidate/reasoning_prompt.final.txt` (85 606 B). Its runtime
half (missions, leases, receipts, ~15 records) is NOT ported — it names machinery no host has; it lives in
`plans/futures/2026-09-29_mission-runtime-for-kernel-procedures.md` with a named return condition.

## What changed

**Testing and tool readiness** — the mechanism none of the three hosts had.
- `@TEST_INVARIANT`: an assertion is a fallible encoding of the requirement; ground code and test against
  the requirement, never each other; failures are IMPLEMENTATION | TEST | SPEC_GAP | HARNESS; no weakening to
  get green; tests before code. A red after an edit is first a question about the TEST — code fitted to a
  stale test breaks what the requirement protects (owner: «подгонять код под тест, а тест устарел»).
- `@SURFACE_PREPARATION` + term `WORK_KIND`: CHANGE starts from READY (code AND tests read, the test proven
  to run the intended build, isolated baseline PASS); a red baseline is STABILIZE with its own commit; a new
  surface is READY from its enclosing baseline plus a failing new test; an expected-before mismatch stops.
- `@CAUSAL_ATTRIBUTION`: «pre-existing» is a claim proven on the before revision, not an exemption.
- `@TOOLCHAIN_QUALIFICATION`, cited from G3 — readiness is planned BEFORE testing: primitives derived from
  the oracle, a deterministic fixture, a bridge probe; qualified over the job's whole input domain (a
  half-working tool is BROKEN, not scoped — «полуработающая дрель… половину дырок»); a tool failing
  mid-test voids the run, never patched in flight nor the results fitted to it (a Codex run: the mouse could
  not click, and the agent fitted first the tools, then the results). New edge `G6 → G2`: a required tool is
  unqualified — the harness is the next leaf.
- `@KAIZEN`: a tool defect stops the line; the second occurrence of a class forbids another workaround; the
  standard is updated in the same change; cheapest primitive check before first dependent use.

**Memory without self-winding.** `@ANTI_CHURN`: memory is not a vote; our own artifact adds no provenance
root — a self-written alarm acts only after its reproducer fails NOW (owner: «артефакты будут нести ложную
тревогу»); `ISSUE_KEY = (acceptance, surface, reproducer)`, so reclassification cannot reset a counter.

**Direction.** SVM = **State Vector Manifest** (ADID 12.2 §I.3): the digital form of the intention, seeded
at G0, grown fractally at G2 (one goal_hierarchy level each), filled at G3, handed on at G7; a briefing that
points to evidence, never evidence itself. Every artifact carries its OWN semantic vector; `PLAN_BINDING`
gains `sv`, and G7 `EDIT_SV` names it before the edit and reads the diff back against it — missing sv,
isolated smoke or READY surface means no direction, and a PASS without them is a random win.

**Systematic outcomes (the trader's rule).** `@SMOKE_BEFORE`: predict each case before the run; an outcome
off the prediction, an unexpected PASS included, is a forecast error. `@DIVERGENCE_PROTOCOL`: divergence is
transitive over the premise — past PASSes included — and triggers FULL re-grounding: hands off, persist the
new facts to memory and compact (the model's sleep), re-read docs, code and tests from disk, re-baseline.

**LEAN reach.** G8 `LEAN_BEFORE_PROOF`: no oracle is spent on a premise `@LEAN_RANKING` has not admitted;
tier 3/4 is never proven («ковыряние и доказательство ерунды»). `@BUG_FIX_PROCEDURE` classifies the report's
expected behavior before the reproducer.

**BGE-M3 dedup and ordering** (`experiments/2026-09-29_kernel-semantic-dedup/`, CUDA): two ADID §II.4.3 rules
merged into `@VALIDATE_BEFORE`; SUCCESS defined once; the `@SOURCE_ROUTING` header encodes its field names
once (every authority kept): −462 B. Tool-row dedup rejected by measurement (8 B). G4/G8 core rules reordered
by seriation: p12/p27 → p100 against 500 random permutations, re-measured after the edit.

## Numbers

- Render (production): 49 032 B → **56 367 B** / 7 414 tokens (claude 7 532, codex 7 438); caps
  `utf8_budget` 51 000 → **57 000** and tokens 7 000 → **7 700** (raised together in `test_dedup.py`,
  `test_addons_claude.py`, `test_addons_codex.py`), each step measured and reasoned in `source.py`/tests.
  Intermediate install `11add404…` (commit `39e04ddbe7`).
- Outside falsifiers on the rendered diffs: frameless Sonnet (`claude -p`, six rounds) and space-bunny-free
  (one round, findings read from its truncated reasoning) — **51 findings: 47 real and closed, 1 a partial
  misread clarified anyway, 3 false** (the model saw a partial diff). Round 6 alone found a loop (a flaky
  outcome re-triggering re-grounding) and three dead ends. Pinned in
  `test_render.py::test_procedure_layer_keeps_its_decisions`.
- Tool check for the Claude variant, cheapest primitive per tool, prediction first: two add-on ABSENCES were
  false (session history search and window fill both exist now) and Glob is half-working at the repo root —
  all three corrected in `addons_claude.py`.

## Tools

- `tools/aicall.py`: `--timeout` and `--out` (the fixed 300 s window killed a 32 000-token reasoning call;
  a caller's `2>&1` spliced stderr into the JSON). Smoke: exit 0, JSON parses under `2>&1`.
- Recorded tool classes: BGE pair ranking by FORM on schema lines (filter fixed); Glob timing out at the
  repo root (ripgrep 20 s) — a KAIZEN countermeasure is owed.

## Residuals

- F2 compression (LEAN/SVM wording, the rest of the add-on literals) and a BGE dedup pass over the new
  text — the budget is nearly spent (claude variant ~7 460 / 7 500 tokens).
- G8 add-on reordering needs a registry restructure across three variants (`test_variant_parity`).
- The mission runtime: `plans/futures/2026-09-29_mission-runtime-for-kernel-procedures.md`.
