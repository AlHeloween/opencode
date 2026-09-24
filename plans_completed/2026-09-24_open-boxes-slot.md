<!-- intention: a task the agent decided not to do stays `- [ ]`, so the plan reads as owed work and lingers in plans/ as a time bomb -> closure has to enumerate every open box, and a task not done is closed `[~]` with its reason -->

# open_boxes — closure enumerates what the plan still shows as owed

state: COMPLETED 2026-09-24 — authorized by the owner (variant 1 of three); behavioural smoke is
the recorded residual
owner: Alexander
surface: `prompt_kernel/source.py` (one state-contract slot), `prompt_kernel/addons.py`,
`prompt_kernel/addons_claude.py`, `prompt_kernel/tests/test_addons.py`; no product code

## Why

Owner, 2026-09-24: «чтобы не было: 1,2,3 сделали 4,5 не стали делать потому что не надо, ииии это
болтается в планах как бомба с часовым механизмом.»

The mechanism already exists in the product and the kernel never names it:
`packages/opencode/src/util/plan-status.ts:9` — "`[x]` and `[~]` both count as complete — only
`[ ]` means incomplete"; `reconcilePlans` moves a plan with no `[ ]` to `plans_completed/` by itself.
Neither the kernel nor any addon mentions `[~]`, so a dropped task keeps `[ ]` and reads as debt.

A SLOT, not a sentence (docs/kernel-quality-doctrine.md — a slot beats an imperative; same move as
`form_holds`): a field has to be filled, so it forces the enumeration an imperative only requests.

## Tasks

- [x] **T1 — slot.** `CLOSURE_PROOF` gains `open_boxes`:
      `{acceptance_coverage, oracle_result, critical_risks, residual, open_boxes}` (+12 B, all three
      variants — it lives in `source.py`).
- [x] **T2 — marker, product.** `addons.py` G9 `PATH_CLOSURE`: replace the duplicate
      "done -> plans_completed/; scan plans for stale refs." (the next line already carries
      SUCCESS -> plans_completed/) with "undone task -> [~] + reason; scan plans for stale refs."
      `test_addons.py:40` moves in the same change.
- [x] **T3 — marker, claude.** `addons_claude.py` G9 `PATH_CLOSURE`: the same clause inserted
      before "Scan plans for stale refs." (this variant has no duplicate to replace).
      Codex: slot only — its `PATH_CLOSURE` is repo-agnostic and `[~]` is this repo's convention.
- [x] **T4 — build.** pytest → `--install` → repin `baseline.json` → `--claude --install` →
      `--codex`; release note appended to docs/kernel-release-2026-09-24.md. The codex artifact is
      rendered in `dist_codex/`; `~/.codex/AGENTS.md` is outside the repo and was NOT installed.

## Smoke Tests

- **baseline (captured before any edit):** `python -m pytest prompt_kernel/tests/ -q` → 107 passed;
  product render 46 969 B / 47 000; `open_boxes` and `[~]` absent from every render.
- **post-change:** suite green; `open_boxes` found in the product receiver and in
  `.claude/reasoning_kernel.md`; "undone task -> [~] + reason" found in both; product render
  ≤ 47 000 B; claude render ≤ 47 000 B; `baseline.json` carries the new sha.
- **post-change result — PASS ✓:** 107 passed; product 46 984 B sha `90195dc3…9a9e4f7a` (baseline
  repinned, prev `dc981bc4…`), claude 46 965 B sha `cec10f31…e55d40f0`, codex 46 504 B; `open_boxes`
  and "ndone task -> [~] + reason" found in both installed receivers (read back from the files).
  Intermediate red, expected and recorded: before install, 3 currency tests failed (receivers stale).
- **behavioural, residual:** the next closed plan shows no `[ ]` for a dropped task. Not observable
  until a new session (claude) or a promoted build (product).

## Risks

| risk | containment |
|---|---|
| the slot is filled with a count, not a list | the addon line names the one action for an undone task: `[~]` + reason |
| ceiling exceeded | the byte budget test fails before install; measured before commit |

## Rollback

Revert the commit and re-run the three install commands; repin `baseline.json` to the previous sha
`dc981bc4…`.
