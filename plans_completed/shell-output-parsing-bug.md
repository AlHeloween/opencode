# Shell Output Parsing Reliability Bug

**Date:** 2026-07-22
**Severity:** CRITICAL — blocks development workflow
**Status:** Documented, root cause identified

---

## The Bug

When a build/test command produces a **real failure** output, and the agent also
has a **separate timed-out/interrupted** tool call, the agent can incorrectly
attribute the error status and report "no error" when tests are actually red.

### Concrete incident

1. User ran `pwsh _build.ps1` → output:
   ```
   [FAIL] pytest suite failed (exit code: 1)
   FAILED test_reasoning_kernel.py::TestSemanticVector - 4 tests
   ```

2. Agent separately ran `bash "pwsh _build.ps1"` → timed out → `[Tool execution was interrupted]`

3. User asked: "It shows error? Is it normal?"

4. Agent looked at its OWN timed-out call, NOT the user's actual output, and answered:
   "No real error — just a timeout."

5. User's real [FAIL] output was in the message history but the agent did not check it.

### Root cause

The agent conflated two different tool executions:
- User-executed tool → real failure output (format: `pwsh _build.ps1` with full text)
- Agent-executed tool → timeout (format: `[Tool execution was interrupted]`)

When the user asked a follow-up question, the agent answered based on the
latter, ignoring the former. The agent did not **re-read available message
history** to cross-reference all tool outputs before making an assessment.

### Why this is critical

If the agent can't correctly detect build/test failures from the message
history, it will:
- Report "all green" when tests are red
- Attempt to commit/push broken code
- Waste the user's time on phantom "timeouts" instead of real bugs
- Destroy trust — the user can't rely on the agent's assessments

### Reproduction

1. Have a real build failure visible in message history (e.g., `[FAIL] pytest`)
2. Have a separate timed-out bash call from the agent (`[Tool execution was interrupted]`)
3. Ask the agent: "Is there an error?"
4. Agent may answer based on the timeout, not the real failure

---

## What should happen

When asked about shell/tool output status, the agent MUST:

1. **Scan ALL recent tool output messages** — both user-executed and agent-executed
2. **Prioritize explicit failure markers** (`[FAIL]`, `error:`, `FAILED`, non-zero exit codes) over ambiguous statuses (`interrupted`, `stalled`, `killed`)
3. **Re-read message history** before answering status questions
4. **Never conflate** two different tool executions with the same command name
5. **Report the worst status** across all executions, not the most recent or the agent's own

## Potential fixes (system-level)

| Fix | Where | Description |
|-----|-------|-------------|
| A | Agent prompt | Add explicit instruction: "Before reporting tool status, scan ALL tool output in conversation history" |
| B | Tool output formatting | Distinguish user-executed vs agent-executed tool results more clearly |
| C | Build script | Return non-zero exit code → tool shows explicit `[FAIL]` marker |
| D | Agent reasoning | Status check flow: read all outputs → find worst status → report |

**Note:** The real test failure (4 SemanticVector tests) is a separate bug — `build_semantic_vector()` signature changed but tests weren't updated. The parsing bug is about NOT SEEING that failure at all.
