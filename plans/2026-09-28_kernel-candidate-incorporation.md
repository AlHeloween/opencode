# Kernel incorporation — candidate optimizations (graph, budgets, contracts, statuses)

<!-- intention: incorporate the candidate kernel's stronger mechanisms (complete edge graph, real budgets, digest/rights formulas, knowledge statuses) into prompt_kernel/source.py via L2 cycles; never replace the file -->

- status: ACTIVE
- depth: L2 (SELF_MODIFY — normative)
- owner approval (2026-09-28): «у тебя правильные рекомендации. Поехали.»
- source: `prompt_kernel/candidate/reasoning_prompt.final(3).txt` — 38 321 B / 4 397 tok, 517 lines; contract gaps = `CHECKSTATE` only; candidate @refs resolve fully in our symbol table (no unknown symbols)
- baseline (closed cycle 2026-09-28): render 48 274 B / 6 290 tok; caps 49 000 B / 7 000 tok; install `ac3e8d51…`; pytest 117 passed; parity 21/21; PIN_OK; commits `10fb48c` + `4eee2b8a1d` + `383d69a2d5`

Ground rule: incorporate via `prompt_kernel/source.py` + addons, one phase per L2 cycle (render → pytest → diff to the owner → install + repin). Do NOT replace the rendered file. Candidate has no host layer; our add-ons (~11 KB of host specifics) stay ours. Candidate wording is often denser — prefer it where it is equal, to pay for the new norms.

## Phases

### F1 — Workflow graph & budgets (§0, §2 @LOOP_PROGRESS, §1.4 BOOTSTRAP) — DONE 2026-09-29
- [x] `control_flow_rule` now ends «Terminal ends this run; protocols cannot reopen it.» and names
      `interrupt` among the declared deviation kinds (`render.py:248`).
- [x] Edges: forward branch `G6→G8` (read/plan-only deliverable), back `G7→G3` and `G9→G8`.
      `ANY_ACTIVE→G9` maps as a NEW edge kind `interrupt` carrying the map's only wildcard source
      (`* -> G9`); `validate.py` refuses `*` for every other kind, and `test_architecture` pins both
      the single forward branch and the single interrupt, so a second one is a deliberate act.
      The `G9→WAITING_APPROVAL` STALL condition is UNCHANGED — the candidate's «obtainable user
      decision» wording was NOT absorbed, because it would re-open the door the 09-27 revert closed.
- [x] `@LOOP_PROGRESS` → budget system under `@BOOTSTRAP`: step/tool/loop/depth/time_ms set at G0,
      bound at G4, reserved by children and never renewed by split/revision/mode/compaction;
      increase needs external authority; exhaustion or STALL → G9, where closure decides and descent
      `G9→G1/G2` stays available. Kept from ours: «a pass with no instrument result, claim or residual
      is a retry, not progress».
- [x] `state_contract`: `BOOTSTRAP` added; `EXECUTION_ENVELOPE` gains
      `step_budget, tool_budget, depth_budget, time_budget_ms, plan_id, revision`.
- [x] Oracle: `python -m pytest prompt_kernel/tests/ -q` → **119 passed** (117 + the 2 new gates),
      run after the install in the same session. Installed: production sha256 `17c7505d…` (49 498 B),
      claude `1d75982f…` (48 235 B), codex `c0563f4b…` (47 814 B); tokens 6 455 / 6 349 / 6 283 ≤ 7 000.
      `utf8_budget` 49 000 → **50 000** with the measured reason in `source.py` (49 498 measured);
      `baseline.json` advanced (`prev_sha256` = the 09-28 install).

