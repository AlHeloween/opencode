# Request-diff: whole-sequence divergence localization

Created: 2026-08-28T05:35Z
Status: COMPLETED 2026-08-28T05:50Z — oracles: request-diff 34/34 PASS (`20260828T054634Z_323e57ed`),
typecheck PASS (`20260828T054707Z_a9981d68`); baseline 25/25 (`20260828T053543Z_668423ac`).
(was ACTIVE — user ordered + designed: walk from position 0 to the first divergence,
show exact positions, then the tail)

## Goal

Make the request diff a REAL instrument. Today it diffs two budget-truncated TEXT views and
cuts the prefix at the checkpoint `fromIndex` — proven blind: cache losses correlate with
diff churn at r=-0.013; mutations live in the unformatted prefix zone; viewport shifts
(`omitted: 4 → 5`) fake "removed" entries (user catch, diff 1787894290213).

New contract: walk from position 0 of the previous request to the FIRST DIVERGENCE
(key + per-message hash), localize the problem start with exact positions, then append the
tail. No divergence → append-only verdict. Divergence → DIVERGENCE section with position,
old vs new blocks.

## Tasks

### T1 — request-diff.ts: block map + positional diff

- `MessageBlock { key, hash, text }` — key = model-indexed messageID (or `#i` fallback),
  hash = hex Bun.hash of rendered block text
- `formatRequestDetailed(system, modelMsgs, meta, messageIDs?, opts?) => { text, blocks }`
  — blocks for the FULL sequence (no fromIndex cut); text keeps current budget rendering
- `rememberBlocks` / `getPreviousBlocks` (per prevKey); `clearPreviousFormatted` +
  `deleteBaselines` clear both; `formatRequest` delegates to detailed (compat)
- `diffBlocks(prev, curr, currMeta): string`:
  - walk i=0.. while key+hash match → `D` = first divergence
  - META: `prev_messages`, `curr_messages`, `common_prefix`, `first_divergence`,
    `verdict: append-only | divergence@D | identical`
  - append-only (D=prevLen ≤ currLen): counts line `N added, 0 removed, 0 changed`,
    tail from prevLen, NO divergence section
  - divergence: `@@ DIVERGENCE @ position D @@` + full old vs new block at D (the problem
    start) + one-line summaries for further changed positions (cap 8) + vanished count
  - counts line compat for analyzers: added/removed/changed accounting on key matches
- oracle: new unit tests

### T2 — prompt.ts call site

- use `formatRequestDetailed` + `diffBlocks` + `rememberBlocks`; drop `dbPrefix`/`modelFrom`
  (fromIndex no longer shapes the diff); keep `rememberFormatted` text snapshot (harmless)
- oracle: typecheck

### T3 — tests (test/session/request-diff.test.ts)

New `describe("diffBlocks")`:
1. append-only → no DIVERGENCE section, `2 added, 0 removed, 0 changed`
2. mutation at position K → `divergence@K`, old/new text, position printed
3. vanish (curr shorter, prefix matches) → vanished at position currLen, removed=N
4. restructure at 0 (ids differ) → `divergence@0`
5. mid-turn tool-loop growth (old false-removed scenario) → append-only
6. remember/get/clear roundtrip
All existing tests keep passing (formatRequest/diffRequest untouched).

## Smoke Tests

smoke_na: false
baseline:
- label: request-diff unit tests (pre-edit)
  cmd: bun test test/session/request-diff.test.ts
  workdir: packages/opencode
  expected_exit: 0
post_checks:
- label: request-diff unit tests (post-edit)
  cmd: bun test test/session/request-diff.test.ts
  workdir: packages/opencode
  expected_exit: 0
- label: typecheck
  cmd: bun run typecheck
  workdir: packages/opencode
  expected_exit: 0
blast_radius: src/session/request-diff.ts, src/session/prompt.ts (diff call site only),
  test/session/request-diff.test.ts. New .diff file format from next request; count line
  kept for experiments/kv-cache-parity analyzers (messages_from_index line disappears —
  correlate script tolerates missing value).

## Prior art

reuse: N/A — in-repo redesign of our own module; positional block compare reuses the
guard's per-position hashing idea (llm.ts messagesStabilityVerdict) at diff granularity.
