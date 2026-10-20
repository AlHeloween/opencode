# t114 slice 2 — old→new label map for a batch (after promotion, NOT started)

<!-- intention: chained labels go stale after a batch edit -> return an old-to-new map for every label the agent knew, so no later edit addresses a moved line by its old hash -->
<!-- goal_sv:
```yaml
Keywords: label-remap-batch 0.40, chainHash-stale-labels 0.25, old-to-new-map 0.20, report-budget-8k 0.15
Semantic dominant: Return an old-to-new label map for every hash the agent knew in the edited file so later edits never use a stale chained label.
md5: 5d7c1a9e3f2b4860a1d4c7e9f0b2d4a6
prev-md5: 00000000000000000000000000000000
parent-goal-md5: b89560e8bbec4459b72bebac364fcd6d
note: hash values are generative tags — search them, never compute them.
```
-->

## Goal

Labels are chained (`chainHash`): every line below the first change gets a new label, and the address
report cuts at 8 KB — in a big file the agent keeps stale labels and the next edit fails `stale-hash`
(or worse, lands near). After the slice-1 binary is promoted, return an old→new map for every label
the agent knew in the edited file, so no later edit uses a stale hash.

## Tasks

- [ ] R1 Old→new map: for the file just edited, map every ORIGINAL label (the chain the batch resolved
  against) to its post-edit label (or `deleted`), reusing the same `chainHash`/`hashLabel` the report
  prints. Governing standard: none found (address-report plan `2026-10-09_edit-address-report` covers
  only the forward report) — owner rule in the slice brief is the standard.
- [ ] R2 Wire the map into the `edit` result beside the address report, bounded like it; contract test
  updated in the same change (3×3 docs aspect). Governing standard: t93 description-contract.
- [ ] R3 Oracles: focused RED→GREEN on a chained rename (change line 1 of N, assert all N−1 maps), plus
  the slice-1 suites green; `_build.ps1` via cmd_runner. Governing standard: AGENTS.md convention.

## Smoke Tests

- `cmd_runner start --cwd packages/opencode -- bun test <new remap test>` — RED before, GREEN after.
- Slice-1 suites (`edit-overlap-t114`, `edit-exact`, `edit-description-contract`, `edit`) — green.
- `pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root — green.

## Risks

- Map size on huge files — bound it exactly like the report budget; a cut names the `read` offset.
- Two writers: map is computed from the same resolved spans, never re-derived from prose.

## Out of scope

Slice-1 behaviour (shipped), `bin/`, kernel. Do not start before the slice-1 binary is promoted.
