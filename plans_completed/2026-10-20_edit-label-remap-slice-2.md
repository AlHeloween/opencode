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
  (or worse, lands near). After the slice-1 binary is promoted, return an old→new map for every changed
  label still in the active window (owner 2026-10-21: the model reasons in labels; addendum 2 withdraws
  addendum 1's «every label seen»), so no later edit uses a stale hash.

## Tasks

- [x] R1 Old→new map: for the file just edited, map every CHANGED original label (from the first text
  difference down) to its post-edit label (`N  old -> N new`) or `deleted`, reusing the same
  `chainHash`/`hashLabel` the report prints; with `windowLabels` only labels still in the active window
  are listed (interim: without the set, all changed lines — bounded, cut names the range + read offset).
  Reason (owner, 2026-10-21): «модель в последствии начинает оперировать этими хешами для экономии
  размышлений...» — a stale label is a wrong fact in the working picture, not just a failed edit.
  The in-window set is read from the runtime's own replay/selection, never guessed; if the edit tool
  cannot reach it, that gap is named, not substituted (missing piece: a caller-owned window-label set;
  owner: the session/message-v2 replay selection). Measured: whole-file map fits the live 249-line case
  (echo 336 B + map 5342 B < 8 KB budget); the map replaces the moved-label list it strictly dominates
  (together 8.6 KB > budget — the exact live failure).
- [x] R2 Wire the map into the `edit` result REPLACING the moved-label list (see R1 measurement); contract test
  updated in the same change (3×3 docs aspect). Governing standard: t93 description-contract.
- [x] R3 Oracles: focused RED→GREEN on a chained rename (change line 1 of N: all moved labels map,
  replaced line maps to `deleted`; window subset listed / rest omitted; report purity), plus
  the slice-1 suites green; `_build.ps1` via cmd_runner. Governing standard: AGENTS.md convention.

## Smoke Tests

- `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-label-remap-t123.test.ts` — RED before (map.size 0), GREEN after (replace/insert/delete, window subset, purity guard).
- Slice-1 suites (`edit-overlap-t114`, `edit-exact`, `edit-description-contract`, `edit`) — green.
- `pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root — green.

## Risks

- Map size on huge files — bound it like the report budget; a cut names the unmapped old-label range and
  the `read` offset that recovers them, and a bound that drops anything without an address is refused (no silent
  cut). The map is appended in the edit result only; earlier read/edit outputs are never rewritten, stored nor
  wire (KV-cache byte-stability, tail inviolate) — the window is read-only input to the filter.
- Two writers: map is computed from the same resolved spans, never re-derived from prose.

## Out of scope

Slice-1 behaviour (shipped), `bin/`, kernel. Do not start before the slice-1 binary is promoted.
