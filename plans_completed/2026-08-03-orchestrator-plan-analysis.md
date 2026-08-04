# Orchestrator + Plans — Architecture Analysis & Predictions

**Date:** 2026-08-03
**Status:** 🔴 OPEN (analysis)

---

## 1. Current Architecture

### 1.1 Orchestrator Agent (`20_specs_agents.py:89-151`, `agent/agent.ts:211-254`)

```
AgentStrategist + AgentAnalyst (ADID Framework v6)
├── PRIMARY agent, native, visible
├── Read-only EXCEPT plans/*.md + plans_completed/*.md
├── No shell (bash/cmd/powershell/run = deny)
├── Delegates: task tool (subagents: explore only)
└── Contract: agent.orchestrator → (planning, scope, evidence, verification)
```

**Permissions:**
- ✅ `read`, `glob`, `grep`, `list`, `webfetch`, `universalsearch`, `messagesearch`, `session-read`
- ✅ `task` (delegation)
- ✅ `edit`/`write` → only `plans/*` and `plans_completed/*`
- ❌ `bash`, `cmd`, `powershell`, `run` — workers execute
- ❌ `todowrite` — forbidden (kernel-managed task store)

### 1.2 Kernel Task Store (v6)

The orchestrator does NOT use `todowrite`. Instead:
- Kernel auto-materializes medoids from `run_task_geometry()` into a task store
- Orchestrator READS task state and TRANSITIONS statuses
- `todowrite` is an optional PROJECTION — same store, different interface

```
run_task_geometry() medoids
        │
        ▼
  Kernel task store (authoritative)
        │
        ├── orchestrator: reads + transitions states
        └── todowrite: optional projection for coding agents
```

### 1.3 ADID Fractal Planning (`14_plan_cluster.py`, `24_specs_policies.py`)

```
GOAL_SVM_PREP → SVM_INGESTION → PRE_FLIGHT → EXECUTION → VERIFICATION → STATE_EVAL
```

**Fractal decomposition:**
```
ground → seeds → fractal over-generate (Sierpinski/Quad-Oct/L-System)
       → Manhattan (L1) filter → k-medoids → CENTRAL_TASKS = medoids only
```

**PRE_FLIGHT gates (before any worker dispatch):**
1. Prior art: `universalsearch` web + Sourcegraph code (or `reuse: N/A`)
2. Smoke Tests: baseline commands + expected-now + post-impl pass criteria (or `smoke: N/A` with justification)
3. Plan written to `plans/` with ISO8601 prefix

### 1.4 Plan Hygiene (`plan-status.ts`)

```
plans/*.md          ← active (has [ ] items)
plans_completed/*.md ← done (no [ ] items, only [x]/[~])

reconcilePlans(): moves files between dirs based on checkbox state
getPlanStatus(): returns { active[], completed[], misplaced[], completion% }
isPlanHygieneClean(): active.length === 0 && misplaced.length === 0
```

**Orchestrator invariant:** Must call `getPlanStatus()` before declaring Terminal.

### 1.5 Orchestrator Loop (predicted behavior)

```
1. READ active plans from plans/
2. OBSERVE current state: getPlanStatus(), messagesearch, session-read
3. DECIDE next task: select medoid from task store
4. DISPATCH worker: task(explore) for discovery, task(coder) for implementation
5. VERIFY: worker returns → check output → transition task status
6. REPEAT or TERMINAL: residual_recluster vs Goal SV → continue or stop
```

---

## 2. What Works

| Component | Status | Notes |
|-----------|--------|-------|
| Agent definition | ✅ | orchestrator agent exists, permissions correct |
| Kernel contracts | ✅ | `agent.orchestrator` contract active |
| Plan hygiene | ✅ | `getPlanStatus()`, `reconcilePlans()` working |
| Fractal geometry | ✅ | `14_plan_cluster.py` — Sierpinski/Quad-Oct/L-System |
| Task delegation | ✅ | `task` tool with subagents (explore only) |
| Mode transitions | ⚠️ | orchestrator has `reasoning_enter`/`reasoning_exit` access |

