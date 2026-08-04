# Epistemic Guardrails — Closing the Inferred/Exact Gap

**Date**: 2026-07-22
**Status**: Plan
**Source**: Model feedback on memory architecture (session 2026-07-22T03:57:45)
**Predecessor**: Compaction + messagesearch + epistemic rank system (already implemented)

## Context

The model reviewed the memory architecture (iterative summaries + recent messages + DB retrieval) and validated the design as sound. The epistemic rank system (Exact > Inferred > Hypothetical > Guess > Unknown) is well-defined and surfaced everywhere:

- `messagesearch` output: `info_mark: Inferred — use session-read for Exact`
- `session-read` output: `info_mark: Exact — ground-truth archive`
- Compaction reminder: "Never treat summary text as Exact ground truth without session-read"
- Kernel: `MEMORY.RANK: session-read Exact > summary Inferred > unaided Guess`

**The gap**: All guardrails are advisory (prompt-based). The model *can* ignore them. There's no programmatic enforcement. A model acting on Inferred data without verification can make wrong decisions — and the system won't stop it.

## What's Already Implemented

| Component | Status |
|-----------|--------|
| `InfoMark` type (5-level hierarchy) | ✅ `constitution.ts` |
| Epistemic coefficients in memory DB | ✅ `memory.ts` part_index |
| Hybrid BM25 + epistemic search ranking | ✅ `memory.ts` search query |
| Compaction reminder (verify Inferred) | ✅ `prompt.ts` |
| Kernel MEMORY.RANK / EVIDENCE.ORDER rules | ✅ `opencode_prompts_kernel.txt` |
| Summary request with Inferred label | ✅ `compaction.ts` |
| `drainCompletedNote` job surfacing | ✅ `jobs/index.ts` |

## What's Missing (3 actionable items)

### A. Job output epistemic marking

**Problem**: `drainCompletedNote` returns plain text like `"bash-1 (build) → done: success"`. The model doesn't know whether this is Exact evidence (tool completed, output verified) or Inferred (summary of a summary).

**Fix**: Add `infoMark` to completion notes. Tool output is Exact by default; summary-of-summary is Inferred.

```
Background jobs since your last turn:
  bash-1 (build) → done [Exact]: Build completed successfully.
  task-2 (research) → done [Inferred]: Sub-agent concluded X.
```

### B. Verification nudge on Inferred-based tool calls

**Problem**: The model can call `edit` or `bash rm` based on Inferred data from `messagesearch` without verification. The kernel says "verify first" but there's no programmatic nudge.

**Fix**: When the model's tool call is preceded by messagesearch results (Inferred data) without an intervening session-read (Exact verification), inject a lightweight reminder in the tool's execution context. Not a block — a nudge. The model can override.

This is a **constitutional soft gate**, not a hard permission. Pattern: "You're about to edit based on Inferred data. Consider verifying with session-read first."

Implementation approach:
- Track the epistemic "floor" of the current turn's evidence chain
- If the tool about to be called is write/destructive AND evidence floor ≤ Inferred AND no session-read was called this turn → inject nudge

### C. Compaction preserves "critical decision points"

**Problem**: Summaries may omit decisions that later prove important. The agent then acts on incomplete context.

**Fix**: The summary request prompt already asks for structured output. Add a `## Decisions` section requirement — the model must list explicit decisions made during the summarized window (file created, approach chosen, design tradeoff accepted). Future compaction cycles preserve the `## Decisions` block verbatim (not re-summarized).

## Implementation Plan

### Step 1: Job output epistemic marking (`jobs/index.ts`, `drainCompletedNote`)

- Add `infoMark: InfoMark` to the `Completion` interface
- `startEffect` sets `infoMark: "Exact"` for bash/cmd/run (tool output is ground truth)
- `startEffect` sets `infoMark: "Inferred"` for task (sub-agent conclusion, not verified)
- `drainCompletedNote` formats output with `[Exact]` / `[Inferred]` labels
- Update `<background-jobs>` injection in `prompt.ts` to preserve labels

Files: `jobs/index.ts` (~15 lines), `prompt.ts` (~5 lines)

### Step 2: Verification nudge (`constitution.ts` + `prompt.ts`)

- Add `evidenceFloor` tracking to the prompt loop context
- On messagesearch result: set `evidenceFloor = "Inferred"`
- On session-read result: set `evidenceFloor = "Exact"`
- Before destructive tool execution: if `evidenceFloor ≤ "Inferred"` → inject nudge text into tool metadata
- Nudge format: `[epistemic nudge: decision based on Inferred data. session-read recommended for Exact verification.]`

Files: `constitution.ts` (~20 lines), `prompt.ts` (~15 lines), tool execute wrapper (~10 lines)

### Step 3: Compaction Decisions section (`compaction.ts`)

- Update `injectSummaryRequest` prompt to require `## Decisions` section
- In `buildMessageStar`, extract `## Decisions` blocks from summaries
- Preserve decisions blocks verbatim across compaction cycles (mark as `info_mark: Inferred` but with "preserved from prior cycle" annotation)

Files: `compaction.ts` (~30 lines)

## Acceptance Criteria

- [x] Job completion notes carry `[Exact]` or `[Inferred]` labels — `690d6c78cf`; tests in `test/jobs/jobs.test.ts`
- [x] Destructive tool calls after Inferred evidence trigger a nudge (not a block) — `8cd4c818d7`; unit tests in `test/session/constitution.test.ts` (`epistemicNudge`)
- [x] Summary requests require `## Key decisions` section — `c9cb41e06d`; covered by `injectSummaryRequest` test
- [x] `## Key decisions` blocks preserved across compaction cycles — `c9cb41e06d`; tests in `session.compaction.key-decisions`
- [x] Typecheck passes — `bun typecheck` exit 0 (2026-07-24)
- [x] Existing tests pass (no behavior change for current flows) — 78 pass across jobs/constitution/compaction

**Also covered (related Layer-1 fix):** `be7c71c96c` seed counter — unit tests `session.compaction.computeOutputSinceLastSummary`.

**Known residual gaps (see Insights):**
- `evidenceFloor` upgrades to Exact only on `session-read` **within the same processor stream**; outer `runLoop` variable is never written back, so a later loop step after session-read may still start as Inferred.
- Plan mentioned tracking messagesearch → Inferred; code defaults to Inferred without explicit messagesearch hook.
- `extractDecisions` only matches `## Key decisions` (not the `--- Decisions` block alone); multi-cycle survival primarily relies on re-reading soft-hidden summary assistants from DB.

## Design Decisions

1. **Nudge, not gate**: The verification nudge is advisory — the model can proceed without session-read. Hard gates would break legitimate workflows (e.g., "I just saw this in messagesearch, it's clearly the right file, let me edit it"). The nudge raises awareness without blocking.

2. **Exact for tools, Inferred for sub-agents**: bash/cmd/run produce verifiable output → Exact. task (sub-agent) produces conclusions → Inferred. This aligns with the epistemic hierarchy: tool output is ground truth; sub-agent output is a summary of its own investigation.

3. **Decisions preserved verbatim**: Re-summarizing decisions across compaction cycles amplifies distortion. Preserving the original `## Decisions` block prevents epistemic decay — even though the block is Inferred, it's "Inferred once, not re-Inferred."
