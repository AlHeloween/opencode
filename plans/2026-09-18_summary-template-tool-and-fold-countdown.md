<!-- intention: the fold arrives carrying an unfilled summary template and no warning -> the template is filled before the boundary, with gaps surfaced while the summary is still open -->
# Layer-1 summary: shared template, gap nag, and a fold countdown

```yaml
status: IN PROGRESS (2026-09-18) — T1 and T2 LANDED (oracles green); T3/T4/T5 open
raised: 2026-09-18, from the ClientSoft incident (worker died mid-compaction) and the owner's design call
scope: packages/opencode/src/session/compaction.ts, packages/opencode/src/session/prompt.ts, packages/opencode/src/tool/summaryedit.ts
owner_ruling:
  - forced gap-fill iterations are NOT wanted; nag instead of enforce
  - diffs must not be traded away — "без них заблудимся"
  - the countdown must be pushed after every user message, not pulled
```

## Context — measured, not assumed

| # | Fact (Exact, file:line) | Consequence |
|---|---|---|
| 1 | `skill/compaction/SKILL.md` is compiled in and is the ONLY skill whose full content is inlined into the system prompt (`skill/index.ts:339`) | the 8-section anchored template already exists, and only the model-authored path uses it |
| 2 | the server-side sidecar requires **four** headings of its own: `Semantic Vector`, `Goal`, `Key decisions`, `Current state` (`compaction.ts:548-569`) | two different summary shapes in one system |
| 3 | `diagnoseSummaryGaps` (`compaction.ts:439`) enforces ≥200 chars, per-section minima, ≥1 decision bullet; `gapFillRequest` (`:457`) asks for a targeted repair; `SIDECAR_MAX_ATTEMPTS = 2` (`sidecar-policy.ts:38`) | the repair machinery exists — the owner wants its FORCED iteration removed |
| 4 | the skill's update protocol — keep still-true facts at the same position and wording, append new/changed at the end of their section | this is what makes a CHAIN of folds incremental and diffable; the sidecar has no such rule |
| 5 | `renderSummaryBlock` / `buildMessageStar` (`compaction.ts:600`, `:747`) attach `diffs` and `impact` from the checkpoint row; the prose prompt FORBIDS the model to write IDs/diffs/hashes | diffs are preserved by construction — the owner's constraint is already satisfied, and must stay that way |
| 6 | the `m*` cap is AGGREGATE: `MAX_SUMMARY_BODY_TOKENS(16_384) × CHARS_PER_TOKEN(4) = 65 536` chars of FULL RENDERED block, oldest dropped first (`compaction.ts:1063-1077`) | one ClientSoft checkpoint already renders ≥100 KB (6 024 body + 96 797 diffs) — a 30 KB body target must not be set before this is measured |
| 7 | `summaryedit` writes the checkpoint `body` (`tool/summaryedit.ts:108`) and already distinguishes `ALREADY FOLDED … contradicts m*` from `status: open — folds into the next m*` (`:83-85`) | **the nag has a hard deadline**: it is only actionable before the boundary |
| 8 | `checkstate` already computes `limit`, `foldAt`, `open`, `sinceSummary`, `perTurn`, `armed`, `auto` (`tool/checkstate.ts:164-189`) | the countdown needs no new arithmetic — only PUSH instead of PULL |
| 9 | Layer-1 cadence is `SUMMARY_INTERVAL_TOKENS = 65_536` measured from the newest sidecar boundary; `foldAt` is the Layer-2 fold and is compared to `open` (`compaction.ts:305`, `overflow.ts:191-202`) | one number here is a wrong number: both must be reported, labelled |
| 10 | baseline oracle before any edit: `bun test test/session/compaction.test.ts` → **76 pass / 0 fail**, `exit_code=0` (run `20260918T161524Z_ddca40f8`) | first-use token delivered; this is the regression anchor |

## Tasks

- [x] **T1 — one template, union not replacement.** LANDED: `summaryRequestProse` asks for `Semantic Vector` plus the skill's sections, `Current state` carries `### Done / ### In Progress / ### Blocked`, and the positional update protocol is in the prompt as the continuity rule.
      Oracle: new `test/session/summary-template.test.ts` 5/5 (a missing added heading is named; the additions clear at 24 chars; the core four did NOT drop to 24), `compaction.test.ts` 76/0, `bun typecheck` exit 0.
- [x] **T2 — gaps are reported, not iterated.** LANDED: the required-heading list covers all eight, the four additions carry a 24-char floor, `SIDECAR_MAX_ATTEMPTS = 1` retires the forced repair, and the hard reject is replaced by a stored body plus a named-gap warn (`summary_gaps` computed on read, so filling a section retires its own nag).
      Oracle: attribution table below; and the loop's removal is proven by the edited `prompt.test.ts:884` case (2 requests, body stored with both named gaps).
- [ ] **T3 — the nag, deadline-aware.** After each user message, in the MUTABLE TAIL, one line per OPEN summary (`IncrementalCheckpoint.listOpen`, i.e. `materializedMessageID` is null): `summary <id> open · gaps: Next Steps (0/24), Relevant Files (0/24) · fill with summaryedit before the fold`. A folded summary produces NO line — the tool itself says correcting it contradicts `m*`.
      Oracle: a rendering test for the tail line; a negative control that a folded summary yields no nag.
- [ ] **T4 — the countdown, pushed.** After each user message, in the MUTABLE TAIL: `ctx open/foldAt (headroom) · layer-1 sinceSummary/65 536 · ~N turns at recent rate`, reusing `computeOpenWindowTokens` and `burnRate`. The estimate is labelled an estimate; the token numbers are Exact.
      Oracle: reuse the existing `checkstate` numbers, so a test can assert the tail line equals them for the same session state.
- [ ] **T5 (deferred, measurement first).** Decide the body target (30 KB) only after measuring rendered-block sizes per checkpoint against the 65 536 aggregate. Raising it without that measurement trades thin prose for evicted history — the failure the owner is trying to prevent.

## Smoke Tests

- Baseline (recorded before any edit): `cd packages/opencode && bun test test/session/compaction.test.ts` → 76 pass / 0 fail, exit 0.
- After T1+T2: the same suite; expected movement is ONLY in the validator cases, each change deliberate and named in the commit.
- After T3+T4: the tail-rendering test, plus the negative control (no nag for a folded summary) and the cross-check against `checkstate`'s numbers.
- Gate on every step: `bun typecheck` in `packages/opencode`, exit code read from the run's `state.json` — never inferred from silence.
- Containment regression (separate, already landed `96a6507`): `test/snapshot` + `test/codegraph` stay green.

## Risks

- **KV cache.** Both tail lines are mutable counters: they MUST go in the mutable tail, never the system prefix (`@KV_CACHE_STABILITY`). A counter in the prefix is a cache miss every turn.
- **A nag outliving its deadline.** If the line survives the fold it instructs an action whose own tool refuses it. The open/folded split is the guard, and it needs its own test.
- **Gap-fill removal has a cost.** Without the forced retry, an unfilled body folds as-is. The nag plus the countdown is the replacement mechanism, and it only pays off if the countdown leads the boundary by more than one turn.
- **`m*` aggregate pressure.** Every extra heading costs tokens on every fold for the rest of the session's life.

## Residual

- The 30 KB body target is unmeasured (T5).
- Nothing here touches `renderSummaryBlock`, `buildMessageStar`, or the diffs attached to a checkpoint.
- The ClientSoft session itself needs no repair for this work: its three checkpoints are materialized and its memory is intact.