### F2 — COMPRESSION PASS (candidate as the measure of density), not an add pass
Owner correction (2026-09-29): the file was given to CUT prose — «я специально дал тебе этот файл
чтобы по возможности порезать прозу, проверь формулировки в аддонах» — and F2 as first drafted had
turned the candidate into a source of additions. Reviewed and re-based:
- [ ] Rewrite the longest rules in the candidate's density where the content is EQUAL — measured
      targets (rendered chars per line): LEAN tiers 1 081, `@INFORMATION_STATUS` 501, `@ORACLE` 489,
      `SVM` 487, `@BUG_FIX_PROCEDURE` 468, `@MANHATTAN_L1` 467, `BOUNDED STOP (DONE)` 455, the G1
      instrument chain 452. Every replacement keeps EVERY decision and any address (field names,
      paths); a rule may shrink only where the candidate's own text is the smaller equal form.
      PASS 1+2 DONE 2026-09-29: `@BUG_FIX_PROCEDURE`, `@GUESS_DECIDES_NOTHING`, `@EVIDENCE_ORDER`,
      `@CURRENT_SV`, G1 `MEMORY_RANK`/`INSTRUMENT_LAYER`/`INSTRUMENT_ORDER`/`LOUD_FAILURE`/
      `INSTRUMENT_RUNG`, `BOUNDED_STOP_CONDITIONS`, action-class lines, and six add-on strings.
      STILL OPEN: the LEAN line (pinned by test_render), `@INFORMATION_STATUS`, `@ORACLE` local rules,
      `SVM`, `@MANHATTAN_L1`, `@ONE_STEP_AHEAD`, and the rest of the add-on literals (10.7 KB / 152
      entries — six tightened so far). Instrument: `experiments/2026-09-29_kernel-cut-targets/sizes.py`.
- [ ] Sweep the add-ons for wording (product + claude + codex): `addons.py` carries 10 738 B of string
      literals across 152 entries — the same facts phrased looser than the candidate's e.g. the style
      list (done), the `state.json` report line (done), the ISO double citation in `@ACCEPTANCE_FRAME`
      (done). Cut WORDS, never a decision or an address. The claude/codex twins carry their own copies:
      sweep them with the same pass, not blindly — their tool rows differ by design.
- [x] TAKE only clauses that close a MEASURED defect, folded into lines being rewritten anyway:
      §1.5 gains «Classification follows actual effects; classes may combine» (landed in G4's
      `ACTION_CLASS_RULE`, not as a non-class row — `set(kernel.action_classes)` is a namespace),
      «writes are not READ for being called validation», PLAN_WRITE widened to ledgers/progress
      records, MODIFY_CANDIDATE «no install/promotion authority», SELF_MODIFY «an uninstalled draft
      alone is MODIFY_CANDIDATE»; `@EVIDENCE_ORDER` gains the redundant-searches clause;
      `@CURRENT_SV` is once per completed turn and never inside artifacts. Oracle: pytest **119
      passed**, production `2e076258…` (49 352 B), claude `88069978…`, codex `e16216dd…`; net
      49 498 → **49 352 B** with NO budget raise.
- [x] REJECT (recorded, do not revisit): per-identity `action_classes` rows — our §5 tool rows
      (IDENTITY_ADDONS + parity test) already say WHO may call WHAT, and a category row would answer
      nothing the rows do not, while looking like authority; the candidate's READ network/purchases
      clause (EXTERNAL_EFFECT already states it); the whole `host_bindings` section (host layer is the
      add-ons); the state_contract field additions that have no consumer today. Owner, 2026-09-29:
      «что нам дают action classes вместо реальных тулов» — nothing; the layer is a classification
      axis (G4 + envelope binding), never a permission list.
- [ ] Budget: the additions above must fit inside what the cut frees — NO further `utf8_budget`
      raise this phase; oracle = kernel pytest + render bytes/tokens, with test fragments that quote
      moved text updated in the same change.

