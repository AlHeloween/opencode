# Overflow last-line — fix the pre-send formula and extend 32k spare

**Created:** 2026-08-18  
**Status:** active  
**Tree:** Local_Development (`10c4ab04f3` already landed)  
**reuse:** Smit `hasSpareOutput` / `maybeCompactCadence` (every generation, not sidecar-only); this-tree `overflow.ts`, `llm.ts` pre-send, `summary-cadence.test.ts`

## Context

Today is **2026-08-18**. Commit `10c4ab04f3` added a pre-send overflow guard in `llm.ts`. That is a real last line before HTTP. Two holes remain, and the 32k reserve still applies only to sidecar S — a work / tool-loop turn can still start against the wall.

Smit already does 32k spare on **every** generation (`hasSpareOutput`). Do not copy Smit prefix / off-M Layer-1. Copy only the spare-gate idea and the pre-send arithmetic.

## What already landed (do not re-do)

| Piece | Where | Status |
|-------|--------|--------|
| Pre-send block vs `usable()` | `packages/opencode/src/session/llm.ts` ~461–485 | `[x]` landed `10c4ab04f3` |
| Duck `{ name: "ContextOverflowError" }` → `fromError` | `message-v2.ts` ~1493–1501 + test | `[x]` |
| 32k sidecar compact-first | `summaryNeedsCompactFirst` + `onHeadroomCompact` | `[x]` |
| Mid-turn `isOverflow` / `usable` | `processor.ts` | `[x]` |
| Provider overflow → compact + `TokenCalibration` | `halt` + `error.ts` | `[x]` |
| Layer-1 cadence 65 536 unclamped | `layer1SummaryThreshold()` | `[x]` KEEP |

`summaryWindowLimit` **intentionally** collapses on small windows (test: ~40k model → ~12.5k). That clamp is for Layer-2 Recent trim only. Layer-1 must never use it. Not a T10-style “restore Smit formula” job here.

## Bug (Exact) — pre-send double-counts 10k

`llm.estimateContentTokens` = `chars/4 + REQUEST_OVERHEAD_TOKENS` (10 000).

`usable()` = `limit − (10 000 + min(output, 32 768))`.

Guard today:

```
(chars/4 + 10_000) >= usable()
chars/4            >= limit − 52_000
```

On a 128k / 32k model the guard fires at **76k** content. Real `usable` is **86k**. Ten thousand of framing are subtracted twice.

On 256k / 32k: fires at 204k vs usable 214k.

## Bug (Exact) — 32k spare is sidecar-only

`summaryNeedsCompactFirst` runs only inside `captureSidecar`. Work turns and tool-loop steps have no `hasSpareOutput` equivalent. Compact is free; a 32k completion against the wall is not.

Smit gate (do not take their off-M S path):

```
hasSpareOutput(used) = (observed ?? input ?? context) - used >= min(output, 32768)
```

`used` after a live turn = billed `input + cache.read`. After a fold = `content/4 + 10k`.

## TAKE

- [ ] **Fix pre-send arithmetic.** Compare **content `chars/4` without a second +10k** to `usable()`. Keep the HTTP block; change only the inequality. Recompute every request (already true in `llm.estimateContentTokens`).
- [ ] **Throw a real `ContextOverflowError`**, not `{ name, data }`. Keep the duck `fromError` arm as a fallback until no caller throws the object.
- [ ] **32k spare on every generation** (work, tool-loop, S): before `llm.stream` in `runLoop`, if leftover < `outputReserve` → `maybeCompactCadence({ force: true })` then `continue`. Reuse `summaryNeedsCompactFirst` / a shared `hasSpareOutput` that reads `TokenCalibration.getObservedLimit ?? input ?? context` (same limit as `usable()`).
- [ ] Tests in `test/session/summary-cadence.test.ts` (+ pre-send case):
  - guard does **not** fire at `usable − 10k`
  - guard **does** fire when `chars/4 >= usable()`
  - spare-gate uses `observedLimit` when set
  - existing sidecar headroom tests stay green
- [ ] After: from `packages/opencode`, `bun test ./test/session/summary-cadence.test.ts ./test/session/message-v2.test.ts`. Do not reshape tools JSON or system slots.

## REJECT

- Smit off-M Layer-1 / `maybeInjectLayer1` / no-`:sidecar` cache key.
- Dropping the pre-send guard entirely.
- Changing Layer-1 threshold to `summaryWindowLimit` (that clamp is Layer-2 Recent only).
- Always-32768 when `model.limit.output` is 8k — keep `min(output, 32768)` if a shared reserve helper is added.

## Smoke Tests

cwd: `packages/opencode`

### Baseline (recorded 2026-08-18, before this plan's code edits)

| # | Command | Expected now | Actual [Exact] |
|---|---------|--------------|----------------|
| 1 | `bun test ./test/session/summary-cadence.test.ts ./test/session/message-v2.test.ts` | pass | **51 pass, 0 fail**, 72 expect, 6.04s |
| 2 | `llm.ts` pre-send compares `contentTokens >= usableLimit` | true (double-counts 10k) | Exact: `llm.ts` ~467 `contentTokens >= usableLimit`; `estimateContentTokens` returns `chars/4 + 10_000` |
| 3 | `hasSpareOutput` symbol | absent | Exact: no `hasSpareOutput` in this tree; only `summaryNeedsCompactFirst` |

### Post-implementation oracles

| # | Command | Pass |
|---|---------|------|
| 1 | same bun test pair | still green + new cases: no fire at `usable − 10k`; fire at `chars/4 >= usable()` |
| 2 | pre-send uses `chars/4` (or estimate minus the 10k already inside it) vs `usable()` | no double 10k |
| 3 | `runLoop` compact-first when leftover < output reserve, not only in `captureSidecar` | work turn does not `stream()` against the wall |
| 4 | thrown value is `ContextOverflowError` instance | `isInstance` true without the duck arm |

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]
