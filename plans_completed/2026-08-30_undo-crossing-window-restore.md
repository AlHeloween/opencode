# Plan: undo-crossing does not restore the context window

plan_id: 2026-08-30-undo-crossing-window-restore
state: COMPLETED
created_by: build_mode
revision: 2

## Goal

Undo that crosses a compaction boundary must resurrect the compacted archive rows
(`compacted=1 → 0`) so the next request restores the pre-undo context window.
Reported: window collapsed 250k → 72.2k after a boundary-crossing undo.

## Root cause (resolved, rev 2)

Two stacked defects in `packages/opencode/src/session/revert.ts`:

1. **Silent window truncation**: the revert walk loaded history without `limit`;
   `Session.messages` defaults to the 500 newest rows. Sessions deeper than 500
   rows lost the undo target / archive from the scan (silent — the truncation
   warn self-suppresses at limit ≥ 500). Fix: `limit: 10_000` (mirror unrevert).
2. **Manifest computed on mutated flags (the context wipe)**: in a multi-undo
   walk (consecutive /undo, no intervening fold) the previous crossing undo
   already inverted flags; the next crossing undo classified rows against those
   mutated flags — resurrected archive rows got marked pristine-visible future
   and the fold deleted/hidden them. Wire evidence from the 2026-08-30 session
   (ses_fba5a941): pre-undo request messages = 1,327,598 chars; first post-undo
   request = **189 chars** (model context wiped, not merely unrestored).
   Fix: compose the crossing manifest with `prior.crossing` — rows covered by
   the prior manifest reuse its PRISTINE classification; only never-inverted
   rows are classified fresh.

## Evidence (Exact unless marked)

- C1 [Exact] 05:37:57Z `layer2.cadence.compact` on ses_fba5a941 (log l-0347).
- C2 [Exact] DB after the walk: 1770 rows / 1740 hidden / 30 visible; zero
  resurrected rows below the tail; m* + post-compact turns deleted.
- C3 [Exact] No "unreverting" in logs ⇒ no redo; hidden state was not legitimate.
- C4 [Exact] z-ai-glm request shapes: pre-undo 1,327,598 chars vs post-undo 189.
- C5 [Exact] revert.ts walked history without limit; default 500 newest rows.
- C6 [Exact] T8 regression test FAILed pre-fix (resurrection lost after two
  consecutive crossing undos), PASSed post-fix (10 expect() calls).

## Smoke tests

smoke_na: false
baseline:
- label: existing crossing suite green pre-change (clean HEAD)
  cmd: bun test test/session/revert-crossing.test.ts --timeout 60000
  expected_exit: 0
  workdir: packages/opencode
post_checks:
- label: full undo oracle — three suites
  cmd: bun test test/session/revert-crossing.test.ts test/session/revert-compact.test.ts test/session/session-undo-fossil.test.ts --timeout 120000
  expected_exit: 0
  workdir: packages/opencode
- label: typecheck
  cmd: bun typecheck
  expected_exit: 0
  workdir: packages/opencode
blast_radius: packages/opencode/src/session/revert.ts (revert walk limit +
  pristine manifest composition), packages/opencode/test/session/revert-crossing.test.ts
  (T7 + T8 regression tests). No schema, no TUI, no prompt-assembly changes.

## Tasks

- id: T1
  sv: [revert, limit, truncation]
  what: revert.ts revert() — `limit: 10_000` full-history walk (mirror unrevert).
  files: [packages/opencode/src/session/revert.ts]
  depends_on_claims: [C5]
  status: "[x]"
- id: T2
  sv: [regression, crossing, pristine]
  what: T7 (>500-row history, walk + fold) and T8 (two consecutive CROSSING
    undos then fold — pristine classification) regression tests; T8 FAILed
    pre-fix as required by @BUG_FIX_CHAIN.
  files: [packages/opencode/test/session/revert-crossing.test.ts]
  depends_on_claims: [C2, C6]
  status: "[x]"
- id: T1b
  sv: [pristine, manifest, composition]
  what: Crossing manifest composes with prior.crossing (pristine classification
    for previously-inverted rows); `prior` read moved above the scan.
  files: [packages/opencode/src/session/revert.ts]
  depends_on_claims: [C4, C6]
  status: "[x]"
- id: T3
  sv: [oracle, suites]
  what: 20 pass / 0 fail across revert-crossing, revert-compact,
    session-undo-fossil; `bun typecheck` exit 0.
  files: []
  depends_on_claims: [T1, T1b, T2]
  status: "[x]"

## Claim ledger

premises_for_plan: [C1, C2, C3, C4, C5]
open_questions: [] (C7 resolved → C6 via T8)