### 2.1 Reasoning mode for orchestrator

Orchestrator `reasoning_enter`/`reasoning_exit` are **allowed** (defaults line 107-110: `reasoning_enter: "deny"`, `reasoning_exit: "deny"` — but orchestrator inherits defaults which deny them... wait, let me check).

Actually looking at `agent.ts:107-110`:
```ts
reasoning_enter: "deny",
reasoning_exit: "deny",
```

These are in the `defaults` set. The orchestrator permission is:
```ts
Permission.merge(defaults, user, Permission.fromConfig({...}))
```

The orchestrator config DOES NOT explicitly allow `reasoning_enter`/`reasoning_exit`. Only the build agent has `reasoning_enter: "allow"` (line 133). So the **orchestrator CANNOT enter reasoning mode** — only the build agent can!

Wait, that doesn't match the kernel spec. Let me re-check. The `reasoning.ts` tool has `requireNativeOrchestrator(ctx)` — it checks `ctx.agentInfo?.native && ctx.agentInfo.name === "orchestrator"`. So the reasoning tools are designed for the orchestrator to call. But the permissions don't allow it!

**This is a bug:** orchestrator is the only agent that can call `reasoningenter`/`reasoningexit` (enforced by `requireNativeOrchestrator`), but the permission system denies these tools for the orchestrator.

---

## 3. What's Broken / Missing

### 3.1 ⚠️ Orchestrator can't enter reasoning mode

**Root cause:** `reasoning_enter: "deny"` in defaults, not overridden for orchestrator.

**Fix:** Add `reasoning_enter: "allow"` and `reasoning_exit: "allow"` to orchestrator permission config in `agent.ts`.

### 3.2 ⚠️ `plan_enter` tool doesn't exist

The TUI expects `planenter` tool events. The `plan-enter.txt` description file exists. But there's no `PlanEnterTool` in the registry. The build agent has `plan_enter: "allow"`, but no tool implements it.

**Question:** How does the orchestrator (or any agent) enter plan mode? Currently:
- User manually switches via TUI (`local.agent.set("plan")`)
- Or through ACP `setSessionMode`
- No tool-based plan entry exists

### 3.3 ⚠️ Task store: kernel-managed vs reality

The kernel spec says the task store is "kernel-populated from `run_task_geometry()` medoids". But:
- `run_task_geometry` is a Python spec in `14_plan_cluster.py` — it's **not executable** in the TypeScript runtime
- The actual task management is done via `todowrite` tool (the only interface)
- The "kernel-managed task store" is a **spec aspiration**, not implemented

**Reality:** Orchestrator currently has no way to "read task state" or "transition statuses" without `todowrite`. But `todowrite` is forbidden for orchestrator!

### 3.4 ⚠️ Worker dispatch: explore-only subagents

Orchestrator's `subagents: ["explore"]` means it can only dispatch `explore` agents. It CANNOT dispatch `coder` or `general` sub-agents directly.

**How does implementation happen?** The orchestrator must write worker directives (XML) into plan files, and the **build agent** (in the main session) reads and executes them. Or the orchestrator transitions the session to build mode and the build agent implements.

### 3.5 ⚠️ Plan mode vs orchestrator: overlapping scopes

Both plan agent and orchestrator write to `plans/`. But:
- **Plan agent:** designs plans, writes `plans/*.md`, calls `planexit` to switch to build
- **Orchestrator:** reads plans, manages lifecycle, delegates to workers

These roles overlap. The orchestrator could REPLACE the plan agent entirely — it has the same `plans/` write access plus delegation capabilities.

---

## 4. Predictions: How It Will Develop

### 4.1 Short-term (what breaks first)

1. **Orchestrator tries to enter reasoning mode → permission denied**
   - `reasoningenter` tool has `requireNativeOrchestrator` gate → passes
   - But `denied()` check in `tools.ts` sees `reasoning_enter: "deny"` → blocks
   - **Fix needed:** add allow rules to orchestrator config

