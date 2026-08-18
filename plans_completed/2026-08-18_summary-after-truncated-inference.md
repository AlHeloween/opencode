# Plan: Summary After Truncated Inference — Diagnostic Investigation

**Goal:** Identify which mechanism causes the "thinking... [truncated mid-sentence] → immediate summary" pattern reported by the user.

**Created:** 2026-08-18T01:06:55Z  
**Status:** FIX_APPLIED — runLoop continues after sidecar capture

---

## Prior Art

- `packages/opencode/src/session/compaction.ts` — `isAssistantTurnComplete()`, `injectSummaryRequest()`, `captureSidecar()`
- `packages/opencode/src/session/prompt.ts` — `runLoop`, `maybeCompactCadence`, summary attempt handling
- `packages/opencode/src/session/constitution.ts` — `setSummaryMode()`, `isSummaryMode()`
- `docs/compaction.md` — Layer-1 / Layer-2 compaction design

---

## Hypotheses

### H1: Sidecar capture after `finish_reason="length"` with closed reasoning stream

**Mechanism:**
- Provider returns `finish: "length"` (or `"content_filter"`)
- Reasoning stream is fully closed (`time.end` set on all reasoning parts)
- `isAssistantTurnComplete()` returns `true` because it only checks reasoning closure, not text completeness
- `captureSidecar()` proceeds → sidecar summary captured → TUI shows summary panel

**Expected log markers:**
- `"finish":"length"` or `"finish":"content_filter"` in assistant message
- `"sidecar"` or `"captureSidecar"` in logs
- `"captured"` or `"skip: assistant turn not complete"` (if reasoning NOT closed → would skip)

**Confirmation criteria:**
- Assistant message with `finish: "length"` exists
- `isAssistantTurnComplete` would return `true` for that message (reasoning parts have `time.end`)
- Sidecar capture log entry follows within ~1s

**Refutation criteria:**
- No `finish: "length"` messages in the relevant timeframe
- OR reasoning parts lack `time.end` (turn not complete → sidecar skips)

---

### H2: In-loop summary inject (pending summary request from previous turn)

**Mechanism:**
- Previous turn injected a summary request (`injectSummaryRequest`)
- Synthetic user message with `<!-- summary-range from_id="..." to_id="..." -->` exists
- Next runLoop iteration detects `hasPendingSummaryRequest(msgs) = true`
- `summaryAttempt = true` → model responds to summary request instead of continuing work
- User sees: truncated work turn → summary turn

**Expected log markers:**
- `"injected summary request"` in logs (from `injectSummaryRequest`)
- `"summaryAttempt":true` in runLoop logs
- `"summary-range"` text in message parts
- `hasPendingSummaryRequest` returning true

**Confirmation criteria:**
- Log entry `"injected summary request"` exists before the truncated turn
- Synthetic user message with `<!-- summary-range` present in DB
- `summaryAttempt: true` in the turn that shows summary

**Refutation criteria:**
- No `"injected summary request"` log entries
- No synthetic summary-range messages in the session

---

### H3: Legacy summary path (`assistant.summary = true`)

**Mechanism:**
- Assistant message created with `info.summary = true` flag
- Turn completes (`isAssistantTurnComplete` returns true)
- runLoop hits the legacy summary terminal check and breaks immediately

**Expected log markers:**
- `"legacy layer1 summary is terminal"` in logs
- Assistant message with `info.summary: true` in DB

**Confirmation criteria:**
- Log entry `"legacy layer1 summary is terminal"` exists
- Corresponding assistant message has `summary: true`

**Refutation criteria:**
- No `"legacy layer1 summary is terminal"` log entries

---

### H4: Layer-2 compaction triggered by context pressure

**Mechanism:**
- `maybeCompactCadence()` fires due to visible context approaching model usable limit
- `compact()` folds messages → message* created
- TUI shows compaction result (may appear as "summary")

**Expected log markers:**
- `"layer2.cadence.compact"` in logs
- `"compaction skipped"` or `"folded"` entries
- `openSidecars >= 2` (gate for Layer-2 compact)

**Confirmation criteria:**
- `"layer2.cadence.compact"` log entry at the time of the issue
- `openSidecars >= 2` at that moment

**Refutation criteria:**
- No Layer-2 compact log entries
- `openSidecars < 2` (compact would be skipped)

---

## Investigation Steps

### Step 1: Collect recent logs

**Command:**
```powershell
Get-ChildItem .opencode\data\log\*.jsonl | Sort LastWriteTime -Descending | Select -First 3 | ForEach-Object { Write-Host "=== $($_.Name) ===" ; Get-Content $_ -Tail 500 }
```

**What to look for:**
- Any `"finish":"length"` or `"finish":"content_filter"` entries
- Any `"injected summary request"` entries
- Any `"legacy layer1 summary is terminal"` entries
- Any `"layer2.cadence.compact"` entries
- Any `"sidecar"` entries

### Step 2: Inspect session messages (if accessible)

Check if synthetic summary-range messages exist in the current session.

### Step 3: Cross-reference timestamps

Match log entries with the user-reported issue time (~2026-08-17T17:27:28Z or nearby).

---

## Smoke Tests

