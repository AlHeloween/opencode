# plan-reminder-anthropic.txt Cleanup + Agent Prompt Audit

**Created:** 2026-06-26
**Status:** Active
**Parent:** `plans/emergency/20260626_prompt_package_audit_master.md`

```yaml
master_plan_description: "Replace plan-reminder-anthropic.txt 5-phase workflow with gate references. Align general.txt with reasoning gates. Audit coder/explore/researcher for orphaned instructions."

SV for goal 1: Fix plan-reminder-anthropic.txt
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%
  SV for task 1.1: Strip 5-phase workflow, replace with gate references
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%
  SV for task 1.2: Align plans conventions with reasoning.txt Gate 9
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%
  SV for task 1.3: Verify no remaining contradictions after edit
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%

SV for goal 2: Fix general.txt — align with reasoning gates
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%
  SV for task 2.1: Replace generic workflow with gate references
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%
  SV for task 2.2: Remove /help and /feedback lines (not sub-agent role)
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%

SV for goal 3: Audit coder/explore/researcher for orphaned instructions
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%
  SV for task 3.1: Read coder.txt — check against Gate 7-8
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%
  SV for task 3.2: Read explore.txt — check against Gate 6
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%
  SV for task 3.3: Read researcher.txt — check against Gate 6
  Document: plans/emergency/20260626_plan_reminder_cleanup.md
  Done: 0%
```

## Task 1.1 — Strip 5-phase workflow from plan-reminder-anthropic.txt

**Current:** 76 lines with 5-phase workflow (Initial Understanding → Planning → Synthesis → Final Plan → Complete Planning)

**Problem:** This is a parallel workflow that contradicts reasoning.txt Gates 1-6. The agent sees two different instruction sets for the same planning process.

**Fix:** Replace Phases 1-5 with a single reference to reasoning.txt gates, keep only plan-mode-specific content (read-only constraint, plan file location, cmd_runner exception).

**Target:** ~25 lines — mode notice + plan conventions + gate reference.

## Task 1.2 — Align plans conventions

plan-reminder-anthropic.txt lines 10-16 and plan.txt lines 27-32 both define plan conventions.
- Ensure both match reasoning.txt Gate 9: `plans/` → `plans_completed/`, never `.opencode/plans/`
- Remove duplication between the two files
- plan-reminder-anthropic.txt is Anthropic-specific; plan.txt is generic. One should reference the other or both should source from a single canonical definition.

## Task 2.1 — Fix general.txt workflow

**Current:** "Doing tasks" section (lines 28-33) gives a simplified workflow without gates.

**Fix:** Replace with: "Follow the gated workflow defined in reasoning.txt. As a sub-agent, you receive decomposed tasks — implement, verify, report."

## Task 3.1-3.3 — Agent prompt audit

- `coder.txt`: ✅ Already clean (33 lines, consistent with Gates 7-8)
- `explore.txt`: Need to read — should align with Gate 6 explorer rules
- `researcher.txt`: Need to read — should not duplicate Gate 1 research rules