PASS 3 DONE 2026-09-29 (owner direction: shorter formulations + PROCEDURES that raise autonomy;
the candidate's generic host layer is a fish drawn without our tool list and is not ported):
- Four algorithms landed, each bound to OUR layers: `@DIVERGENCE_PROTOCOL` names the digest INPUTS
  (statement, scope, dependency digests, oracle_ref, context_ref; excluding status/stamps/itself;
  algorithm + serialization recorded); `@REWARD_FUNCTION` is computable (`R := weighted_mean(1 − dSV/2, …)
  − 0.05·critical_risks_open`, weights renormalized over measured terms, undefined term omitted,
  no terms → Unknown, freeze frame, uncontained critical risk vetoes, refutation stays progress);
  `@CATALOG_INVARIANT` carries `effective_rights := runtime_ACL ∩ user_authority ∩ identity_allowlist ∩ envelope`
  («delegation only narrows» — identity_allowlist IS the §5 tool rows); `@INFORMATION_STATUS` gained
  «Verified source wording is not a verified proposition».
- Nine add-on strings tightened (DISAS, TOOL_HEALTH ×2, ASSERTION_STATUS, RUN_ARTIFACT_FIRST,
  PATH_AGI_WORKOUT_LOG, PATH_CLOSURE, SEARCH_OUTPUT_SHAPE, ACCEPTANCE_PASS).
- PINS RE-READ FIRST: the DIVERGENCE rewrite broke five phrases `test_render` pins as the 09-24 PULL
  decision; fixed by keeping every pinned phrase verbatim with the algorithm slotted in. Rule for the
  rest of the sweep: grep CORE_SUBSTANCE + test_render asserts BEFORE rewording a rule, never after.
- Net F2 across passes 1–3: 49 498 → **49 685 B** (algorithms inside the declared 50 000 cap, no
  further raise); pytest **119 passed**; production `c24a80d5…`, claude `bb11e41f…`, codex `916251c5…`.

PASS 5 (2026-09-29) — WATER HUNT, owner-directed («мы раздуваем файл» / «ищи полотна текста которые
написал клауд»), with `aicall` as the instrument the owner named:
- RESULT: 49 498 → **49 032 B** (−466) INCLUDING ~+600 B of new schema/ads landed the same pass, i.e.
  about **1 KB of prose cut** with every decision and every pinned fragment intact — and the declared
  50 000 cap no longer needs the raise that was briefly proposed. pytest green after install;
  production `1d74933b…`, claude `c0f90c5f…`, codex `0258deac…`.
- WHERE THE GAP WITH THE CANDIDATE ACTUALLY COMES FROM (measured, `sizes.py`): our CORE is at parity
  (≈38.4 KB vs their 38.3 KB total); the visible ~11 KB is our host add-on layer, which the candidate
  does not carry at all (its `host_bindings` is ~2.2 KB of generic placeholders — «рыба», not ported),
  plus ~5–6 KB more gate-local rules. So «сделать как у чата» = dropping coverage, not editing prose.
- MODEL COMPRESSION CEILING, measured: space-bunny-free rewrites our normative blocks by only 10–20%
  before decisions start dying (LEAN 1081→~940, MANHATTAN −14%, BOUNDED −15%); the pins and identifiers
  set a hard floor. The cut that counts is choosing what NOT to say, which is an owner call.
- NAMED STRUCTURAL CANDIDATES (his call, not taken): (1) `1.3 @SOURCE_ROUTING` table 2.4 KB → move to
  docs/, kernel keeps the rule («THE SPLIT IS THE ECONOMY»); (2) gate-local rules §3 core ~13.5 KB vs
  candidate 7.8 KB — trim rules that restate what §2 already decides; (3) the add-on layer 11 KB — each
  line is a measured lesson; which lessons the kernel still needs is a coverage decision.
- TOOL FINDINGS (recorded, all cost a turn): the JS `aicall` REQUIRES `provider` (a bare model id yields
  ProviderModelNotFoundError; with `provider=opencode` it works) and `nemotron-3-ultra-free` fails with
  its cause hidden by `.pipe(Effect.orDie)`; a ~7 KB prompt returned EMPTY output from a free reasoning
  model at max_tokens 12000 while the same batch answered at 32000 — budget spent on thinking. `multiedit`
  twice reported «none applied» while 2–4 of its edits were in the file: read STATE after any edit, never
  the report (the 9th instance of the filter class, and the second one inside `multiedit` itself).

### F3 — Knowledge statuses (§2)
- [~] `@INFORMATION_STATUS`: verified source wording ≠ verified reported proposition; decisive FAIL → REFUTED, inconclusive → UNRESOLVED; changed evidence/scope/artifact requires fresh verification.
      PARTIAL (2026-09-29): «Verified source wording is not a verified proposition» landed in F2 pass 3 (`source.py:47`, installed render); REFUTED/UNRESOLVED split and fresh-verification clause NOT landed.
- [x] `@EVIDENCE_ORDER`: requirements cannot be skipped; redundant intermediate searches can.
      Landed in F2 cut pass (`0e3853c2c2`); artifact: `source.py:42` + installed `.claude/reasoning_kernel.md`; pytest 119 passed 2026-09-29.
- [x] `@BUG_FIX_PROCEDURE`: no reproducer = unconfirmed (not hallucination); flaky criteria; trial may be a patch/worktree; verify the applied artifact.
      Landed in F2 cut pass (`0e3853c2c2`); artifact: `source.py:110` + installed render; pytest 119 passed 2026-09-29. F6 supersedes it with the STABILIZE sequence.
- [ ] Tests. OPEN: none of the F3 phrases is pinned by a test (grep over `prompt_kernel/**/*.py` finds them only in `source.py`) — pins land with F6.

### F4 — Composition & precision (§0/§1/§4)
- [ ] G0: DIGITAL_INTENTION is internal state, not a compulsory separate reply.
- [~] `@CURRENT_SV`: once per completed assistant turn (not per tool call); never inside generated artifacts; host-schema omission clause.
      PARTIAL (2026-09-29): first two landed (`source.py:72`, F2 cut pass); the host-schema omission clause («strict schemas: permitted metadata channel or higher-priority omission») NOT landed.
- [ ] `@INTENTION_RESET`: `observed_at` adds G1/G3/G4/G5.
- [ ] Notation header (§1) only if it pays for itself (formulas are defined in-place today).
- [ ] Recorded rejections: candidate `gates:`/`may_mutate:` and `action_classes` rows in §5 — our identity tool rows win (owner, 2026-09-28); candidate `host_bindings` content — host layer stays in add-ons (only a host-agnostic “no listed name asserts availability” principle may land in §1).
- [ ] Compression pass only if the cap needs it (three gates from docs/gate-addons.md; never cut a decision).

### F6 — Procedure layer from `reasoning_prompt.final.txt` (testing, memory cut-off, tool readiness)
Owner, 2026-09-29: «самое главное грамотно дернуть процедуры… кратко и лаконично, там по поводу
тестирования, отсечения механизма рекурентной памяти (digital soul), и порядок подготовки тулов к работе».
Source: `prompt_kernel/candidate/reasoning_prompt.final.txt` (85 606 B) — the procedure layer (3) lacks.
The runtime half (MISSION_CONTROL, RECOVERY_CHECKPOINT, OPERATOR_CHANNEL, leases/receipts, ~15 records)
is NOT ported — owner: «по рантайму просто напиши свои соображения в futures»; done:
`plans/futures/2026-09-29_mission-runtime-for-kernel-procedures.md`.
Artifact for the boxes below (source-level, pre-install): `python -m pytest prompt_kernel/tests/ -q` →
117 passed + 3 install-staleness reds (compatibility, claude installed, codex artifact — they clear on
`--install`); pin test `test_render.py::test_procedure_layer_keeps_its_decisions` PASS; rendered diff
`experiments/2026-09-29_kernel-f6-procedures/diff.txt` (+23 −8 lines), render 52 096 B, sha256 `299b8c1e…`.
- [x] `@TEST_INVARIANT` — assertion = fallible encoding of the predicate; IMPLEMENTATION|TEST|SPEC_GAP|HARNESS; no weakening to green; tests before code.
- [x] `@SURFACE_PREPARATION` — READY before CHANGE; red baseline = STABILIZE with its own commit; no stabilize-the-stabilizer; expected-before recheck.
- [x] `@CAUSAL_ATTRIBUTION` — «pre-existing» is a claim proven by the same predicate on the before revision (executes AGENTS.md «no pre-existing errors»).
- [x] `@TOOLCHAIN_QUALIFICATION` — primitives from the oracle → deterministic fixture → bridge probe → READY; missing tool = in-scope task, not an owner question; held-out ≠ calibration; handoff last.
- [x] `@ANTI_CHURN` — memory is not a vote; ISSUE_KEY counters survive restarts/A→B→A; reopen only on stored `reopen_when`; `PERSISTED_CRITERION` keeps its three unique decisions and points to the closure record. PLUS the owner's self-winding objection (2026-09-29, «артефакты будут нести ложную тревогу»): our own artifact adds no provenance root; a self-written alarm acts only after its reproducer fails NOW, else retired.
- [x] Gate hooks: G1 (@ANTI_CHURN), G3/G7 (@TEST_INVARIANT), G6 (@SURFACE_PREPARATION, @TOOLCHAIN_QUALIFICATION), G8 (all four + @ANTI_CHURN); edge G6→G7 «CHANGE only from @SURFACE_PREPARATION READY»; edge G8→G2 names @TOOLCHAIN_QUALIFICATION.
- [x] Pins in `test_render` for every new rule + the three F3 phrases (`test_procedure_layer_keeps_its_decisions`).
- [x] Budget: owner chose «Поднять лимит» (2026-09-29) — `utf8_budget` 51 000 → 52 000 (measured 51 926) → 53 000 after the self-winding clause (measured 52 096); reasons in `source.py`. NOTE: the plan's earlier «50 000 cap» lines are stale — pass 4 had already raised it to 51 000.
- [x] Outside falsifier on the rendered diff. space-bunny-free: exit 3 (300 s timeout at 32 000), then
      exit 5 (all 16 000 tokens on reasoning; findings read from `reasoning`, a FLOOR). Frameless Sonnet
      (`claude -p`, owner: «прогони через sonnet»): 7 addressed findings. Artifacts:
      `experiments/2026-09-29_kernel-f6-procedures/falsifier-sonnet.md`, `falsifier2.reasoning.md`.
- [x] Falsifier findings F1–F10 closed (owner: «Да, давай»): `WORK_KIND` term; READY for a new surface;
      recheck mismatch → stop; causal «and» + INDETERMINATE action; `ISSUE_KEY = (acceptance, surface,
      reproducer)` — reclassification no longer resets the counter; passing regression test stays protected;
      refs G6 (@TEST_INVARIANT), G7 (@SURFACE_PREPARATION, @TOOLCHAIN_QUALIFICATION); NEW EDGE `G6 → G2`
      «a required tool is unqualified; the harness is the next leaf». Pinned in `test_procedure_layer_keeps_its_decisions`.
- [x] `@KAIZEN` (owner: «правил по подготовке тулов нам критически не хватает… Kai Zen»): a tool defect
      stops the line; second occurrence of a class forbids another workaround; standard updated in the same
      change; cheapest primitive check before first dependent use. Cited at G8, G9. Pinned.
- [x] Half-working tool clause in `@TOOLCHAIN_QUALIFICATION` (owner: «никогда не соглашаться… полуработающая
      дрель… половину дырок»): qualify over the job's whole input domain; partial = BROKEN, not scoped. Pinned.
- [x] `tools/aicall.py` Kaizen countermeasures: `--timeout`, `--out FILE`. Smoke: `--out` + `2>&1` →
      JSON parses, `answer='ok'`, exit 0. Skill doc updated in the same change. (The stderr splice was the
      CALLER's `2>&1`, not the script.)
- [x] Owner's tool-readiness point (2026-09-29, a Codex run: app launched for debugging, the mouse could not
      click, the agent fitted first the tools then the results — «!!! Точно!»): `@TOOLCHAIN_QUALIFICATION` gains
      «A tool failing mid-test voids the run: requalify, rerun from the start — never patch the tool in flight or
      fit results to it», and G3 cites it (readiness is planned BEFORE testing). Pinned. Cap 53 000 → 54 000
      (measured 53 124).
- [x] Installed after the owner read the diff («Да»): production `11add404…` (53 124 B), claude `9574738c…`
      (52 951 B), codex `b1c963e2…` (52 530 B); `baseline.json` repinned by hand (`prev_sha256` = `1d74933b…`);
      `python -m pytest prompt_kernel/tests/ -q` → **120 passed** after repin.

### F8 — follow-up to the 39e04ddbe7 install (owner-directed, 2026-09-29)
- [x] LEAN reach: G8 `LEAN_BEFORE_PROOF` + `@BUG_FIX_PROCEDURE` classifies the report's expected behavior
      (owner: «особенно lean… ковыряние и доказательство ерунды»); `@LEAN_RANKING` now rendered as named.
- [x] SVM = State Vector Manifest (ADID 12.2 §I.3): seeded at G0 as the digital intention, grown at G2,
      filled at G3, handed on at G7 (gate requires/outputs; graph edges untouched); a briefing that points to
      evidence. Every artifact owns its SV; `PLAN_BINDING.sv` + G7 `EDIT_SV` (missing direction = no edit).
- [x] Trader's rule: `@SMOKE_BEFORE` predicts per case; `@DIVERGENCE_PROTOCOL` transitive + FULL re-grounding
      (persist to memory, compact, re-read from disk, re-baseline); `@TEST_INVARIANT` stale-test clause.
- [x] Caps: bytes 54 000 → 57 000, tokens 7 000 → 7 500 (all three variants together), reasons in source/tests.
- [x] Outside falsifier: frameless Sonnet rounds 2–6 — over the whole cycle 51 findings, 47 real and closed,
      1 partial misread clarified, 3 false (partial-diff blindness), all pinned. Round 6 fixes funded by the
      token cap 7 500 → 7 700 (owner: «Все 10 + токены 7 700»). Render 56 367 B.
- [x] Tool check for the Claude variant (owner: «свою копию… только убедись что с тулами все хорошо»), one
      cheapest primitive per tool, prediction written first: codegraph_explore PASS; list_free_models PASS;
      search_session_transcripts FOUND history → add-on «(no history search on this host)» was FALSE;
      get_usage REPORTED fill 51 % / auto-compact 97 % → «window fill … NOT reported» was FALSE; Glob at the repo
      root TIMED OUT (4th time) while Glob with a path answered → half-working → KAIZEN countermeasure in the
      add-on (explicit path; `git ls-files` for inventory). Isolated-call line rebound to the routes that
      actually worked (aicall, frameless `claude -p`). Memory `project_claude_host_has_no_window_oracle` revised.
- [x] Docs: `docs/kernel-release-2026-09-29.md`; `docs/gate-addons.md` (current caps; the stale «--codex
      --install fails» corrected); AGENTS.md index line.
- [ ] Commit, release (production + codex install, baseline repin), then the Claude copy.

### F7 — BGE semantic dedup + ordering (owner, 2026-09-29: «прогоним фразы через BGE… уберем лишнее»; «граф есть граф — его двигать не надо. Но вот элементы графа и аддоны — спокойно»)
Instruments: `experiments/2026-09-29_kernel-semantic-dedup/{pairs,order,order_sub,tool_rows}.py` (BGE-M3, CUDA, GTX 1050 Ti).
Run 1 was an instrument defect: schema lines (`identity:`, `tools:`, `shared_rules:`) ranked 1..20 by FORM; filtered.
Prose-only: 375 sentences, knee at cos ≈ 0.80 (p99.9 = 0.723), 10 pairs above it. Owner: «Да, все верно» to the list.
- [x] D1 G9 SUCCESS restated in BOUNDED_STOP → «SUCCESS still needs @CLOSURE_PROOF». Pinned.
- [x] D2 two `ADID §II.4.3` rules (G3 plan, G7 edit; cos 0.797) → one shared `@VALIDATE_BEFORE`, every decision kept. Pinned.
- [x] D3 `generic_web` sentence restating the ladder row removed.
- [x] L1 `@SOURCE_ROUTING` routes: field names once in the header (`routes: discipline: primary | secondary`); all 67 authorities kept.
- [x] L2 tool rows MEASURED and REJECTED: common exclusion set across the 7 rows = 1 name, saving 8 B.
- [x] Ordering G4 core (p12 → p100 vs 500 random permutations) and G8 core (p27 → p100); re-measured after the edit: current = seriated.
- [~] G8 add-ons (p43 → p100 possible) NOT reordered: the optimum interleaves lines of different add-on
      entries, i.e. a registry restructure across three variants under `test_variant_parity`, not a reorder.
- Budget: render 52 970 B against the 53 000 cap — 30 B headroom; the next addition needs a cut or a raise.

### F5 — Release
- [ ] Final pytest + parity suite + typecheck; render vs caps; **diff to the owner**; `--install` + repin; claude/codex receivers refreshed (no identity rows).
- [ ] docs: record the release (amend `docs/kernel-release-2026-09-28.md` or a sibling — one home per fact); update `docs/gate-addons.md` if budgets move.
- [ ] Commits naming this plan; move to `plans_completed/` when boxes close; scan for stale refs.

## Smoke Tests
- Per phase: `python -m pytest prompt_kernel/tests/ -q` (baseline 117) + render bytes/tokens; BEFORE rewording, grep the exact phrase in `prompt_kernel/tests/` — tests quoting rule text move in the same change.
- Release: `bun test test/agent/kernel-identity-tools.test.ts test/tool/registry.test.ts test/tool/kernel-alignment.test.ts` + `bun typecheck` (cmd_runner, from `packages/opencode`); `PIN_OK`.

## Acceptance frame
| # | Criterion | Surface | Instrument | Falsifier |
|---|-----------|---------|-----------|-----------|
| 1 | New edges/conditions render and validate | rendered §0 | kernel pytest | validator error / edge absent |
| 2 | Budgets present in §2 and envelope | rendered §1–§2 | kernel pytest + read | field absent |
| 3 | Formulas exact (digest / rights / reward) | rendered §2 | read + grep | mismatch |
| 4 | No host leakage into source.py | source vs add-ons | review | host path/command in source |
| 5 | Caps respected — or raised with a named reason | render | pytest (`test_dedup`) | silent overflow |

## Risks
- Rewording rules breaks short-fragment assertions (`test_constitution` EXPECTED_CORE, `test_render`) — scan and move with the change.
- Budget growth from new norms — compensate with candidate phrasing where equal.
- §5 stays ours; candidate's stale `gates`/`may_mutate` must not re-enter.

## Residuals
- Claude/Codex identity tool rows (R1 of the closed plan) — unchanged.
- Candidate `host_bindings` as a standalone section — rejected for now; revisit only if the add-on layer drifts beyond repair.
