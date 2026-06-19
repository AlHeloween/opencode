# Research Plan: Remaining Reasonix Advantages — Implementation Deep-Dive

**Created**: 2026-06-18
**Purpose**: Validate whether Reasonix's 3 remaining advantages (background jobs, tool preview, multi-tier compaction) are genuinely superior to our implementations, and estimate adoption effort.

---

## Research Area 1: Background Job Manager

**Reasonix claim**: Cross-turn background task tracking with persistence. Jobs survive across turns, report completion in subsequent turns, have status tracking (Running/Done/Failed/Killed).

**Research questions**:
- How is job state persisted? (file, database, in-memory?)
- How does job output streaming work? (polling, events, callback?)
- How are completion results delivered to the next turn? (injected into prompt, event, tool result?)
- What's the concurrency model? (goroutines, process pool, queue?)
- How are timeouts and cancellations handled?
- What types of jobs exist? (bash, task subagent, anything else?)

**Our current state**: `Effect.forkIn(scope)` / `Effect.forkScoped` — in-memory fibers, lost on disconnect.

**Files to explore**: `internal/jobs/`, `internal/agent/session.go` (job tracking), `internal/control/` (job lifecycle)

---

## Research Area 2: Tool Preview Interface

**Reasonix claim**: `Previewer` interface lets tools show what they'll do before executing. Myers' diff produces intuitive hunks for approval cards.

**Research questions**:
- What does the `Previewer` interface look like exactly? (method signature, return type)
- Which tools implement it? (write_file, edit_file, multi_edit, apply_patch?)
- How is the preview rendered? (TUI, HTTP/SSE, what format?)
- Is preview mandatory or optional? (always preview, configurable, per-permission?)
- How does the approval flow work? (preview → user approves → execute, or preview-only?)
- What's the diff format? (unified diff with context, colored, line numbers?)

**Our current state**: 9-strategy replacer cascade finds matches, but execute happens immediately (modulo permission ask). No pre-execution preview step.

**Files to explore**: `internal/tool/tool.go` (Previewer interface), `internal/diff/` (Myers' algorithm), `internal/control/` (approval flow)

---

## Research Area 3: Multi-Tier Compaction Thresholds

**Reasonix claim**: Three threshold tiers: soft (0.5 = warn), trigger (0.8 = compact), force (0.9 = compact aggressively). Fixed tail budget of 16384 tokens, not a fraction.

**Research questions**:
- How are thresholds calculated? (percentage of what? context window? model limit?)
- What happens at each tier exactly? (soft = notice event, trigger = compact normally, force = compact aggressively)
- What's the difference between "compact" and "compact aggressively"?
- How does the tail budget work? (what's kept verbatim vs summarized?)
- What's the compaction prompt/format? (same as ours or different?)
- How does the summary structure work? (sections, validation, token budget?)

**Our current state**: Binary overflow detection in `overflow.ts`. Single trigger when tokens exceed usable limit. Structured markdown template for summaries. Head/tail split with configurable preserve budget. Token-based pruning.

**Files to explore**: `internal/agent/compact.go`, `internal/agent/overflow.go`, `internal/agent/session.go` (token counting)

---

## Deliverable

For each area:
1. Exact implementation details from Reasonix code
2. Side-by-side comparison with our implementation
3. Adoptability assessment: worth it? effort estimate? risk?
4. Recommendation: adopt, adapt, or skip
