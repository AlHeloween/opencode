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

### F2 — Contracts & formulas (§2 digest/reward/catalog, §1.4 fields, §1.5 classes)
- [ ] `@DIVERGENCE_PROTOCOL`: digest := hash(canonical statement / scope / dependency_digests / oracle_ref / context_ref), record algorithm + serialization; content_hash := hash(bytes).
- [ ] `@REWARD_FUNCTION`: computable form — `1 − dSV/2` renormalized, FLOPs measured only, freeze frame, refutation stays progress, advisory-only.
- [ ] `@CATALOG_INVARIANT`: `effective_rights := runtime_ACL ∩ user_authority ∩ identity_allowlist ∩ envelope`; “delegation only narrows”.
- [ ] `state_contract` fields: CLAIM `scope/dependencies/assertion_status`; RISK `state`; OUTCOME `pass|fail|unknown`; STAMP `UNKNOWN` + refs; DIVERGENCE `cause`; MASTER_PLAN `state` — with the candidate's caution «added fields/enums require consuming-schema support before installation».
- [ ] `action_classes`: READ vs network retrieval / purchases (`EXTERNAL_EFFECT`); SELF_MODIFY draft = `MODIFY_CANDIDATE`; “tests/builds with writes are not READ merely because called validation”.
- [ ] Tests + budget check.

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
