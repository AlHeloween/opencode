# Todo/Subtask Integration in Operational Flow

**Created:** 2026-06-26
**Status:** Active
**Parent:** `plans/emergency/20260626_prompt_package_audit_master.md`

```yaml
master_plan_description: "Add todo/subtask management to reasoning.txt gates — when to create todos, how they map to gates, tracking completion."

SV for goal 4: Add todo/subtask integration to operational flow in reasoning.txt
  Document: plans/emergency/20260626_todo_subtask_integration.md
  Done: 0%
  SV for task 4.1: Add <todos> section to reasoning.txt after gates
  Document: plans/emergency/20260626_todo_subtask_integration.md
  Done: 0%
  SV for task 4.2: Define todo lifecycle: create → decompose → implement → verify → mark done
  Document: plans/emergency/20260626_todo_subtask_integration.md
  Done: 0%
  SV for task 4.3: Map todos to gates: which gate triggers todo creation, modification, completion
  Document: plans/emergency/20260626_todo_subtask_integration.md
  Done: 0%
  SV for task 4.4: Add completion verification rule — task done only when oracle passes
  Document: plans/emergency/20260626_todo_subtask_integration.md
  Done: 0%
```

## Task 4.1 — Add <todos> section to reasoning.txt

Insert after `</gates>` and before `<operational>`:

```xml
<todos>
### Todo/Subtask Management

The `todowrite` tool tracks work decomposition and completion. Use it at these points:

**Gate 1 (STATE)** — after reading current state, capture requirements as todos:
- Create initial todo list from user's request
- Each todo: brief description + high/medium/low priority
- Mark current task as in_progress

**Gate 3 (MASTER PLAN)** — after producing the plan, sync todos:
- Each SV/goal in the master plan becomes a todo
- Decomposed tasks become subtasks
- Update status: plan items → pending, current focus → in_progress

**Gate 7 (IMPLEMENTATION)** — during implementation:
- Only ONE todo in_progress at a time
- Complete current tasks before starting new ones

**Gate 8 (ORACLE VERIFICATION)** — on verification:
- Mark completed IMMEDIATELY when verified — don't batch
- Add any new follow-up tasks discovered during verification

**Gate 9 (CLEAN NEXT STATE)** — end of response:
- Ensure todos reflect actual state
- Cancelled: tasks that became irrelevant
- Blocked: tasks waiting on dependencies
</todos>
```

## Task 4.2 — Todo lifecycle

1. **Capture** (Gate 1): Read user intent → create initial todos
2. **Decompose** (Gate 2): Break complex todos into subtasks
3. **Plan** (Gate 3): Map todos to master plan SV/goals
4. **Implement** (Gate 7): Execute one todo at a time, mark in_progress
5. **Verify** (Gate 8): Oracle passes → mark completed
6. **Next** (Gate 9): Report completion %, move to next

## Task 4.3 — Gate → Todo mapping

| Gate | Todo Action |
|------|------------|
| Gate 1 | Create initial todo list from user requirements |
| Gate 2 | Decompose vague todos into specific, testable subtasks |
| Gate 3 | Sync todos with master plan SV/goals |
| Gate 4 | Present plan with todos visible |
| Gate 5 | Refine todos based on user concerns |
| Gate 6 | Add explorer tasks as todos if needed |
| Gate 7 | Mark current as in_progress, ONE at a time |
| Gate 8 | Mark completed when oracle passes |
| Gate 9 | Report done/blocked/next, clean up stale todos |

## Task 4.4 — Completion rule

A todo is complete ONLY when:
- Its oracle passes (tests, typecheck, lint, runtime verification)
- The plan document is updated with [x]
- No "I think this works" assumptions — only concrete evidence

Never mark a todo complete without oracle output confirming it.