2. **Orchestrator can't track tasks without `todowrite`**
   - Kernel task store is aspirational — not implemented
   - `todowrite` is forbidden for orchestrator
   - Orchestrator has NO way to track task state
   - **Mitigation:** orchestrator writes task state into plan `.md` files directly (checkboxes)
   - **Or:** allow `todowrite` for orchestrator until kernel store is real

3. **Orchestrator can't dispatch coder workers**
   - `subagents: ["explore"]` — only exploration possible
   - Implementation must happen in the main session (build agent)
   - Orchestrator writes directives → build agent executes
   - **This is intentional design** — orchestrator coordinates, build implements

### 4.2 Medium-term (architectural evolution)

4. **Plan agent → deprecated in favor of orchestrator**
   - Orchestrator already has plan read/write
   - Orchestrator understands fractal geometry
   - Plan agent is a simpler subset of orchestrator capabilities
   - **Prediction:** plan mode becomes orchestrator's "planning phase"

5. **Kernel task store needs TypeScript implementation**
   - `run_task_geometry()` from Python specs → TypeScript runtime
   - `transition_task()` API for atomic status updates
   - Integration with `todowrite` as projection layer
   - **This is the biggest gap between spec and reality**

6. **Worker XML protocol needs formalization**
   - How orchestrator communicates tasks to workers
   - Structured format: goal, context, constraints, smoke tests
   - Worker returns: result, evidence, state delta

### 4.3 Long-term (AGI loop maturity)

7. **Full autonomous loop:**
   ```
   orchestrator (plan) → explorer (research) → orchestrator (decide)
   → coder (implement) → orchestrator (verify) → repeat
   ```
   Each step is a mode transition in the main session, not a sub-agent call.

8. **Multi-session orchestration:**
   - Orchestrator manages multiple sessions (one per task)
   - Each session has its own agent, model, context window
   - Orchestrator aggregates results across sessions

---

## 5. Recommendations

### 5.1 Immediate fixes

| # | What | Where | Priority |
|---|------|-------|----------|
| 1 | Allow `reasoning_enter`/`reasoning_exit` for orchestrator | `agent.ts:218-248` | P0 |
| 2 | Allow `todowrite` for orchestrator OR implement kernel task store read path | `agent.ts:218-248` | P0 |
| 3 | Implement `planenter` tool (or deprecate plan mode in favor of orchestrator planning phase) | `tool/plan.ts` | P1 |

### 5.2 Design decisions needed

| # | Question | Options |
|---|----------|---------|
| A | Should orchestrator replace plan agent? | Yes: simpler mental model. No: plan mode is useful for quick planning without full orchestration |
| B | Should orchestrator dispatch coder workers? | Yes: true delegation. No: build agent executes in main session (current design) |
| C | Task store: kernel-managed or todowrite-backed? | Kernel: spec-compliant but needs implementation. todowrite: works today, contradicts spec |

---

## 6. Smoke Tests

### 6.1 Orchestrator reasoning transition

1. Start session with orchestrator agent
2. Ask orchestrator to enter reasoning mode
3. **Check:** `reasoningenter` tool succeeds (not permission-denied)
4. **Check:** TUI switches to reasoning mode display
5. Ask orchestrator to exit reasoning mode
6. **Check:** `reasoningexit` succeeds, returns to orchestrator

### 6.2 Orchestrator plan lifecycle

1. Orchestrator reads `plans/` directory
2. Identifies plan with open `[ ]` items
3. Delegates exploration via `task(explore, ...)`
4. Updates plan based on exploration results
5. Marks tasks `[x]` when verified
6. Moves completed plan to `plans_completed/`

### 6.3 `getPlanStatus()` before Terminal

1. Orchestrator believes all work is done
2. Calls `getPlanStatus()` 
3. If `active.length === 0 && misplaced.length === 0` → Terminal
4. If not → continues working
