# Shell Output Reliability — Deep Assessment

**Date:** 2026-07-22
**Severity:** CRITICAL — agent cannot reliably detect build/test failures
**Status:** Investigation phase

---

## 1. The Problem

The agent (model) cannot reliably detect when a build or test command has failed.
When multiple tool executions exist in the conversation, the agent may report
"no error" when tests are red.

### Concrete reproduction

```
1. User runs pwsh _build.ps1 (via system tool)
   Output: [FAIL] pytest suite failed (exit code: 1)
           FAILED test_reasoning_kernel.py::TestSemanticVector — 4 tests

2. Agent separately runs bash "pwsh _build.ps1"
   Output: [Tool execution was interrupted] (60s timeout)

3. User asks: "It shows error? Is it normal?"

4. Agent answers: "No real error — just a timeout."
   → INCORRECT. Real failure existed in step 1 but was missed.
```

### Root cause chain

| Step | What happened | Bug category |
|------|--------------|--------------|
| 1 | User-executed tool output arrives as inline message | Visibility |
| 2 | Agent-executed tool times out → `interrupted` | Timeout handling |
| 3 | Agent conflates two different executions | Information merging |
| 4 | Agent doesn't re-read conversation history | Context utilization |
| 5 | Agent reports based on wrong execution | Status assessment |

---

## 2. Information Flow Analysis

### What the agent CAN see

- Agent-executed tool: full output via `job_output` / `[Tool execution was interrupted]`
- User-executed tool: inline text in the conversation stream
- `[Tool execution was interrupted]` — ambiguous: can mean timeout, user cancel, or OOM kill

### What the agent CANNOT see

- User-executed tool outputs are displayed as "The following tool was executed by the user"
  notification — **output text is not always visible to the model**
- Exit codes for user-executed tools
- Whether `interrupted` means timeout vs actual failure

### The critical gap

When both a user-executed tool AND an agent-executed tool produce output for the
same command, the agent has two information sources but no protocol for:
1. Distinguishing which execution is authoritative
2. Merging status from multiple sources
3. Prioritizing explicit failure markers over ambiguous statuses

---

## 3. Failure Modes

| Mode | What happens | Impact |
|------|-------------|--------|
| **False negative** | Real test failure → agent says "ok" | Broken code committed |
| **False positive** | Timeout → agent says "error" | Wasted investigation time |
| **Conflation** | Two executions → agent reports wrong one | Wrong diagnosis |
| **Silent truncation** | Output >50KB → truncated to file → agent reads only header | Missed errors at end |

---

## 4. Design Questions

1. **Should user-executed tool output be explicitly surfaced** in the model's message
   stream with clear status markers? Currently it's an inline notification.

2. **Should `[Tool execution was interrupted]` include exit code / reason?**
   Currently just says "interrupted" — no distinction between timeout, user cancel, OOM.

3. **Should the agent have a pre-response checklist** for build/test questions:
   - Scan history for ALL tool outputs since last user message
   - Find `[FAIL]`, `error:`, `FAILED`, exit code markers
   - Report worst status found

4. **Output truncation handling**: When output is saved to file (overflow), should
   the tool include a summary (N errors, M warnings) inline?

5. **System prompt instruction**: Should the agent be explicitly told:
   "Before reporting build/test status, scan all tool outputs in recent history.
   Explicit failure markers ([FAIL], FAILED, error:) take precedence over
   ambiguous statuses (interrupted, stalled, killed). Report the WORST status found."

---

## 5. Proposed Investigation

### Phase 1: Output visibility audit
- Trace how user-executed tool output flows into model context
- Trace how agent-executed tool output flows into model context
- Identify truncation/summarization points
- Map all status types (done, failed, killed, interrupted, stalled)

### Phase 2: Status assessment protocol
- Define unambiguous failure markers: `[FAIL]`, `exit code != 0`, `FAILED`, `error:`
- Define ambiguous markers: `interrupted`, `stalled`, `killed`
- Define resolution rules: explicit failure > ambiguous > explicit success

### Phase 3: Mitigation options
- **Option A**: System prompt instruction — least invasive, immediate
- **Option B**: Tool output wrapper — always include exit code + summary line
- **Option C**: Agent pre-response hook — automated history scan before status reports

### Phase 4: Documentation
- Update AGENTS.md / kernel with reliability requirements
- Add test for the specific reproduction scenario

---

## 6. Immediate Action Items

- [ ] Audit tool output flow for user-executed vs agent-executed tools
- [ ] Define failure marker priority rules
- [ ] Implement Option A (system prompt instruction) as immediate mitigation
- [ ] Evaluate Options B/C for architectural fix