**Baseline (before any code change):**
- Document which hypothesis is confirmed by log evidence

**Post-fix verification (if H1 confirmed):**
- After adding `finish === "length"` check to `isAssistantTurnComplete`:
  - Reproduce: trigger a length-limited response
  - Verify: sidecar capture is skipped (`"sidecar skip: assistant turn not complete"`)
  - Verify: no summary panel appears after truncated turn

---

## Blast Radius

- `packages/opencode/src/session/compaction.ts` — `isAssistantTurnComplete()` function only
- No schema changes, no migration needed
- Backward compatible: only adds a guard, doesn't change existing behavior for normal completions

---

## Results: All Hypotheses Refuted by Log Evidence

**Session analyzed:** `ses_fef3c6939ffed3GA3QtPgprlyo` (2026-08-17T17:27:29Z)

### H1: Sidecar capture after `finish_reason="length"` — ❌ REFUTED

**Evidence:** All `finish-step` log entries show `finishReason: "tool-calls"` or `"stop"`. Zero `"length"` or `"content_filter"` entries found in any session log.

```
Line 9: finishReason":"tool-calls"
Line 18: finishReason":"tool-calls"
...
Line 97: finishReason":"stop" (17:30:51)
```

**Conclusion:** The truncation is NOT caused by `finish_reason="length"`.

---

### H2: In-loop summary inject — ❌ REFUTED

**Evidence:** No `"injected summary request"` log entries. No `"summaryAttempt":true` in runLoop. No `"summary-range"` synthetic messages detected.

**Conclusion:** No pending summary request was active during the incident.

---

### H3: Legacy summary path — ❌ REFUTED

**Evidence:** No `"legacy layer1 summary is terminal"` log entries found.

**Conclusion:** Legacy summary terminal path was not triggered.

---

### H4: Layer-2 compaction — ❌ REFUTED

**Evidence:** Only `"layer2.cadence.skip_single_sidecar"` entries with `openSidecars: 0`. No `"layer2.cadence.compact"` entries.

**Conclusion:** Layer-2 compaction was skipped (requires ≥2 open sidecars).

---

## Root Cause Identified: runLoop Breaks After Sidecar Capture

**User clarification:** "после summary он не продолжается... надо просто продолжить до завершения"

**Problem:** After sidecar summary capture, runLoop exits (`break`) instead of continuing work.

### Code Analysis

**`packages/opencode/src/session/prompt.ts:2440`:**
```typescript
if (result === "stop") return "break" as const
```

After sidecar capture with `result === "stop"`, runLoop **break**. But user expects runLoop to **continue** until work is complete.

### Sidecar Capture Flow

1. Turn completes (`result === "stop"` or `completedCleanly`)
2. `captureDue` computed (open window >= 64K threshold)
3. Checkpoint published
4. Sidecar captured (summary created with full session context)
5. **runLoop breaks** ← PROBLEM

### Expected Behavior

After sidecar capture, runLoop should **continue** if work is incomplete. The summary is a checkpoint/memory mechanism, not a termination signal.

### Fix Direction

Change line 2440 from:
```typescript
if (result === "stop") return "break" as const
```
To:
```typescript
// After sidecar capture, continue if work is incomplete
if (result === "stop" && !sidecarWasCaptured) return "break" as const
```

Or: after sidecar capture, always `continue` instead of `break`.

---

## Fix Applied: runLoop Continues After Sidecar Capture

**Change in `packages/opencode/src/session/prompt.ts:2440`:**

Before:
```typescript
if (result === "stop") return "break" as const
```

After:
```typescript
if (result === "stop" && !sidecarCaptured) return "break" as const
// After sidecar capture: continue loop so work can finish naturally.
// Sidecar is a checkpoint mechanism, not a termination signal.
```

**Behavior:**
- Sidecar capture → runLoop **continues** → work completes naturally → then exits
- No sidecar capture + result="stop" → runLoop **breaks** (legacy behavior preserved)
- Legacy in-loop summary → runLoop **breaks** (separate path, unchanged)

---

## Verification

1. **Smoke test:** Trigger sidecar capture, verify runLoop continues
2. **Regression test:** Verify normal "stop" still breaks correctly
3. **Legacy test:** Verify in-loop summary still breaks correctly

---

## Open Questions (Updated)

1. **Which provider/model was used?** Logs show `pasha-coder` / `ep-kneqk9-1786632248553436783` — need to confirm if this is a reasoning model (DeepSeek/Qwen).
2. **What exactly does "summary" mean?** Is it the Layer-1 summary panel, or just the next assistant turn / tool result?
3. **Reproducibility:** Does this happen consistently with this model, or intermittently?
4. **Reasoning stream behavior:** Does the reasoning stream actually get truncated mid-sentence, or does it complete normally and the user perceives the transition as abrupt?

---

## Next Steps

1. **User clarification:** Ask user to describe exactly what they see — is it a summary panel with `=== LAYER-1 SUMMARY ===` header, or just the next turn starting?
2. **Model identification:** Check `src/provider/models/*.json` or provider config to identify the exact model behind `ep-kneqk9-...`
3. **Reasoning stream analysis:** If this is a reasoning model, investigate how the provider streams reasoning vs text tokens and whether TUI handles the transition correctly.
