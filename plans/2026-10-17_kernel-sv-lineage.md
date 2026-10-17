<!-- intention: SV md5s collide across turns -> received SV md5 becomes receiver parent-goal-md5 and own md5 is freshly minted -->
# t82 — kernel: received SV md5 becomes receiver parent-goal-md5

Owner 2026-10-17: a task arriving with an SV carries that SV's md5 as the receiver's
`parent-goal-md5`; the receiver mints its own `md5` fresh. Equal own-md5s are always a
defect; equal parent-goal-md5s are lineage.

## Grounding (G1)

- `prompt_kernel/render.py:89-107` (`_render_sv_contract`): `parent-goal-md5` bullet only
  anchors to `@DIGITAL_INTENTION`; nothing about a received SV. CHANGE surface.
- `prompt_kernel/source.py`: `SV_CONTRACT` digest chain, `CURRENT_SV`, G7
  `DELEGATION_BINDING` (hands `@SV_TARGET`, not an SV), `SEMANTIC_ATTENTION`
  `SV_TARGET`/`MULTI_AGENT_SV`, `DELEGATION` `FRESH_EYES` — no receiver rule. No change.
- `prompt_kernel/validate.py:12` (`EXPECTED_SV_DIGEST`) — chain shape only; no lineage
  check. No change.
- `prompt_kernel/addons*.py` — no SV lineage restatement (only fossil `sv:<md5>` mention
  + `prev-md5` break note); parity holds vacantly. No change.
- Evidence re-measured 2026-10-17 (BUILD_MODE, assistant text parts via `part`+`message`
  join): 823 parts, 811 own-`md5` blocks, 806 distinct, 96 bad-length, 4 md5 with >1
  dominant (e.g. `7f3a9c1e4b5d6a8c9e0f1a2b3c4d5e6f` x3 under 3 dominants). Fossil
  `sv:` comments show the same reuse shape. Researcher re-delegation blocked by ACL
  (`dbread`/`fossilgrep` deny) — parent measured directly; residual route recorded.

## Tasks

- [x] T1 RED test `prompt_kernel/tests/test_sv_lineage.py` states both halves on all 4
      renders + mutation control dropping either half is rejected (RED: 5 failed, run 20261017T111314Z_29fb9c8c)
- [x] T2 Additive generator edit in `prompt_kernel/render.py` only (shared render => 4-variant
      parity), no cap move (product 67654 B + 188 B = 67842 B < 68000)
- [x] T3 Oracle `python -m pytest prompt_kernel/tests/ -q` + 4-variant render print (sha)
      (311 passed, 3 stale-receiver reds named; renders product 67842 28474dfc / claude 67634 cec65930 / codex 67553 f6a8f112 / cursor 67595 57d645be, run 20261017T111359Z_a3b3a940)

## Smoke Tests

- Baseline (pre-edit): new test FAILS on all 4 renders (missing lineage sentences);
  full suite otherwise green except named stale-receiver guards.
- Post-change: new test PASSES on all 4 renders; `test_runtime_is_deterministic_lf_and_within_utf8_budget`
  PASSES (no cap move); `test_pre_action_section_stays_small` PASSES; variant parity
  (`test_shared_bindings_keep_one_spelling`, registries slots) PASSES.
- Expected delta: RED -> GREEN on the new test only; no other test changes state.
- Stale-receiver guards (`test_claude_kernel_is_installed_current`,
  `test_cursor_rule_receiver_is_current`, `test_codex_artifact_is_current`) need
  `--install` and stay red; named, not fixed here.
