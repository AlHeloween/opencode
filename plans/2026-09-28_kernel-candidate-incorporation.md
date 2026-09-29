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
- [ ] `@INFORMATION_STATUS`: verified source wording ≠ verified reported proposition; decisive FAIL → REFUTED, inconclusive → UNRESOLVED; changed evidence/scope/artifact requires fresh verification.
- [ ] `@EVIDENCE_ORDER`: requirements cannot be skipped; redundant intermediate searches can.
- [ ] `@BUG_FIX_PROCEDURE`: no reproducer = unconfirmed (not hallucination); flaky criteria; trial may be a patch/worktree; verify the applied artifact.
- [ ] Tests.

### F4 — Composition & precision (§0/§1/§4)
- [ ] G0: DIGITAL_INTENTION is internal state, not a compulsory separate reply.
- [ ] `@CURRENT_SV`: once per completed assistant turn (not per tool call); never inside generated artifacts; host-schema omission clause.
- [ ] `@INTENTION_RESET`: `observed_at` adds G1/G3/G4/G5.
- [ ] Notation header (§1) only if it pays for itself (formulas are defined in-place today).
- [ ] Recorded rejections: candidate `gates:`/`may_mutate:` and `action_classes` rows in §5 — our identity tool rows win (owner, 2026-09-28); candidate `host_bindings` content — host layer stays in add-ons (only a host-agnostic “no listed name asserts availability” principle may land in §1).
- [ ] Compression pass only if the cap needs it (three gates from docs/gate-addons.md; never cut a decision).

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
